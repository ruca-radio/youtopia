export enum TrayIconStyle {
  Auto = 0,
  White = 1,
  Black = 2
}

export enum TopBarLayout {
  Command = 0,
  TwoLevel = 1
}

export enum PlayerLayout {
  CompactDock = 0,
  ExpandedStrip = 1,
  ControlConsole = 2,
  FullscreenVu = 3
}

export enum CloseAction {
  MiniPlayer = 0,
  Tray = 1,
  Quit = 2
}

export enum MinimizeAction {
  MiniPlayer = 0,
  Taskbar = 1
}

export enum VuMeterTheme {
  Default = 0,
  Classic = 1,
  Ocean = 2,
  Fire = 3,
  Mono = 4,
  Neon = 5
}

export enum VuMeterStyle {
  Bars = 0,
  ClassicLed = 1,
  DotMatrix = 2,
  SpectrumLine = 3,
  AlbumGlow = 4
}

export enum LightssAiProvider {
  OpenAI = "openai",
  OpenRouter = "openrouter",
  Ollama = "ollama"
}

export type StoreSchema = {
  metadata: {
    version: 1;
  };
  general: {
    closeAction: CloseAction;
    disableHardwareAcceleration: boolean;
    hideToTrayOnClose: boolean;
    minimizeAction: MinimizeAction;
    showNotificationOnSongChange: boolean;
    startOnBoot: boolean;
    startMinimized: boolean;
  };
  appearance: {
    alwaysShowVolumeSlider: boolean;
    customCSSEnabled: boolean;
    customCSSPath: string | null;
    playerLayout: PlayerLayout;
    topBarLayout: TopBarLayout;
    vuMeterEnabled: boolean;
    vuMeterTheme: VuMeterTheme;
    vuMeterStyle: VuMeterStyle;
    zoom: number;
    trayIconStyle: TrayIconStyle;
  };
  playback: {
    continueWhereYouLeftOff: boolean;
    continueWhereYouLeftOffPaused: boolean;
    enableSpeakerFill: boolean;
    progressInTaskbar: boolean;
    ratioVolume: boolean;
  };
  integrations: {
    companionServerEnabled: boolean;
    companionServerAuthTokens: string | null; // array[object] | Encrypted for security
    companionServerCORSWildcardEnabled: boolean;
    discordPresenceEnabled: boolean;
    lastFMEnabled: boolean;
    lightssEnabled: boolean;
    lightssReactiveEnabled: boolean;
    lightssHost: string;
    lightssAiProvider: LightssAiProvider;
    lightssOpenAIModel: string;
    lightssOpenAIApiKey: string | null;
    lightssOpenAIRealtimeModel: string;
    lightssOpenAIRealtimeVoice: string;
    lightssOpenAIAudioDirectorModel: string;
    lightssOpenRouterModel: string;
    lightssOpenRouterApiKey: string | null;
    lightssOllamaBaseUrl: string;
    lightssOllamaModel: string;
    lightssBridgePath: string | null;
    lightssPythonPath: string | null;
  };
  shortcuts: {
    playPause: string;
    next: string;
    previous: string;
    thumbsUp: string;
    thumbsDown: string;
    volumeUp: string;
    volumeDown: string;
  };
  state: {
    lastUrl: string;
    lastPlaylistId: string;
    lastVideoId: string;
    windowBounds: Electron.Rectangle | null;
    windowMaximized: boolean;
  };
  lastfm: {
    api_key: string;
    secret: string;
    token: string | null;
    sessionKey: string | null;
    scrobblePercent: number;
  };
  developer: {
    enableDevTools: boolean;
  };
};

export type MemoryStoreSchema = {
  discordPresenceConnectionFailed: boolean;
  shortcutsPlayPauseRegisterFailed: boolean;
  shortcutsNextRegisterFailed: boolean;
  shortcutsPreviousRegisterFailed: boolean;
  shortcutsThumbsUpRegisterFailed: boolean;
  shortcutsThumbsDownRegisterFailed: boolean;
  shortcutsVolumeUpRegisterFailed: boolean;
  shortcutsVolumeDownRegisterFailed: boolean;
  companionServerAuthWindowEnabled: boolean;
  safeStorageAvailable: boolean;
  autoUpdaterDisabled: boolean;
  ytmViewLoadTimedout: boolean;
  ytmViewLoading: boolean;
  ytmViewLoadingError: boolean;
  ytmViewLoadingStatus: string;
  ytmViewUnresponsive: boolean;
  appUpdateAvailable: boolean;
  appUpdateDownloaded: boolean;
  mainWindowMiniPlayer: boolean;
};
