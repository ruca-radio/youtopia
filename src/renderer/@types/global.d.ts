import { WindowsEventArguments } from "~shared/types";
import { RendererLightssAiMessage, RendererPlayerState } from "~shared/player";
import Store from "../store-ipc/store";
import { StoreSchema, MemoryStoreSchema } from "~shared/store/schema";
import MemoryStore from "../store-ipc/memory-store";

declare global {
  interface Window {
    ytmd: {
      // Settings specific
      isDarwin: boolean;
      isLinux: boolean;
      isWindows: boolean;
      store: Store<StoreSchema>;
      memoryStore: MemoryStore<MemoryStoreSchema>;
      safeStorage: {
        decryptString(value: string): string;
        encryptString(value: string): Buffer;
      };
      openSettingsWindow(): void;
      openFlashUiWindow(): void;
      ai?: {
        fetchModels(provider: string, baseUrl?: string, apiKey?: string): Promise<string[]>;
        chat(options: {
          provider: string;
          model: string;
          systemPrompt?: string;
          messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
        }): Promise<string>;
      };
      restartApplication(): void;
      restartApplicationForUpdate(): void;
      getTrueFilePath(file: File): string;

      // Companion Authorization specific
      sendResult(authorized: boolean);
      getAppName(): string;
      getCode(): string;

      // Main window specific
      switchFocus(context: "main" | "ytm"): void;
      playerControl(command: "playPause" | "previous" | "next" | "toggleLike" | "toggleDislike" | "volumeUp" | "volumeDown"): void;
      openMiniPlayer(): void;
      restoreFromMiniPlayer(): void;
      focusSearch(): void;
      getPlayerState(): Promise<RendererPlayerState>;
      onPlayerStateChanged(callback: (state: RendererPlayerState) => void);
      startAudioAnalyzer(): void;
      stopAudioAnalyzer(): void;
      onAudioData(callback: (frequencyData: number[]) => void);
      onLightssAiMessage(callback: (message: RendererLightssAiMessage) => void);

      // YTM view specific
      ytmViewNavigateDefault(): void;
      ytmViewRecreate(): void;

      // Window control
      minimizeWindow(): void;
      maximizeWindow(): void;
      restoreWindow(): void;
      closeWindow(): void;
      handleWindowEvents(callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void);
      requestWindowState(): void;

      // App specific
      getAppVersion(): Promise<string>;
      checkForUpdates(): void;
      handleCheckingForUpdate(callback: (event: Electron.IpcRendererEvent) => void);
      handleUpdateAvailable(callback: (event: Electron.IpcRendererEvent) => void);
      handleUpdateNotAvailable(callback: (event: Electron.IpcRendererEvent) => void);
      handleUpdateDownloaded(callback: (event: Electron.IpcRendererEvent) => void);
      isAppUpdateAvailable(): Promise<boolean>;
      isAppUpdateDownloaded(): Promise<boolean>;
    };
  }

  // Fixes the navigator type to include windowControlsOverlay
  interface Navigator {
    windowControlsOverlay: {
      visible: boolean;
      addEventListener(event: "geometrychange", listener: (event: { visible: boolean }) => void);
    };
  }
}
