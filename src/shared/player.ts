export enum RendererVideoState {
  Unknown = -1,
  Paused = 0,
  Playing = 1,
  Buffering = 2
}

export type RendererThumbnail = {
  height: number;
  url: string;
  width: number;
};

export type RendererVideoDetails = {
  album: string | null;
  artist: string;
  durationSeconds: number;
  thumbnails: RendererThumbnail[];
  title: string;
};

export type RendererPlayerState = {
  adPlaying: boolean;
  muted: boolean;
  trackState: RendererVideoState;
  videoDetails: RendererVideoDetails | null;
  videoProgress: number;
  volume: number;
};

export type RendererLightssDisplayTheme = {
  fontFamily: "system" | "display" | "mono";
  backgroundColor: string;
  accentColor: string;
  vuLowColor: string;
  vuMidColor: string;
  vuHighColor: string;
};

export type RendererLightssVuStyle = "bars" | "classicLed" | "dotMatrix" | "spectrumLine" | "albumGlow";

export type RendererLightssVisualScene = {
  backgroundStyle: "solid" | "gradient";
  visualizerStyle: "vuBars" | "vuDots" | "spectrumLine" | "none";
  vuStyle: RendererLightssVuStyle;
  motion: "static" | "slow" | "medium";
  density: number;
  intensity: number;
  logoMode: "off" | "small" | "prominent";
  captionMode: "off" | "minimal" | "full";
  albumArtMode: "off" | "corner" | "hero" | "ambient";
};

export type RendererLightssAiMessage = {
  title: string;
  message: string;
  provider: string;
  model: string;
  aiStatus?: "idle" | "planning" | "connected" | "failed";
  wledStatus?: "unknown" | "connected" | "failed";
  lightStatus?: "idle" | "applied" | "failed";
  mood?: string;
  genre?: string;
  bpm?: number;
  displayTheme?: RendererLightssDisplayTheme;
  visualScene?: RendererLightssVisualScene;
  tickerMessage?: string;
  hostLine?: string;
  timestamp: number;
};
