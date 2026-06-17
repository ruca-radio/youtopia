export type ShellActions = {
  focusSearch: () => void;
  navigateHome: () => void;
  next: () => void;
  openMiniPlayer: () => void;
  openSettings: () => void;
  playPause: () => void;
  previous: () => void;
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
  title: string;
  volume: number;
};

export const placeholderTrack: ShellTrack = {
  album: "YouTube Music",
  artist: "Ready",
  durationLabel: "--:--",
  isPlaying: false,
  progress: 0,
  title: "Nothing playing",
  volume: 64
};
