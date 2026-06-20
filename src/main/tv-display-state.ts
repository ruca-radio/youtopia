import playerStateStore, { VideoState } from "./player-state-store";
import type { RendererLightssAiMessage } from "../shared/player";
import { VuMeterStyle } from "../shared/store/schema";

let latestAudioData: number[] = [];
let latestAudioDataAt = 0;
let latestLightssMessage: RendererLightssAiMessage | null = null;
let latestVuMeterStyle = VuMeterStyle.Bars;

function getBestThumbnailUrl(thumbnails: { height: number; url: string; width: number }[] | undefined): string {
  if (!thumbnails?.length) return "";
  return thumbnails.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.url ?? "";
}

export function updateTvAudioData(frequencyData: number[]): void {
  latestAudioData = frequencyData.slice(0, 32);
  latestAudioDataAt = Date.now();
}

export function updateTvLightssMessage(message: RendererLightssAiMessage): void {
  latestLightssMessage = message;
}

export function updateTvAppearance(vuMeterStyle: VuMeterStyle): void {
  latestVuMeterStyle = vuMeterStyle;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function getLatestTvAudioProfile() {
  const bins = latestAudioData.slice(0, 32);
  const live = bins.some(value => value > 0) && Date.now() - latestAudioDataAt < 1800;
  const bass = average(bins.slice(0, 6)) / 255;
  const mid = average(bins.slice(6, 18)) / 255;
  const treble = average(bins.slice(18)) / 255;
  const energy = average(bins) / 255;

  return {
    live,
    updatedAt: latestAudioDataAt,
    energy: Math.round(energy * 100) / 100,
    bass: Math.round(bass * 100) / 100,
    mid: Math.round(mid * 100) / 100,
    treble: Math.round(treble * 100) / 100,
    bins
  };
}

export function getTvDisplayState() {
  const state = playerStateStore.getState();
  const details = state.videoDetails;
  const isPlaying = state.trackState === VideoState.Playing;
  const audioLive = latestAudioData.some(value => value > 0) && Date.now() - latestAudioDataAt < 1800;
  const albumArtUrl = getBestThumbnailUrl(details?.thumbnails);

  return {
    generatedAt: Date.now(),
    player: {
      title: details?.title ?? "Nothing playing",
      artist: details?.author ?? "Ready",
      album: details?.album ?? "",
      albumArtUrl,
      durationSeconds: details?.durationSeconds ?? 0,
      progressSeconds: state.videoProgress,
      progressPercent: details?.durationSeconds ? Math.min(100, Math.max(0, (state.videoProgress / details.durationSeconds) * 100)) : 0,
      isPlaying,
      volume: state.volume
    },
    appearance: {
      vuMeterStyle: latestVuMeterStyle
    },
    audio: {
      live: audioLive,
      updatedAt: latestAudioDataAt,
      bins: latestAudioData
    },
    lightss: latestLightssMessage
  };
}
