import { BrowserView } from "electron";

// The YTM audio analyzer feeds two independent surfaces: the desktop VU meter and
// the Fire TV display. Each surface subscribes independently and the analyzer must
// keep running while *any* subscriber is active. Previously only the desktop window
// could start it, so the TV VU meter went dead whenever the desktop VU meter was
// disabled, mini-played, or unfocused. This hub ref-counts subscribers so the TV
// display can hold the analyzer open on its own.
//
// Autoplay-policy hardening: the renderer's Web Audio AudioContext can be created
// in a "suspended" state when no user gesture has occurred in the ytmView (Chrome's
// autoplay policy applies to Web Audio independently of media-element autoplay). A
// suspended context yields all-zero FFT data, which the TV renders as the dimmed
// static "fallback" bars. A single "start" message can therefore land on a context
// that never resumes. To make initialization reliable regardless of autoplay policy
// or desktop UI state, this hub re-asserts "start" a few times after a subscriber
// (especially the TV) brings the analyzer up, giving the renderer repeated chances
// to resume the context and (re)connect the analyser graph.
export type AudioAnalyzerSubscriber = "desktop" | "tv";

const activeSubscribers = new Set<AudioAnalyzerSubscriber>();
let getYtmView: () => BrowserView | null = () => null;
let lastSentRunning = false;

// Re-assert "start" several times so a suspended/just-loaded AudioContext gets
// repeated opportunities to resume. Cheap and idempotent: the renderer's start()
// is a no-op once the analyzer is already running, and resume() is safe to call
// repeatedly. Cleared as soon as the analyzer should stop.
const START_REASSERT_DELAYS_MS = [150, 500, 1200, 2500];
let reassertTimers: NodeJS.Timeout[] = [];

export function provideAudioAnalyzerView(resolver: () => BrowserView | null): void {
  getYtmView = resolver;
}

function sendControl(action: "start" | "stop"): void {
  const ytmView = getYtmView();
  if (!ytmView || ytmView.webContents.isDestroyed()) return;
  ytmView.webContents.send("audioAnalyzer:control", action);
}

function clearReassertTimers(): void {
  for (const timer of reassertTimers) clearTimeout(timer);
  reassertTimers = [];
}

// Schedule repeated "start" messages so the renderer can force-resume a suspended
// AudioContext even if the first attempt arrives before a user gesture or before
// the media element is ready.
function scheduleStartReassert(): void {
  clearReassertTimers();
  reassertTimers = START_REASSERT_DELAYS_MS.map(delay =>
    setTimeout(() => {
      // Only keep nudging while we still intend to be running.
      if (activeSubscribers.size > 0) sendControl("start");
    }, delay)
  );
}

function syncAnalyzerState(): void {
  const shouldRun = activeSubscribers.size > 0;
  if (shouldRun === lastSentRunning) return;
  lastSentRunning = shouldRun;
  if (shouldRun) {
    sendControl("start");
    scheduleStartReassert();
  } else {
    clearReassertTimers();
    sendControl("stop");
  }
}

export function addAudioAnalyzerSubscriber(subscriber: AudioAnalyzerSubscriber): void {
  const wasRunning = activeSubscribers.size > 0;
  activeSubscribers.add(subscriber);
  syncAnalyzerState();
  // If the analyzer was already considered "running" when a new surface (e.g. a TV
  // display) subscribes, re-assert "start" anyway. The existing context may have
  // been left suspended/zeroed (autoplay policy, prior stop, or a navigation), and
  // the newly connected surface needs live data immediately rather than waiting for
  // an unrelated desktop toggle.
  if (wasRunning) {
    sendControl("start");
    scheduleStartReassert();
  }
}

export function removeAudioAnalyzerSubscriber(subscriber: AudioAnalyzerSubscriber): void {
  activeSubscribers.delete(subscriber);
  syncAnalyzerState();
}

export function isAudioAnalyzerActive(): boolean {
  return activeSubscribers.size > 0;
}

// Re-issue the current control state to a freshly (re)loaded ytmView so the analyzer
// resumes after a navigation without waiting for a subscriber toggle.
export function resyncAudioAnalyzerView(): void {
  lastSentRunning = false;
  syncAnalyzerState();
  // After a navigation the AudioContext is brand new and may be suspended; nudge it.
  if (activeSubscribers.size > 0) scheduleStartReassert();
}
