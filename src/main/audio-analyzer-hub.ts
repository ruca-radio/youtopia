import { BrowserView } from "electron";

// The YTM audio analyzer feeds two independent surfaces: the desktop VU meter and
// the Fire TV display. Each surface subscribes independently and the analyzer must
// keep running while *any* subscriber is active. Previously only the desktop window
// could start it, so the TV VU meter went dead whenever the desktop VU meter was
// disabled, mini-played, or unfocused. This hub ref-counts subscribers so the TV
// display can hold the analyzer open on its own.
export type AudioAnalyzerSubscriber = "desktop" | "tv";

const activeSubscribers = new Set<AudioAnalyzerSubscriber>();
let getYtmView: () => BrowserView | null = () => null;
let lastSentRunning = false;

export function provideAudioAnalyzerView(resolver: () => BrowserView | null): void {
  getYtmView = resolver;
}

function sendControl(action: "start" | "stop"): void {
  const ytmView = getYtmView();
  if (!ytmView || ytmView.webContents.isDestroyed()) return;
  ytmView.webContents.send("audioAnalyzer:control", action);
}

function syncAnalyzerState(): void {
  const shouldRun = activeSubscribers.size > 0;
  if (shouldRun === lastSentRunning) return;
  lastSentRunning = shouldRun;
  sendControl(shouldRun ? "start" : "stop");
}

export function addAudioAnalyzerSubscriber(subscriber: AudioAnalyzerSubscriber): void {
  activeSubscribers.add(subscriber);
  syncAnalyzerState();
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
}
