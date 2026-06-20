package studio.youtopia.tvreceiver;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private static final String TV_URL = "http://10.27.27.96:9863/tv";
    private static final String CONTROL_URL = "http://10.27.27.96:9863/tv/control";

    private WebView webView;
    private boolean reloadOnResume;

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

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient());
        setContentView(webView);

        enterImmersiveMode();
        webView.loadUrl(TV_URL);
    }

    @Override
    protected void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (reloadOnResume && webView != null) {
            reloadOnResume = false;
            webView.loadUrl(TV_URL);
        }
    }

    @Override
    protected void onStop() {
        disconnectTvAudio();
        reloadOnResume = true;
        super.onStop();
    }

    @Override
    protected void onDestroy() {
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
                sendControl("next");
                return true;
            case KeyEvent.KEYCODE_MENU:
                webView.reload();
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

    private void sendControl(final String command) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection connection = null;
                try {
                    byte[] body = ("{\"command\":\"" + command + "\"}").getBytes(StandardCharsets.UTF_8);
                    URL url = new URL(CONTROL_URL);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(1200);
                    connection.setReadTimeout(1200);
                    connection.setRequestMethod("POST");
                    connection.setRequestProperty("Content-Type", "application/json");
                    connection.setDoOutput(true);

                    OutputStream outputStream = connection.getOutputStream();
                    outputStream.write(body);
                    outputStream.close();
                    connection.getResponseCode();
                } catch (Exception ignored) {
                    // The WebView controls remain usable if a native remote key POST fails.
                } finally {
                    if (connection != null) {
                        connection.disconnect();
                    }
                }
            }
        }).start();
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
