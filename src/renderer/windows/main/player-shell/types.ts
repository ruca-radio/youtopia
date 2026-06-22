import { PlayerLayout, TopBarLayout } from "~shared/store/schema";

export type ShellActions = {
  focusSearch: () => void;
  navigateHome: () => void;
  next: () => void;
  openMiniPlayer: () => void;
  openSettings: () => void;
  openFlashUi: () => void;
  playPause: () => void;
  previous: () => void;
  restoreFromMiniPlayer: () => void;
  seekBackward: () => void;
  seekForward: () => void;
  setPlayerLayout: (layout: PlayerLayout) => void;
  setTopBarLayout: (layout: TopBarLayout) => void;
  toggleDislike: () => void;
  toggleLike: () => void;
  volumeDown: () => void;
  volumeUp: () => void;
};

export type ShellTrack = {
  album: string;
  artist: string;
  durationLabel: string;
  isPlaying: boolean;
  progress: number;
  thumbnailUrl: string;
  title: string;
  volume: number;
};

export const placeholderTrack: ShellTrack = {
  album: "YouTube Music",
  artist: "Ready",
  durationLabel: "--:--",
  isPlaying: false,
  progress: 0,
  thumbnailUrl: "",
  title: "Nothing playing",
  volume: 64
};
