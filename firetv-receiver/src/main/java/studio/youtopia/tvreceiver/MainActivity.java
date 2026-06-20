package studio.youtopia.tvreceiver;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public final class MainActivity extends Activity {
    private static final String TV_URL = "http://10.27.27.96:9863/tv/program-receiver";
    // Remote keys reach the PIN-protected /tv/control endpoint via the page's JS bridge
    // (window.youtopiaTvControl), so the native shell no longer POSTs to it directly.
    private static final long RECONNECT_DELAY_MS = 4000L;

    private WebView webView;
    private boolean reloadOnResume;
    private final Handler reconnectHandler = new Handler(Looper.getMainLooper());
    private boolean reconnectScheduled;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setBackgroundDrawable(null);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.BLACK);
        webView.setKeepScreenOn(true);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        // Hardware layer keeps the server-rendered program video smooth on Fire TV GPUs.
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Only react to main-frame failures (the companion server being down or
                // restarting). Sub-resource errors must not trigger a full reload loop.
                if (request != null && request.isForMainFrame()) {
                    scheduleReconnect();
                }
                super.onReceivedError(view, request, error);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                cancelReconnect();
            }
        });
        setContentView(webView);

        enterImmersiveMode();
        webView.requestFocus();
        webView.loadUrl(TV_URL);
    }

    private void scheduleReconnect() {
        if (reconnectScheduled) {
            return;
        }
        reconnectScheduled = true;
        reconnectHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                reconnectScheduled = false;
                if (webView != null) {
                    webView.loadUrl(TV_URL);
                }
            }
        }, RECONNECT_DELAY_MS);
    }

    private void cancelReconnect() {
        reconnectScheduled = false;
        reconnectHandler.removeCallbacksAndMessages(null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        if (reloadOnResume && webView != null) {
            reloadOnResume = false;
            webView.loadUrl(TV_URL);
        }
    }

    @Override
    protected void onPause() {
        // Pause the WebView's JS timers/rAF while backgrounded so the visualizer loop
        // does not keep the GPU busy when the TV display is not on screen.
        if (webView != null) {
            webView.onPause();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        disconnectTvAudio();
        reloadOnResume = true;
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        cancelReconnect();
        disconnectTvAudio();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() != KeyEvent.ACTION_UP) {
            return super.dispatchKeyEvent(event);
        }

        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_SPACE:
                sendControl("playPause");
                return true;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
            case KeyEvent.KEYCODE_CHANNEL_DOWN:
                sendControl("previous");
                return true;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
            case KeyEvent.KEYCODE_CHANNEL_UP:
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD:
                sendControl("next");
                return true;
            case KeyEvent.KEYCODE_MEDIA_REWIND:
                sendControl("previous");
                return true;
            case KeyEvent.KEYCODE_MENU:
                reloadTv();
                return true;
            default:
                return super.dispatchKeyEvent(event);
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }

        super.onBackPressed();
    }

    private void enterImmersiveMode() {
        View decorView = getWindow().getDecorView();
        decorView.setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    // Remote keys are dispatched through the TV page's JS bridge (window.youtopiaTvControl)
    // rather than a direct POST to /tv/control. The control endpoint is PIN-protected, and
    // the page already owns the cached PIN (header + on-screen PIN gate), so routing through
    // it keeps native remote keys working without duplicating auth state in the native shell.
    private void sendControl(final String command) {
        if (webView == null) {
            return;
        }

        final String safeCommand = command.replace("'", "");
        webView.post(new Runnable() {
            @Override
            public void run() {
                if (webView == null) {
                    return;
                }
                webView.evaluateJavascript(
                    "(function(){if(window.youtopiaTvControl){window.youtopiaTvControl('" + safeCommand + "');}})();",
                    null
                );
            }
        });
    }

    private void reloadTv() {
        if (webView == null) {
            return;
        }

        webView.post(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.loadUrl(TV_URL);
                }
            }
        });
    }

    private void disconnectTvAudio() {
        if (webView == null) {
            return;
        }

        webView.evaluateJavascript(
            "(function(){var a=document.getElementById('tvAudio');" +
                "if(a){a.pause();a.removeAttribute('src');a.load();}})();",
            null
        );
    }
}
