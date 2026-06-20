<script setup lang="ts">
import { ref } from "vue";
import KeybindInput from "../../components/KeybindInput.vue";
import YTMDSetting from "../../components/YTMDSetting.vue";
import {
  CloseAction,
  LightssAiProvider,
  MinimizeAction,
  PlayerLayout,
  StoreSchema,
  TopBarLayout,
  TrayIconStyle,
  VuMeterStyle,
  VuMeterTheme
} from "~shared/store/schema";
import { AuthToken } from "~shared/integrations/companion-server/types";
import logo from "~assets/icons/ytmd.png";

declare const YTMD_GIT_COMMIT_HASH: string;
declare const YTMD_GIT_BRANCH: string;

const ytmdVersion = await window.ytmd.getAppVersion();
const ytmdCommitHash = YTMD_GIT_COMMIT_HASH.substring(0, 7);
const ytmdBranch = YTMD_GIT_BRANCH;

const isDarwin = window.ytmd.isDarwin;
const isLinux = window.ytmd.isLinux;

const currentTab = ref(1);
const requiresRestart = ref(false);
const checkingForUpdate = ref(false);
const updateAvailable = ref(await window.ytmd.isAppUpdateAvailable());
const updateNotAvailable = ref(false);
const updateDownloaded = ref(await window.ytmd.isAppUpdateDownloaded());

const store = window.ytmd.store;
const memoryStore = window.ytmd.memoryStore;
const safeStorage = window.ytmd.safeStorage;

const safeStorageAvailable = ref<boolean>(await memoryStore.get("safeStorageAvailable"));

const general: StoreSchema["general"] = await store.get("general");
const appearance: StoreSchema["appearance"] = await store.get("appearance");
const playback: StoreSchema["playback"] = await store.get("playback");
const integrations: StoreSchema["integrations"] = await store.get("integrations");
const shortcuts: StoreSchema["shortcuts"] = await store.get("shortcuts");
const lastFM: StoreSchema["lastfm"] = await store.get("lastfm");

const disableHardwareAcceleration = ref<boolean>(general.disableHardwareAcceleration);
const closeAction = ref<number>(general.closeAction);
const hideToTrayOnClose = ref<boolean>(general.hideToTrayOnClose);
const minimizeAction = ref<number>(general.minimizeAction);
const showNotificationOnSongChange = ref<boolean>(general.showNotificationOnSongChange);
const startOnBoot = ref<boolean>(general.startOnBoot);
const startMinimized = ref<boolean>(general.startMinimized);

const alwaysShowVolumeSlider = ref<boolean>(appearance.alwaysShowVolumeSlider);
const customCSSEnabled = ref<boolean>(appearance.customCSSEnabled);
const customCSSPath = ref<string>(appearance.customCSSPath);
const playerLayout = ref<number>(appearance.playerLayout);
const topBarLayout = ref<number>(appearance.topBarLayout);
const vuMeterEnabled = ref<boolean>(appearance.vuMeterEnabled);
const vuMeterTheme = ref<number>(appearance.vuMeterTheme);
const vuMeterStyle = ref<number>(appearance.vuMeterStyle ?? VuMeterStyle.Bars);
const zoom = ref<number>(appearance.zoom);
const trayIconStyle = ref<number>(appearance.trayIconStyle);

const continueWhereYouLeftOff = ref<boolean>(playback.continueWhereYouLeftOff);
const continueWhereYouLeftOffPaused = ref<boolean>(playback.continueWhereYouLeftOffPaused);
const enableSpeakerFill = ref<boolean>(playback.enableSpeakerFill);
const progressInTaskbar = ref<boolean>(playback.progressInTaskbar);
const ratioVolume = ref<boolean>(playback.ratioVolume);

const companionServerEnabled = ref<boolean>(integrations.companionServerEnabled);
const companionServerAuthTokens = ref<AuthToken[]>(
  safeStorageAvailable.value ? (JSON.parse(await safeStorage.decryptString(integrations.companionServerAuthTokens)) ?? []) : []
);
const companionServerCORSWildcardEnabled = ref<boolean>(integrations.companionServerCORSWildcardEnabled);
const companionServerTvControlPin = ref<string | null>(integrations.companionServerTvControlPin ?? null);
const discordPresenceEnabled = ref<boolean>(integrations.discordPresenceEnabled);
const lastFMEnabled = ref<boolean>(integrations.lastFMEnabled);
const lightssEnabled = ref<boolean>(integrations.lightssEnabled ?? false);
const lightssReactiveEnabled = ref<boolean>(integrations.lightssReactiveEnabled ?? true);
const lightssHost = ref<string>(integrations.lightssHost ?? "http://10.27.27.110");
const lightssAiProvider = ref<LightssAiProvider>(integrations.lightssAiProvider ?? LightssAiProvider.Ollama);
const lightssOpenAIModel = ref<string>(integrations.lightssOpenAIModel ?? "gpt-5.5");
const lightssOpenAIApiKey = ref<string | null>(integrations.lightssOpenAIApiKey ?? null);
const lightssOpenAIRealtimeModel = ref<string>(integrations.lightssOpenAIRealtimeModel ?? "gpt-realtime-2");
const lightssOpenAIRealtimeVoice = ref<string>(integrations.lightssOpenAIRealtimeVoice ?? "marin");
const lightssOpenAIAudioDirectorModel = ref<string>(integrations.lightssOpenAIAudioDirectorModel ?? "gpt-5.5");
const lightssOpenRouterModel = ref<string>(integrations.lightssOpenRouterModel ?? "openrouter/free");
const lightssOpenRouterApiKey = ref<string | null>(integrations.lightssOpenRouterApiKey ?? null);
const lightssOllamaBaseUrl = ref<string>(integrations.lightssOllamaBaseUrl ?? "http://10.27.27.10:11434");
const lightssOllamaModel = ref<string>(integrations.lightssOllamaModel ?? "kimi-k2.7-code:cloud");
const lightssGeminiApiKey = ref<string | null>(integrations.lightssGeminiApiKey ?? null);
const lightssGeminiModel = ref<string>(integrations.lightssGeminiModel ?? "gemini-2.5-flash");
const lightssGeminiBaseUrl = ref<string>(integrations.lightssGeminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta");
const lightssLyriaEnabled = ref<boolean>(integrations.lightssLyriaEnabled ?? false);
const lightssLyriaPrompt = ref<string | null>(integrations.lightssLyriaPrompt ?? null);
const lightssDjVoiceEnabled = ref<boolean>(integrations.lightssDjVoiceEnabled ?? false);
const lightssDjVoiceModel = ref<string>(integrations.lightssDjVoiceModel ?? "en-US-Journey-F");
const lightssDjVoicePrompt = ref<string | null>(integrations.lightssDjVoicePrompt ?? null);
const lightssBridgePath = ref<string | null>(integrations.lightssBridgePath ?? null);
const lightssPythonPath = ref<string | null>(integrations.lightssPythonPath ?? null);
const lightssWledPrompt = ref<string | null>(integrations.lightssWledPrompt ?? null);
const lightssCanvasPrompt = ref<string | null>(integrations.lightssCanvasPrompt ?? null);
const lightssHostPrompt = ref<string | null>(integrations.lightssHostPrompt ?? null);
const lightssWledProvider = ref<LightssAiProvider>(integrations.lightssWledProvider ?? LightssAiProvider.Ollama);
const lightssWledModel = ref<string>(integrations.lightssWledModel ?? "kimi-k2.7-code:cloud");
const lightssCanvasProvider = ref<LightssAiProvider>(integrations.lightssCanvasProvider ?? LightssAiProvider.Gemini);
const lightssCanvasModel = ref<string>(integrations.lightssCanvasModel ?? "gemini-2.5-flash");
const lightssHostProvider = ref<LightssAiProvider>(integrations.lightssHostProvider ?? LightssAiProvider.Gemini);
const lightssHostModel = ref<string>(integrations.lightssHostModel ?? "gemini-2.5-flash");
const lightssAnalystProvider = ref<LightssAiProvider>(integrations.lightssAnalystProvider ?? LightssAiProvider.Gemini);
const lightssAnalystModel = ref<string>(integrations.lightssAnalystModel ?? "gemini-2.5-flash");
const lightssAnalystPrompt = ref<string | null>(integrations.lightssAnalystPrompt ?? null);
const lightssSketchProvider = ref<LightssAiProvider>(integrations.lightssSketchProvider ?? LightssAiProvider.Gemini);
const lightssSketchModel = ref<string>(integrations.lightssSketchModel ?? "gemini-2.5-flash");
const lightssVisionEnabled = ref<boolean>(integrations.lightssVisionEnabled ?? true);
const lightssStepIntervalSecs = ref<number>((integrations.lightssStepIntervalMs ?? 7000) / 1000);

const audioCompressorEnabled = ref<boolean>(integrations.audioCompressorEnabled ?? true);
const audioCompressorThreshold = ref<number>(integrations.audioCompressorThreshold ?? -24);
const audioCompressorRatio = ref<number>(integrations.audioCompressorRatio ?? 12);
const audioCompressorAttack = ref<number>(integrations.audioCompressorAttack ?? 0.003);
const audioCompressorRelease = ref<number>(integrations.audioCompressorRelease ?? 0.25);

const shortcutPlayPause = ref<string>(shortcuts.playPause);
const shortcutNext = ref<string>(shortcuts.next);
const shortcutPrevious = ref<string>(shortcuts.previous);
const shortcutThumbsUp = ref<string>(shortcuts.thumbsUp);
const shortcutThumbsDown = ref<string>(shortcuts.thumbsDown);
const shortcutVolumeUp = ref<string>(shortcuts.volumeUp);
const shortcutVolumeDown = ref<string>(shortcuts.volumeDown);

const lastFMSessionKey = ref<string>(lastFM.sessionKey);
const scrobblePercent = ref<number>(lastFM.scrobblePercent);

store.onDidAnyChange(async newState => {
  disableHardwareAcceleration.value = newState.general.disableHardwareAcceleration;
  closeAction.value = newState.general.closeAction;
  hideToTrayOnClose.value = newState.general.hideToTrayOnClose;
  minimizeAction.value = newState.general.minimizeAction;
  showNotificationOnSongChange.value = newState.general.showNotificationOnSongChange;
  startOnBoot.value = newState.general.startOnBoot;
  startMinimized.value = newState.general.startMinimized;

  alwaysShowVolumeSlider.value = newState.appearance.alwaysShowVolumeSlider;
  customCSSEnabled.value = newState.appearance.customCSSEnabled;
  customCSSPath.value = newState.appearance.customCSSPath;
  playerLayout.value = newState.appearance.playerLayout;
  topBarLayout.value = newState.appearance.topBarLayout;
  vuMeterEnabled.value = newState.appearance.vuMeterEnabled;
  vuMeterTheme.value = newState.appearance.vuMeterTheme;
  vuMeterStyle.value = newState.appearance.vuMeterStyle ?? VuMeterStyle.Bars;
  zoom.value = newState.appearance.zoom;
  trayIconStyle.value = newState.appearance.trayIconStyle;

  continueWhereYouLeftOff.value = newState.playback.continueWhereYouLeftOff;
  continueWhereYouLeftOffPaused.value = newState.playback.continueWhereYouLeftOffPaused;
  enableSpeakerFill.value = newState.playback.enableSpeakerFill;
  progressInTaskbar.value = newState.playback.progressInTaskbar;
  ratioVolume.value = newState.playback.ratioVolume;

  companionServerEnabled.value = newState.integrations.companionServerEnabled;
  companionServerAuthTokens.value = safeStorageAvailable.value
    ? (JSON.parse(await safeStorage.decryptString(newState.integrations.companionServerAuthTokens)) ?? [])
    : [];
  companionServerCORSWildcardEnabled.value = newState.integrations.companionServerCORSWildcardEnabled;
  companionServerTvControlPin.value = newState.integrations.companionServerTvControlPin ?? null;
  discordPresenceEnabled.value = newState.integrations.discordPresenceEnabled;
  lastFMEnabled.value = newState.integrations.lastFMEnabled;
  lightssEnabled.value = newState.integrations.lightssEnabled ?? false;
  lightssReactiveEnabled.value = newState.integrations.lightssReactiveEnabled ?? true;
  lightssHost.value = newState.integrations.lightssHost ?? "http://10.27.27.110";
  lightssAiProvider.value = newState.integrations.lightssAiProvider ?? LightssAiProvider.Ollama;
  lightssOpenAIModel.value = newState.integrations.lightssOpenAIModel ?? "gpt-5.5";
  lightssOpenAIApiKey.value = newState.integrations.lightssOpenAIApiKey ?? null;
  lightssOpenAIRealtimeModel.value = newState.integrations.lightssOpenAIRealtimeModel ?? "gpt-realtime-2";
  lightssOpenAIRealtimeVoice.value = newState.integrations.lightssOpenAIRealtimeVoice ?? "marin";
  lightssOpenAIAudioDirectorModel.value = newState.integrations.lightssOpenAIAudioDirectorModel ?? "gpt-5.5";
  lightssOpenRouterModel.value = newState.integrations.lightssOpenRouterModel ?? "openrouter/free";
  lightssOpenRouterApiKey.value = newState.integrations.lightssOpenRouterApiKey ?? null;
  lightssOllamaBaseUrl.value = newState.integrations.lightssOllamaBaseUrl ?? "http://10.27.27.10:11434";
  lightssOllamaModel.value = newState.integrations.lightssOllamaModel ?? "kimi-k2.7-code:cloud";
  lightssGeminiApiKey.value = newState.integrations.lightssGeminiApiKey ?? null;
  lightssGeminiModel.value = newState.integrations.lightssGeminiModel ?? "gemini-2.5-flash";
  lightssGeminiBaseUrl.value = newState.integrations.lightssGeminiBaseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
  lightssLyriaEnabled.value = newState.integrations.lightssLyriaEnabled ?? false;
  lightssLyriaPrompt.value = newState.integrations.lightssLyriaPrompt ?? null;
  lightssDjVoiceEnabled.value = newState.integrations.lightssDjVoiceEnabled ?? false;
  lightssDjVoiceModel.value = newState.integrations.lightssDjVoiceModel ?? "en-US-Journey-F";
  lightssDjVoicePrompt.value = newState.integrations.lightssDjVoicePrompt ?? null;
  lightssBridgePath.value = newState.integrations.lightssBridgePath ?? null;
  lightssPythonPath.value = newState.integrations.lightssPythonPath ?? null;
  lightssWledPrompt.value = newState.integrations.lightssWledPrompt ?? null;
  lightssCanvasPrompt.value = newState.integrations.lightssCanvasPrompt ?? null;
  lightssHostPrompt.value = newState.integrations.lightssHostPrompt ?? null;
  lightssWledProvider.value = newState.integrations.lightssWledProvider ?? LightssAiProvider.Ollama;
  lightssWledModel.value = newState.integrations.lightssWledModel ?? "kimi-k2.7-code:cloud";
  lightssCanvasProvider.value = newState.integrations.lightssCanvasProvider ?? LightssAiProvider.Gemini;
  lightssCanvasModel.value = newState.integrations.lightssCanvasModel ?? "gemini-2.5-flash";
  lightssHostProvider.value = newState.integrations.lightssHostProvider ?? LightssAiProvider.Gemini;
  lightssHostModel.value = newState.integrations.lightssHostModel ?? "gemini-2.5-flash";
  lightssAnalystProvider.value = newState.integrations.lightssAnalystProvider ?? LightssAiProvider.Gemini;
  lightssAnalystModel.value = newState.integrations.lightssAnalystModel ?? "gemini-2.5-flash";
  lightssAnalystPrompt.value = newState.integrations.lightssAnalystPrompt ?? null;
  lightssSketchProvider.value = newState.integrations.lightssSketchProvider ?? LightssAiProvider.Gemini;
  lightssSketchModel.value = newState.integrations.lightssSketchModel ?? "gemini-2.5-flash";
  lightssVisionEnabled.value = newState.integrations.lightssVisionEnabled ?? true;
  lightssStepIntervalSecs.value = (newState.integrations.lightssStepIntervalMs ?? 7000) / 1000;
  audioCompressorEnabled.value = newState.integrations.audioCompressorEnabled ?? true;
  audioCompressorThreshold.value = newState.integrations.audioCompressorThreshold ?? -24;
  audioCompressorRatio.value = newState.integrations.audioCompressorRatio ?? 12;
  audioCompressorAttack.value = newState.integrations.audioCompressorAttack ?? 0.003;
  audioCompressorRelease.value = newState.integrations.audioCompressorRelease ?? 0.25;
  lastFMSessionKey.value = newState.lastfm.sessionKey;
  scrobblePercent.value = newState.lastfm.scrobblePercent;

  shortcutPlayPause.value = newState.shortcuts.playPause;
  shortcutNext.value = newState.shortcuts.next;
  shortcutPrevious.value = newState.shortcuts.previous;
  shortcutThumbsUp.value = newState.shortcuts.thumbsUp;
  shortcutThumbsDown.value = newState.shortcuts.thumbsDown;
  shortcutVolumeUp.value = newState.shortcuts.volumeUp;
  shortcutVolumeDown.value = newState.shortcuts.volumeDown;
});

const discordPresenceConnectionFailed = ref<boolean>(await memoryStore.get("discordPresenceConnectionFailed"));

const shortcutsPlayPauseRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsPlayPauseRegisterFailed"));
const shortcutsNextRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsNextRegisterFailed"));
const shortcutsPreviousRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsPreviousRegisterFailed"));
const shortcutsThumbsUpRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsThumbsUpRegisterFailed"));
const shortcutsThumbsDownRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsThumbsDownRegisterFailed"));
const shortcutsVolumeUpRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsVolumeUpRegisterFailed"));
const shortcutsVolumeDownRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsVolumeDownRegisterFailed"));

const companionServerAuthWindowEnabled = ref<boolean>(await memoryStore.get("companionServerAuthWindowEnabled"));

const autoUpdaterDisabled = ref<boolean>(await memoryStore.get("autoUpdaterDisabled"));

memoryStore.onStateChanged(newState => {
  discordPresenceConnectionFailed.value = newState.discordPresenceConnectionFailed;

  shortcutsPlayPauseRegisterFailed.value = newState.shortcutsPlayPauseRegisterFailed;
  shortcutsNextRegisterFailed.value = newState.shortcutsNextRegisterFailed;
  shortcutsPreviousRegisterFailed.value = newState.shortcutsPreviousRegisterFailed;
  shortcutsThumbsUpRegisterFailed.value = newState.shortcutsThumbsUpRegisterFailed;
  shortcutsThumbsDownRegisterFailed.value = newState.shortcutsThumbsDownRegisterFailed;
  shortcutsVolumeUpRegisterFailed.value = newState.shortcutsVolumeUpRegisterFailed;
  shortcutsVolumeDownRegisterFailed.value = newState.shortcutsVolumeDownRegisterFailed;

  companionServerAuthWindowEnabled.value = newState.companionServerAuthWindowEnabled;

  safeStorageAvailable.value = newState.safeStorageAvailable;

  autoUpdaterDisabled.value = newState.autoUpdaterDisabled;
});

async function memorySettingsChanged() {
  memoryStore.set("companionServerAuthWindowEnabled", companionServerAuthWindowEnabled.value);
}

async function settingsChanged() {
  store.set("general.closeAction", closeAction.value);
  store.set("general.hideToTrayOnClose", hideToTrayOnClose.value);
  store.set("general.minimizeAction", minimizeAction.value);
  store.set("general.showNotificationOnSongChange", showNotificationOnSongChange.value);
  store.set("general.startOnBoot", startOnBoot.value);
  store.set("general.startMinimized", startMinimized.value);
  store.set("general.disableHardwareAcceleration", disableHardwareAcceleration.value);

  store.set("appearance.alwaysShowVolumeSlider", alwaysShowVolumeSlider.value);
  store.set("appearance.customCSSEnabled", customCSSEnabled.value);
  store.set("appearance.playerLayout", playerLayout.value);
  store.set("appearance.topBarLayout", topBarLayout.value);
  store.set("appearance.vuMeterEnabled", vuMeterEnabled.value);
  store.set("appearance.vuMeterTheme", vuMeterTheme.value);
  store.set("appearance.vuMeterStyle", vuMeterStyle.value);
  store.set("appearance.zoom", zoom.value);
  store.set("appearance.trayIconStyle", trayIconStyle.value);

  store.set("playback.continueWhereYouLeftOff", continueWhereYouLeftOff.value);
  store.set("playback.continueWhereYouLeftOffPaused", continueWhereYouLeftOffPaused.value);
  store.set("playback.progressInTaskbar", progressInTaskbar.value);
  store.set("playback.enableSpeakerFill", enableSpeakerFill.value);
  store.set("playback.ratioVolume", ratioVolume.value);

  store.set("integrations.companionServerEnabled", companionServerEnabled.value);
  store.set("integrations.companionServerCORSWildcardEnabled", companionServerCORSWildcardEnabled.value);
  store.set("integrations.discordPresenceEnabled", discordPresenceEnabled.value);
  store.set("integrations.lastFMEnabled", lastFMEnabled.value);
  store.set("integrations.lightssEnabled", lightssEnabled.value);
  store.set("integrations.lightssReactiveEnabled", lightssReactiveEnabled.value);
  store.set("integrations.lightssHost", lightssHost.value);
  store.set("integrations.lightssAiProvider", lightssAiProvider.value);
  store.set("integrations.lightssOpenAIModel", lightssOpenAIModel.value);
  store.set("integrations.lightssOpenAIApiKey", lightssOpenAIApiKey.value?.trim() || null);
  store.set("integrations.lightssOpenAIRealtimeModel", lightssOpenAIRealtimeModel.value);
  store.set("integrations.lightssOpenAIRealtimeVoice", lightssOpenAIRealtimeVoice.value);
  store.set("integrations.lightssOpenAIAudioDirectorModel", lightssOpenAIAudioDirectorModel.value);
  store.set("integrations.lightssOpenRouterModel", lightssOpenRouterModel.value);
  store.set("integrations.lightssOpenRouterApiKey", lightssOpenRouterApiKey.value?.trim() || null);
  store.set("integrations.lightssOllamaBaseUrl", lightssOllamaBaseUrl.value);
  store.set("integrations.lightssOllamaModel", lightssOllamaModel.value);
  store.set("integrations.lightssGeminiApiKey", lightssGeminiApiKey.value?.trim() || null);
  store.set("integrations.lightssGeminiModel", lightssGeminiModel.value);
  store.set("integrations.lightssGeminiBaseUrl", lightssGeminiBaseUrl.value);
  store.set("integrations.lightssLyriaEnabled", lightssLyriaEnabled.value);
  store.set("integrations.lightssLyriaPrompt", lightssLyriaPrompt.value);
  store.set("integrations.lightssDjVoiceEnabled", lightssDjVoiceEnabled.value);
  store.set("integrations.lightssDjVoiceModel", lightssDjVoiceModel.value);
  store.set("integrations.lightssDjVoicePrompt", lightssDjVoicePrompt.value);
  store.set("integrations.lightssBridgePath", lightssBridgePath.value);
  store.set("integrations.lightssPythonPath", lightssPythonPath.value);
  store.set("integrations.lightssWledPrompt", lightssWledPrompt.value);
  store.set("integrations.lightssCanvasPrompt", lightssCanvasPrompt.value);
  store.set("integrations.lightssHostPrompt", lightssHostPrompt.value);
  store.set("integrations.lightssWledProvider", lightssWledProvider.value);
  store.set("integrations.lightssWledModel", lightssWledModel.value);
  store.set("integrations.lightssCanvasProvider", lightssCanvasProvider.value);
  store.set("integrations.lightssCanvasModel", lightssCanvasModel.value);
  store.set("integrations.lightssHostProvider", lightssHostProvider.value);
  store.set("integrations.lightssHostModel", lightssHostModel.value);
  store.set("integrations.lightssAnalystProvider", lightssAnalystProvider.value);
  store.set("integrations.lightssAnalystModel", lightssAnalystModel.value);
  store.set("integrations.lightssAnalystPrompt", lightssAnalystPrompt.value);
  store.set("integrations.lightssSketchProvider", lightssSketchProvider.value);
  store.set("integrations.lightssSketchModel", lightssSketchModel.value);
  store.set("integrations.lightssVisionEnabled", lightssVisionEnabled.value);
  store.set("integrations.lightssStepIntervalMs", Math.round(lightssStepIntervalSecs.value) * 1000);
  store.set("integrations.audioCompressorEnabled", audioCompressorEnabled.value);
  store.set("integrations.audioCompressorThreshold", audioCompressorThreshold.value);
  store.set("integrations.audioCompressorRatio", audioCompressorRatio.value);
  store.set("integrations.audioCompressorAttack", audioCompressorAttack.value);
  store.set("integrations.audioCompressorRelease", audioCompressorRelease.value);
  store.set("lastfm.scrobblePercent", scrobblePercent.value);

  store.set("shortcuts.playPause", shortcutPlayPause.value);
  store.set("shortcuts.next", shortcutNext.value);
  store.set("shortcuts.previous", shortcutPrevious.value);
  store.set("shortcuts.thumbsUp", shortcutThumbsUp.value);
  store.set("shortcuts.thumbsDown", shortcutThumbsDown.value);
  store.set("shortcuts.volumeUp", shortcutVolumeUp.value);
  store.set("shortcuts.volumeDown", shortcutVolumeDown.value);
}

const isImproving = ref<Record<string, boolean>>({
  wled: false,
  canvas: false,
  host: false,
  analyst: false,
  lyria: false,
  dj: false
});

async function improvePrompt(field: "wled" | "canvas" | "host" | "analyst" | "lyria" | "dj") {
  let currentPrompt = "";
  if (field === "wled") currentPrompt = lightssWledPrompt.value || "";
  else if (field === "canvas") currentPrompt = lightssCanvasPrompt.value || "";
  else if (field === "host") currentPrompt = lightssHostPrompt.value || "";
  else if (field === "analyst") currentPrompt = lightssAnalystPrompt.value || "";
  else if (field === "lyria") currentPrompt = lightssLyriaPrompt.value || "";
  else if (field === "dj") currentPrompt = lightssDjVoicePrompt.value || "";

  if (!currentPrompt.trim()) {
    alert("Please enter a base prompt first so we can improve it!");
    return;
  }

  isImproving.value[field] = true;

  const improveInstruction = `You are an expert prompt engineer. Revise, refine, and improve the following agent system prompt to make it highly descriptive, detailed, premium, and effective for an AI system.
CRITICAL rules you must preserve:
- For WLED: MUST keep rules about absolutely no strobing, flashing, blinking. Long transitions (transitionMs >= 900) are required. Use only safe effect and palette IDs.
- For TV Canvas: MUST keep rules about keeping background true black (#000000) for screen protection and maximum contrast, and absolutely no strobing or flashing. Colors must be elegant.
- For Scrolling/VJ: Keep late-night VJ personality, concise fact/commentary lines under 140 characters.

Return ONLY the final revised and improved prompt text. Do NOT add conversational filler, do NOT add introductory or concluding remarks, do NOT wrap the output in quotes. Return the plain text prompt directly.

Here is the prompt to improve:
"${currentPrompt}"`;

  try {
    let improvedText = "";
    const provider = lightssAiProvider.value;

    if (provider === LightssAiProvider.Ollama) {
      const url = `${lightssOllamaBaseUrl.value}/api/generate`;
      const response = await window.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: lightssOllamaModel.value,
          prompt: improveInstruction,
          stream: false
        })
      });
      if (!response.ok) throw new Error(`Ollama API error: ${response.statusText}`);
      const data = await response.json();
      improvedText = data.response || data.text || "";
    } else if (provider === LightssAiProvider.OpenAI) {
      const apiKey = lightssOpenAIApiKey.value || "";
      const url = "https://api.openai.com/v1/chat/completions";
      const response = await window.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: lightssOpenAIModel.value,
          messages: [{ role: "user", content: improveInstruction }],
          temperature: 0.7
        })
      });
      if (!response.ok) throw new Error(`OpenAI API error: ${response.statusText}`);
      const data = await response.json();
      improvedText = data.choices?.[0]?.message?.content || "";
    } else if (provider === LightssAiProvider.OpenRouter) {
      const apiKey = lightssOpenRouterApiKey.value || "";
      const url = "https://openrouter.ai/v1/chat/completions";
      const response = await window.fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: lightssOpenRouterModel.value,
          messages: [{ role: "user", content: improveInstruction }],
          temperature: 0.7
        })
      });
      if (!response.ok) throw new Error(`OpenRouter API error: ${response.statusText}`);
      const data = await response.json();
      improvedText = data.choices?.[0]?.message?.content || "";
    } else if (provider === LightssAiProvider.Gemini) {
      const apiKey = lightssGeminiApiKey.value || "";
      const url = `${lightssGeminiBaseUrl.value}/models/${lightssGeminiModel.value}:generateContent?key=${apiKey}`;
      const response = await window.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: improveInstruction }]
            }
          ]
        })
      });
      if (!response.ok) throw new Error(`Gemini API error: ${response.statusText}`);
      const data = await response.json();
      improvedText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }

    improvedText = improvedText.trim();
    if (improvedText) {
      if (improvedText.startsWith('"') && improvedText.endsWith('"')) {
        improvedText = improvedText.slice(1, -1).trim();
      }
      if (field === "wled") lightssWledPrompt.value = improvedText;
      else if (field === "canvas") lightssCanvasPrompt.value = improvedText;
      else if (field === "host") lightssHostPrompt.value = improvedText;
      else if (field === "analyst") lightssAnalystPrompt.value = improvedText;
      else if (field === "lyria") lightssLyriaPrompt.value = improvedText;
      else if (field === "dj") lightssDjVoicePrompt.value = improvedText;
      settingsChanged();
    } else {
      alert("Could not retrieve improved prompt from the AI provider. Please check model and key settings.");
    }
  } catch (e) {
    console.error("Failed to improve prompt:", e);
    alert(`Failed to improve prompt: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    isImproving.value[field] = false;
  }
}

async function settingChangedRequiresRestart() {
  requiresRestart.value = true;
  settingsChanged();
}

async function settingChangedFile(event: Event) {
  const target = event.target as HTMLInputElement;

  const setting = target.dataset.setting;
  if (!setting) {
    throw new Error("No setting specified in File Input");
  }

  store.set(setting, target.files.length > 0 ? window.ytmd.getTrueFilePath(target.files[0]) : null);

  target.value = null;
}

async function restartDiscordPresence() {
  discordPresenceEnabled.value = false;
  await settingsChanged();
  discordPresenceEnabled.value = true;
  await settingsChanged();
}

async function deleteCompanionAuthToken(appId: string) {
  const index = companionServerAuthTokens.value.findIndex(token => token.appId === appId);
  if (index > -1) {
    companionServerAuthTokens.value.splice(index, 1);
  }

  if (safeStorageAvailable.value)
    store.set("integrations.companionServerAuthTokens", await safeStorage.encryptString(JSON.stringify(companionServerAuthTokens.value)));
}

function removeCustomCSSPath() {
  store.set("appearance.customCSSPath", null);
}

function regenerateTvControlPin() {
  const pin = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  companionServerTvControlPin.value = pin;
  store.set("integrations.companionServerTvControlPin", pin);
}

function changeTab(newTab: number) {
  currentTab.value = newTab;
}

function restartApplication() {
  window.ytmd.restartApplication();
}

function restartApplicationForUpdate() {
  window.ytmd.restartApplicationForUpdate();
}

function checkForUpdates() {
  window.ytmd.checkForUpdates();
  checkingForUpdate.value = true;
}

async function logoutLastFM() {
  store.set("lastfm.sessionKey", null);
  lastFMEnabled.value = false;
  lastFMSessionKey.value = null;
  await settingsChanged();
}

window.ytmd.handleCheckingForUpdate(() => {
  checkingForUpdate.value = true;
});

window.ytmd.handleUpdateAvailable(() => {
  checkingForUpdate.value = false;
  updateAvailable.value = true;
  updateNotAvailable.value = false;
});

window.ytmd.handleUpdateNotAvailable(() => {
  checkingForUpdate.value = false;
  updateNotAvailable.value = true;
  updateAvailable.value = false;
});

window.ytmd.handleUpdateDownloaded(() => {
  checkingForUpdate.value = false;
  updateNotAvailable.value = false;
  updateAvailable.value = false;
  updateDownloaded.value = true;
});
</script>

<template>
  <div class="settings-container">
    <div class="content-container">
      <ul class="sidebar">
        <li :class="{ active: currentTab === 1 }" @click="changeTab(1)"><span class="material-symbols-outlined">settings_applications</span>General</li>
        <li :class="{ active: currentTab === 2 }" @click="changeTab(2)"><span class="material-symbols-outlined">brush</span>Appearance</li>
        <li :class="{ active: currentTab === 3 }" @click="changeTab(3)"><span class="material-symbols-outlined">music_note</span>Playback</li>
        <li :class="{ active: currentTab === 4 }" @click="changeTab(4)"><span class="material-symbols-outlined">wifi_tethering</span>Integrations</li>
        <li :class="{ active: currentTab === 5 }" @click="changeTab(5)"><span class="material-symbols-outlined">keyboard</span>Shortcuts</li>
        <li :class="{ active: currentTab === 6 }" @click="changeTab(6)"><span class="material-symbols-outlined">psychology</span>AI & Audio</li>
        <span class="push"></span>
        <li :class="{ active: currentTab === 99 }" @click="changeTab(99)"><span class="material-symbols-outlined">info</span>About</li>
      </ul>
      <div class="content">
        <div v-if="requiresRestart" class="restart-banner">
          <p class="message"><span class="material-symbols-outlined">autorenew</span> Restart app to apply changes</p>
          <button class="restart-button" @click="restartApplication">Restart</button>
        </div>
        <div v-if="currentTab === 1" class="general-tab">
          <YTMDSetting
            v-model="closeAction"
            :options-map="{ [CloseAction.MiniPlayer]: 'Mini-player', [CloseAction.Tray]: 'Tray', [CloseAction.Quit]: 'Quit' }"
            type="select"
            name="Close action"
            description="Choose what happens when the main window is closed"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-model="minimizeAction"
            :options-map="{ [MinimizeAction.MiniPlayer]: 'Mini-player', [MinimizeAction.Taskbar]: 'Taskbar' }"
            type="select"
            name="Minimize action"
            description="Choose what happens when the main window is minimized"
            @change="settingsChanged"
          />
          <YTMDSetting v-if="!isDarwin" v-model="hideToTrayOnClose" type="checkbox" name="Hide to tray on close" @change="settingsChanged" />
          <YTMDSetting v-model="showNotificationOnSongChange" type="checkbox" name="Show notification on song change" @change="settingsChanged" />
          <YTMDSetting v-model="startOnBoot" type="checkbox" name="Start on boot" @change="settingsChanged" />
          <!--<div class="setting">
            <p>Start minimized</p>
            <input v-model="startMinimized" @change="settingsChanged" class="toggle" type="checkbox" />
          </div>-->
          <YTMDSetting
            v-model="disableHardwareAcceleration"
            type="checkbox"
            restart-required
            name="Disable hardware acceleration"
            @change="settingChangedRequiresRestart"
          />
        </div>

        <div v-if="currentTab === 2" class="appearance-tab">
          <YTMDSetting
            v-model="topBarLayout"
            :options-map="{ [TopBarLayout.Command]: 'Command', [TopBarLayout.TwoLevel]: 'Two-Level' }"
            type="select"
            name="Top bar layout"
            description="Choose between a dense icon bar and a larger two-level workspace bar"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-model="playerLayout"
            :options-map="{
              [PlayerLayout.CompactDock]: 'Compact Dock',
              [PlayerLayout.ExpandedStrip]: 'Expanded Strip',
              [PlayerLayout.ControlConsole]: 'Control Console',
              [PlayerLayout.FullscreenVu]: 'Fullscreen VU'
            }"
            type="select"
            name="Player layout"
            description="Choose the native player surface shown around YouTube Music"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-model="vuMeterEnabled"
            type="checkbox"
            name="VU meter"
            description="Show native meter animation in player controls"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-if="vuMeterEnabled"
            v-model="vuMeterTheme"
            :options-map="{
              [VuMeterTheme.Default]: 'Default',
              [VuMeterTheme.Classic]: 'Classic',
              [VuMeterTheme.Ocean]: 'Ocean',
              [VuMeterTheme.Fire]: 'Fire',
              [VuMeterTheme.Mono]: 'Mono',
              [VuMeterTheme.Neon]: 'Neon'
            }"
            type="select"
            name="VU meter theme"
            description="Color theme for the audio level meter"
            indented
            @change="settingsChanged"
          />
          <YTMDSetting
            v-if="vuMeterEnabled"
            v-model="vuMeterStyle"
            :options-map="{
              [VuMeterStyle.Bars]: 'Bars',
              [VuMeterStyle.ClassicLed]: 'Classic LED',
              [VuMeterStyle.DotMatrix]: 'Dot matrix',
              [VuMeterStyle.SpectrumLine]: 'Spectrum line',
              [VuMeterStyle.AlbumGlow]: 'Album glow'
            }"
            type="select"
            name="VU meter style"
            description="Switch the meter shape used by the desktop shell and TV fallback"
            indented
            @change="settingsChanged"
          />
          <YTMDSetting v-model="alwaysShowVolumeSlider" type="checkbox" name="Always show volume slider" @change="settingsChanged" />
          <YTMDSetting v-model="customCSSEnabled" type="checkbox" name="Custom CSS" @change="settingsChanged" />
          <YTMDSetting
            v-if="customCSSEnabled"
            v-model="customCSSPath"
            type="file"
            indented
            bind-setting="appearance.customCSSPath"
            name="Custom CSS file path"
            @file-change="settingChangedFile"
            @clear="removeCustomCSSPath"
          />
          <YTMDSetting v-model="zoom" type="range" max="300" min="30" step="10" name="Zoom" @change="settingsChanged" />
          <YTMDSetting
            v-if="isLinux"
            v-model="trayIconStyle"
            :options-map="{ [TrayIconStyle.Auto]: 'Auto', [TrayIconStyle.White]: 'White', [TrayIconStyle.Black]: 'Black' }"
            type="select"
            name="Tray icon style"
            @change="settingsChanged"
          />
        </div>

        <div v-if="currentTab === 3" class="playback-tab">
          <YTMDSetting v-model="continueWhereYouLeftOff" name="Continue where you left off" type="checkbox" @change="settingsChanged" />
          <YTMDSetting
            v-if="continueWhereYouLeftOff"
            v-model="continueWhereYouLeftOffPaused"
            type="checkbox"
            indented
            name="Pause on application launch"
            @change="settingsChanged"
          />
          <YTMDSetting v-model="progressInTaskbar" type="checkbox" name="Show track progress on taskbar" @change="settingsChanged" />
          <YTMDSetting v-model="enableSpeakerFill" type="checkbox" restart-required name="Enable speaker fill" @change="settingChangedRequiresRestart" />
          <YTMDSetting v-model="ratioVolume" type="checkbox" name="Ratio volume" @change="settingsChanged" />
        </div>

        <div v-if="currentTab === 4" class="integrations-tab">
          <YTMDSetting
            v-model="companionServerEnabled"
            type="checkbox"
            name="Companion server"
            :disabled="!safeStorageAvailable"
            disabled-message="This integration cannot be enabled due to safeStorage being unavailable"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            v-model="companionServerCORSWildcardEnabled"
            type="checkbox"
            indented
            name="Allow browser communication"
            description="This setting could be dangerous as it allows any website you visit to communicate with the companion server"
            @change="settingsChanged"
          />
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            type="custom"
            indented
            name="TV control PIN"
            description="Required on the TV page to send playback commands or start DJ-GPT voice. Enter this PIN once on the TV when prompted."
          >
            <div class="tv-control-pin">
              <span class="pin-value">{{ companionServerTvControlPin ?? "Not generated yet" }}</span>
              <button @click="regenerateTvControlPin">Regenerate</button>
            </div>
          </YTMDSetting>
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            v-model="companionServerAuthWindowEnabled"
            type="checkbox"
            indented
            name="Enable companion authorization"
            description="Automatically disables after the first successful authorization or 5 minutes has passed"
            @change="memorySettingsChanged"
          />
          <YTMDSetting
            v-if="companionServerEnabled && safeStorageAvailable"
            type="custom"
            flex-column
            indented
            name="Authorized companions"
            description="This is a list of companions that currently have access to the companion server"
            @change="settingsChanged"
          >
            <table class="authorized-companions-table">
              <thead>
                <tr>
                  <th class="companion">Companion</th>
                  <th class="version">Version</th>
                  <th class="controls"></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="authToken in companionServerAuthTokens" :key="authToken.appId">
                  <td class="companion">
                    <span class="name">{{ authToken.appName }}</span
                    ><br />
                    <span class="id">{{ authToken.appId }}</span>
                  </td>
                  <td class="version">{{ authToken.appVersion }}</td>
                  <td class="controls">
                    <button @click="deleteCompanionAuthToken(authToken.appId)"><span class="material-symbols-outlined">delete</span></button>
                  </td>
                </tr>
              </tbody>
            </table>
            <div v-if="companionServerAuthTokens.length === 0" class="no-authorized-companions">
              <td>No authorized companions</td>
            </div>
          </YTMDSetting>
          <YTMDSetting v-model="discordPresenceEnabled" type="checkbox" name="Discord rich presence" @change="settingsChanged" />
          <div v-if="discordPresenceEnabled && discordPresenceConnectionFailed" class="setting indented">
            <p class="discord-failure">Discord connection could not be established after 30 attempts</p>
            <button @click="restartDiscordPresence">Retry</button>
          </div>
          <YTMDSetting
            v-model="lastFMEnabled"
            type="checkbox"
            name="Last.fm scrobbling"
            :disabled="!safeStorageAvailable"
            disabled-message="This integration cannot be enabled due to safeStorage being unavailable"
            @change="settingsChanged"
          />
          <div v-if="lastFMEnabled" class="setting indented">
            <div class="name-with-description">
              <p class="description">
                User is Authenticated:
                <span v-if="lastFMSessionKey" style="color: #4caf50">Yes</span>
                <span v-else style="color: #ff1100">No</span>
              </p>
            </div>
            <button v-if="lastFMSessionKey" @click="logoutLastFM">Logout</button>
          </div>
          <YTMDSetting
            v-if="lastFMEnabled"
            v-model="scrobblePercent"
            class="settings indented"
            type="range"
            name="Scrobble percent"
            description="Determines when a song is scrobbled"
            min="50"
            max="95"
            step="5"
            @change="settingsChanged"
          />
          <div class="hint-box">
            <span class="material-symbols-outlined hint-icon">psychology</span>
            <div class="name-with-description">
              <p class="name">AI & Audio settings have moved</p>
              <p class="description">
                Looking for WLED, AI planners, custom prompts, or the studio compressor? Head over to the dedicated AI & Audio tab in the sidebar!
              </p>
            </div>
            <button @click="changeTab(6)">Go to AI & Audio</button>
          </div>
        </div>

        <div v-if="currentTab === 5" class="shortcuts-tab">
          <div class="setting">
            <p class="shortcut-title">
              Play/Pause<span
                v-if="shortcutsPlayPauseRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutPlayPause" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Next<span
                v-if="shortcutsNextRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutNext" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Previous<span
                v-if="shortcutsPreviousRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutPrevious" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Thumbs Up<span
                v-if="shortcutsThumbsUpRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutThumbsUp" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Thumbs Down<span
                v-if="shortcutsThumbsDownRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutThumbsDown" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Increase Volume<span
                v-if="shortcutsVolumeUpRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutVolumeUp" @change="settingsChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Decrease Volume<span
                v-if="shortcutsVolumeDownRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutVolumeDown" @change="settingsChanged" />
          </div>
        </div>

        <div v-if="currentTab === 6" class="ai-audio-tab">
          <!-- Section 1: AI Planner Settings -->
          <div class="settings-section">
            <h3 class="section-title"><span class="material-symbols-outlined">psychology</span> AI Planner & WLED</h3>
            <p class="section-subtitle">Configure AI providers, keys, endpoints, and behavioral prompts for agentic ambient lighting.</p>

            <YTMDSetting v-model="lightssEnabled" type="checkbox" name="Enable Lightss Integration" @change="settingsChanged" />

            <div v-if="lightssEnabled" class="settings-group">
              <YTMDSetting
                v-model="lightssReactiveEnabled"
                type="checkbox"
                name="Automatic lightshow"
                description="Rotate safe non-strobe WLED effects while music is playing"
                indented
                @change="settingsChanged"
              />
              <YTMDSetting v-model="lightssHost" type="text" name="WLED host" description="URL of the WLED controller" indented @change="settingsChanged" />
              <YTMDSetting
                v-model="lightssAiProvider"
                :options-map="{
                  [LightssAiProvider.Ollama]: 'Ollama',
                  [LightssAiProvider.OpenRouter]: 'OpenRouter',
                  [LightssAiProvider.OpenAI]: 'OpenAI',
                  [LightssAiProvider.Gemini]: 'Gemini'
                }"
                type="select"
                name="Lightss AI provider"
                description="Choose which AI plans the WLED lightshow"
                indented
                @change="settingsChanged"
              />

              <!-- Ollama Provider Settings -->
              <div v-if="lightssAiProvider === LightssAiProvider.Ollama">
                <YTMDSetting
                  v-model="lightssOllamaBaseUrl"
                  type="text"
                  name="Ollama base URL"
                  description="Base URL for the Ollama-compatible planner"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssOllamaModel"
                  type="text"
                  name="Ollama model"
                  description="Model used to plan WLED scenes"
                  indented
                  @change="settingsChanged"
                />
              </div>

              <!-- OpenRouter Provider Settings -->
              <div v-if="lightssAiProvider === LightssAiProvider.OpenRouter">
                <YTMDSetting
                  v-model="lightssOpenRouterModel"
                  type="text"
                  name="OpenRouter model"
                  description="Model used to plan WLED scenes through OpenRouter"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssOpenRouterApiKey"
                  type="text"
                  name="OpenRouter API key"
                  description="Optional; otherwise OPENROUTER_API_KEY from the app environment is used"
                  indented
                  @change="settingsChanged"
                />
              </div>

              <!-- OpenAI Provider Settings -->
              <div v-if="lightssAiProvider === LightssAiProvider.OpenAI">
                <YTMDSetting
                  v-model="lightssOpenAIModel"
                  type="text"
                  name="OpenAI model"
                  description="Model used to plan WLED scenes"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssOpenAIRealtimeModel"
                  type="text"
                  name="DJ-GPT realtime model"
                  description="Realtime voice model for the TV DJ session"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssOpenAIRealtimeVoice"
                  type="text"
                  name="DJ-GPT voice"
                  description="Realtime voice used by the TV DJ session"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssOpenAIAudioDirectorModel"
                  type="text"
                  name="Audio director model"
                  description="Model used for fades, sets, search planning, and playlist direction"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssOpenAIApiKey"
                  type="text"
                  name="OpenAI API key"
                  description="Optional; otherwise OPENAI_API_KEY from the app environment is used"
                  indented
                  @change="settingsChanged"
                />
              </div>

              <!-- Gemini Provider Settings -->
              <div v-if="lightssAiProvider === LightssAiProvider.Gemini">
                <YTMDSetting
                  v-model="lightssGeminiModel"
                  type="text"
                  name="Gemini model"
                  description="Model used to plan WLED scenes"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssGeminiBaseUrl"
                  type="text"
                  name="Gemini base URL"
                  description="Base URL for Gemini API endpoint (defaults to Google)"
                  indented
                  @change="settingsChanged"
                />
                <YTMDSetting
                  v-model="lightssGeminiApiKey"
                  type="text"
                  name="Gemini API key"
                  description="Optional; otherwise GEMINI_API_KEY from the app environment is used"
                  indented
                  @change="settingsChanged"
                />
              </div>

              <!-- Agent Prompts Section -->
              <div class="prompts-container indented">
                <div class="prompt-header">
                  <h4>Custom Agent Prompts</h4>
                  <p class="prompt-desc">Fine-tune the behaviors, rules, and personalities of the agentic television setup.</p>
                </div>

                <!-- 1. Music Analyst & Coordinator Agent -->
                <div class="agent-config-block">
                  <h4 class="agent-title">
                    <span class="material-symbols-outlined">insights</span>
                    Music Analyst &amp; Coordinator Agent
                  </h4>
                  <p class="agent-desc">Analyzes track details, genre, and emotion to output a central visual concept that aligns the other agents.</p>

                  <YTMDSetting
                    v-model="lightssAnalystProvider"
                    :options-map="{
                      [LightssAiProvider.Ollama]: 'Ollama',
                      [LightssAiProvider.OpenRouter]: 'OpenRouter',
                      [LightssAiProvider.OpenAI]: 'OpenAI',
                      [LightssAiProvider.Gemini]: 'Gemini'
                    }"
                    type="select"
                    name="Provider"
                    @change="settingsChanged"
                  />
                  <YTMDSetting v-model="lightssAnalystModel" type="text" name="Model" @change="settingsChanged" />
                  <p class="agent-desc">Provider and model are unused — only the custom prompt below applies (prepended to each agent).</p>

                  <div class="prompt-field">
                    <div class="prompt-field-header">
                      <label for="analyst-prompt">System Prompt</label>
                      <button
                        class="improve-prompt-btn"
                        :class="{ 'is-loading': isImproving.analyst }"
                        :disabled="isImproving.analyst"
                        title="Revise and improve prompt using active AI"
                        @click="improvePrompt('analyst')"
                      >
                        <span class="material-symbols-outlined">{{ isImproving.analyst ? "sync" : "bolt" }}</span>
                        <span>{{ isImproving.analyst ? "Improving..." : "Improve" }}</span>
                      </button>
                    </div>
                    <textarea
                      id="analyst-prompt"
                      v-model="lightssAnalystPrompt"
                      rows="4"
                      placeholder="Coordination guidance, music analysis criteria..."
                      @change="settingsChanged"
                    ></textarea>
                  </div>
                </div>

                <hr class="agent-separator" />

                <!-- 1b. Sketch Agent -->
                <div class="agent-config-block">
                  <h4 class="agent-title">
                    <span class="material-symbols-outlined">bolt</span>
                    Sketch Agent <span class="agent-hint">fires immediately on song change</span>
                  </h4>
                  <p class="agent-desc">Produces an immediate fast draft of the visual concept on song change, before the full analyst pipeline runs.</p>

                  <YTMDSetting
                    v-model="lightssSketchProvider"
                    :options-map="{
                      [LightssAiProvider.Ollama]: 'Ollama',
                      [LightssAiProvider.OpenRouter]: 'OpenRouter',
                      [LightssAiProvider.OpenAI]: 'OpenAI',
                      [LightssAiProvider.Gemini]: 'Gemini'
                    }"
                    type="select"
                    name="Provider"
                    @change="settingsChanged"
                  />
                  <YTMDSetting v-model="lightssSketchModel" type="text" name="Model" @change="settingsChanged" />
                  <YTMDSetting
                    v-model="lightssVisionEnabled"
                    type="checkbox"
                    name="Album art vision input"
                    description="Send album art thumbnail to the sketch agent for visual inspiration"
                    @change="settingsChanged"
                  />
                  <YTMDSetting
                    v-model.number="lightssStepIntervalSecs"
                    type="range"
                    name="Step interval (seconds)"
                    description="How often the pipeline re-runs during a track"
                    min="3"
                    max="30"
                    step="1"
                    @change="settingsChanged"
                  />
                </div>

                <hr class="agent-separator" />

                <!-- 2. WLED Control Agent -->
                <div class="agent-config-block">
                  <h4 class="agent-title">
                    <span class="material-symbols-outlined">tungsten</span>
                    WLED Control Agent
                  </h4>
                  <p class="agent-desc">Translates the central visual concept into real-time aesthetic colors and safe, non-strobing WLED effects.</p>

                  <YTMDSetting
                    v-model="lightssWledProvider"
                    :options-map="{
                      [LightssAiProvider.Ollama]: 'Ollama',
                      [LightssAiProvider.OpenRouter]: 'OpenRouter',
                      [LightssAiProvider.OpenAI]: 'OpenAI',
                      [LightssAiProvider.Gemini]: 'Gemini'
                    }"
                    type="select"
                    name="Provider"
                    @change="settingsChanged"
                  />
                  <YTMDSetting v-model="lightssWledModel" type="text" name="Model" @change="settingsChanged" />

                  <div class="prompt-field">
                    <div class="prompt-field-header">
                      <label for="wled-prompt">System Prompt</label>
                      <button
                        class="improve-prompt-btn"
                        :class="{ 'is-loading': isImproving.wled }"
                        :disabled="isImproving.wled"
                        title="Revise and improve prompt using active AI"
                        @click="improvePrompt('wled')"
                      >
                        <span class="material-symbols-outlined">{{ isImproving.wled ? "sync" : "bolt" }}</span>
                        <span>{{ isImproving.wled ? "Improving..." : "Improve" }}</span>
                      </button>
                    </div>
                    <textarea
                      id="wled-prompt"
                      v-model="lightssWledPrompt"
                      rows="4"
                      placeholder="WLED lighting behavior, transition times, colors..."
                      @change="settingsChanged"
                    ></textarea>
                  </div>
                </div>

                <hr class="agent-separator" />

                <!-- 3. TV Canvas Agent -->
                <div class="agent-config-block">
                  <h4 class="agent-title">
                    <span class="material-symbols-outlined">tv</span>
                    TV Canvas Agent
                  </h4>
                  <p class="agent-desc">Renders gorgeous reactive visualizers, art designs, and theme elements on a true black base.</p>

                  <YTMDSetting
                    v-model="lightssCanvasProvider"
                    :options-map="{
                      [LightssAiProvider.Ollama]: 'Ollama',
                      [LightssAiProvider.OpenRouter]: 'OpenRouter',
                      [LightssAiProvider.OpenAI]: 'OpenAI',
                      [LightssAiProvider.Gemini]: 'Gemini'
                    }"
                    type="select"
                    name="Provider"
                    @change="settingsChanged"
                  />
                  <YTMDSetting v-model="lightssCanvasModel" type="text" name="Model" @change="settingsChanged" />

                  <div class="prompt-field">
                    <div class="prompt-field-header">
                      <label for="canvas-prompt">System Prompt</label>
                      <button
                        class="improve-prompt-btn"
                        :class="{ 'is-loading': isImproving.canvas }"
                        :disabled="isImproving.canvas"
                        title="Revise and improve prompt using active AI"
                        @click="improvePrompt('canvas')"
                      >
                        <span class="material-symbols-outlined">{{ isImproving.canvas ? "sync" : "bolt" }}</span>
                        <span>{{ isImproving.canvas ? "Improving..." : "Improve" }}</span>
                      </button>
                    </div>
                    <textarea
                      id="canvas-prompt"
                      v-model="lightssCanvasPrompt"
                      rows="4"
                      placeholder="Screen visual layout, theme, contrast rules..."
                      @change="settingsChanged"
                    ></textarea>
                  </div>
                </div>

                <hr class="agent-separator" />

                <!-- 4. VJ Host Agent -->
                <div class="agent-config-block">
                  <h4 class="agent-title">
                    <span class="material-symbols-outlined">forum</span>
                    VJ Host Agent
                  </h4>
                  <p class="agent-desc">Generates late-night DJ rolling ticker comments, facts, and artist trivia in concise lines.</p>

                  <YTMDSetting
                    v-model="lightssHostProvider"
                    :options-map="{
                      [LightssAiProvider.Ollama]: 'Ollama',
                      [LightssAiProvider.OpenRouter]: 'OpenRouter',
                      [LightssAiProvider.OpenAI]: 'OpenAI',
                      [LightssAiProvider.Gemini]: 'Gemini'
                    }"
                    type="select"
                    name="Provider"
                    @change="settingsChanged"
                  />
                  <YTMDSetting v-model="lightssHostModel" type="text" name="Model" @change="settingsChanged" />

                  <div class="prompt-field">
                    <div class="prompt-field-header">
                      <label for="host-prompt">System Prompt</label>
                      <button
                        class="improve-prompt-btn"
                        :class="{ 'is-loading': isImproving.host }"
                        :disabled="isImproving.host"
                        title="Revise and improve prompt using active AI"
                        @click="improvePrompt('host')"
                      >
                        <span class="material-symbols-outlined">{{ isImproving.host ? "sync" : "bolt" }}</span>
                        <span>{{ isImproving.host ? "Improving..." : "Improve" }}</span>
                      </button>
                    </div>
                    <textarea
                      id="host-prompt"
                      v-model="lightssHostPrompt"
                      rows="4"
                      placeholder="VJ personality, rolling ticker facts, music notes..."
                      @change="settingsChanged"
                    ></textarea>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Section 2: Premium AI Audio Integrations (Lyria & DJ Voice) -->
          <div class="settings-section">
            <h3 class="section-title"><span class="material-symbols-outlined">queue_music</span> Realtime Lyria & DJ Voice</h3>
            <p class="section-subtitle">Enable live background music/jingle synthesis via Lyria and a dynamic AI radio DJ voice model.</p>

            <YTMDSetting
              v-model="lightssLyriaEnabled"
              type="checkbox"
              name="Enable Realtime Lyria Jingles"
              description="Synth lo-fi or jazz jingles during breaks"
              @change="settingsChanged"
            />
            <div v-if="lightssLyriaEnabled" class="settings-group indented">
              <div class="prompt-field">
                <div class="prompt-field-header">
                  <label for="lyria-prompt">Lyria Jingle Prompt / Style</label>
                  <button
                    class="improve-prompt-btn"
                    :class="{ 'is-loading': isImproving.lyria }"
                    :disabled="isImproving.lyria"
                    title="Revise and improve prompt using active AI"
                    @click="improvePrompt('lyria')"
                  >
                    <span class="material-symbols-outlined">{{ isImproving.lyria ? "sync" : "bolt" }}</span>
                    <span>{{ isImproving.lyria ? "Improving..." : "Improve" }}</span>
                  </button>
                </div>
                <textarea
                  id="lyria-prompt"
                  v-model="lightssLyriaPrompt"
                  rows="3"
                  placeholder="Describe the mood, instruments, or genre of generated jingles..."
                  @change="settingsChanged"
                ></textarea>
              </div>
            </div>

            <YTMDSetting
              v-model="lightssDjVoiceEnabled"
              type="checkbox"
              name="Enable DJ Voice Model"
              description="A text-to-speech voice model that speaks VJ lines"
              @change="settingsChanged"
            />
            <div v-if="lightssDjVoiceEnabled" class="settings-group indented">
              <YTMDSetting
                v-model="lightssDjVoiceModel"
                type="text"
                name="DJ Voice model/ID"
                description="ID of the voice model (e.g. ElevenLabs, Google Journey-F, OpenAI alloy)"
                @change="settingsChanged"
              />
              <div class="prompt-field">
                <div class="prompt-field-header">
                  <label for="dj-voice-prompt">DJ Voice Persona / System Prompt</label>
                  <button
                    class="improve-prompt-btn"
                    :class="{ 'is-loading': isImproving.dj }"
                    :disabled="isImproving.dj"
                    title="Revise and improve prompt using active AI"
                    @click="improvePrompt('dj')"
                  >
                    <span class="material-symbols-outlined">{{ isImproving.dj ? "sync" : "bolt" }}</span>
                    <span>{{ isImproving.dj ? "Improving..." : "Improve" }}</span>
                  </button>
                </div>
                <textarea
                  id="dj-voice-prompt"
                  v-model="lightssDjVoicePrompt"
                  rows="3"
                  placeholder="DJ persona, mood, length constraints..."
                  @change="settingsChanged"
                ></textarea>
              </div>
            </div>
          </div>

          <!-- Section 2: Studio Compressor Settings -->
          <div class="settings-section audio-tools-section">
            <h3 class="section-title"><span class="material-symbols-outlined">equalizer</span> Studio Dynamics Compressor</h3>
            <p class="section-subtitle">
              A high-quality dynamics processor in the audio analyzer pipeline. Actively limits signal peaks to deliver perfectly smoothed, premium TV
              visualizer performance with zero bounce or jitter.
            </p>

            <YTMDSetting v-model="audioCompressorEnabled" type="checkbox" name="Enable Compressor Node" @change="settingsChanged" />

            <div v-if="audioCompressorEnabled" class="compressor-panel indented">
              <div class="compressor-grid">
                <!-- Threshold -->
                <div class="compressor-control">
                  <div class="control-header">
                    <span class="control-name">Threshold</span>
                    <span class="control-value">{{ audioCompressorThreshold }} dB</span>
                  </div>
                  <input
                    v-model.number="audioCompressorThreshold"
                    type="range"
                    min="-60"
                    max="0"
                    step="1"
                    class="compressor-slider"
                    @change="settingsChanged"
                  />
                  <span class="control-desc">Audio level where compression begins. Lower values equal more compressed signal.</span>
                </div>

                <!-- Ratio -->
                <div class="compressor-control">
                  <div class="control-header">
                    <span class="control-name">Ratio</span>
                    <span class="control-value">{{ audioCompressorRatio }}:1</span>
                  </div>
                  <input v-model.number="audioCompressorRatio" type="range" min="1" max="20" step="1" class="compressor-slider" @change="settingsChanged" />
                  <span class="control-desc">Compression intensity. A ratio of 12:1 acts as a powerful peak-limiting wall.</span>
                </div>

                <!-- Attack -->
                <div class="compressor-control">
                  <div class="control-header">
                    <span class="control-name">Attack Time</span>
                    <span class="control-value">{{ Math.round(audioCompressorAttack * 1000) }} ms</span>
                  </div>
                  <input
                    v-model.number="audioCompressorAttack"
                    type="range"
                    min="0.001"
                    max="0.1"
                    step="0.001"
                    class="compressor-slider"
                    @change="settingsChanged"
                  />
                  <span class="control-desc">Time taken to reduce gain. Lower is faster, ideal for crisp peak catching.</span>
                </div>

                <!-- Release -->
                <div class="compressor-control">
                  <div class="control-header">
                    <span class="control-name">Release Time</span>
                    <span class="control-value">{{ Math.round(audioCompressorRelease * 1000) }} ms</span>
                  </div>
                  <input
                    v-model.number="audioCompressorRelease"
                    type="range"
                    min="0.01"
                    max="1.0"
                    step="0.01"
                    class="compressor-slider"
                    @change="settingsChanged"
                  />
                  <span class="control-desc">Time taken to return to normal gain. Slower release prevents visual 'pumping' effect.</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="currentTab === 99" class="about-tab">
          <img class="icon" :src="logo" />
          <h2 class="app-name">Youtopia</h2>
          <p class="made-by">Personal fork of YouTube Music Desktop App</p>
          <template v-if="!autoUpdaterDisabled">
            <button
              v-if="!updateDownloaded"
              :disabled="!(!checkingForUpdate && !updateAvailable && !updateDownloaded)"
              class="update-check-button"
              @click="checkForUpdates"
            >
              <span class="material-symbols-outlined">update</span>Check for updates
            </button>
            <button v-if="updateDownloaded" class="update-button" @click="restartApplicationForUpdate">
              <span class="material-symbols-outlined">upgrade</span>Restart to update
            </button>
            <p v-if="checkingForUpdate && !updateAvailable && !updateDownloaded" class="updating">
              <span class="material-symbols-outlined">progress_activity</span>Checking for updates...
            </p>
            <p v-if="updateAvailable && !updateDownloaded" class="updating">
              <span class="material-symbols-outlined">progress_activity</span>Downloading update...
            </p>
            <p v-if="updateNotAvailable" class="no-update">Update not available</p>
          </template>
          <template v-if="autoUpdaterDisabled">
            <button disabled class="update-check-button"><span class="material-symbols-outlined">update</span>Check for updates</button>
            <p class="no-auto-updater">Auto updater disabled</p>
          </template>
          <span class="version-info">
            <p class="version">Version: {{ ytmdVersion }}</p>
            <p class="branch">Branch: {{ ytmdBranch }}</p>
            <p class="commit">Commit: {{ ytmdCommitHash }}</p>
          </span>
          <div class="links">
            <a href="https://github.com/ruca-radio/youtopia" target="_blank">GitHub</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  user-select: none;
}

.content-container {
  display: flex;
  height: 100%;
}

.content {
  overflow: auto;
  flex-grow: 1;
  padding: 4px 16px;
}

.content::-webkit-scrollbar {
  width: 12px;
}

.content::-webkit-scrollbar-track {
  background: #212121;
}

.content::-webkit-scrollbar-thumb {
  background-color: #414141;
}

.sidebar {
  width: 25%;
  min-width: 25%;
  list-style-type: none;
  margin: unset;
  padding: unset;
  height: 100%;
  border-right: 1px solid #212121;
  display: flex;
  flex-direction: column;
}

.sidebar li {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  color: #bbbbbb;
}

.sidebar li .material-symbols-outlined {
  font-size: 28px;
  font-variation-settings:
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 28;
}

.sidebar li:hover {
  background-color: #111111;
}

.sidebar li.active {
  background-color: #212121;
  color: #eeeeee;
}

.sidebar li .material-symbols-outlined {
  margin-right: 8px;
}

.sidebar .push {
  flex-grow: 1;
}

.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting.indented {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid #212121;
}

.name-with-description .name {
  margin-bottom: unset;
}

.name-with-description .description {
  margin-top: 4px;
  color: #969696;
}

.about-tab {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  height: 100%;
}

.icon {
  width: 128px;
  height: 128px;
  margin-bottom: 16px;
}

.app-name {
  margin: 0;
}

.version-info .version,
.version-info .branch,
.version-info .commit {
  margin: 4px 0;
  color: #bbbbbb;
}

.made-by {
  margin: 16px 0;
}

.links {
  margin-top: 32px;
  width: 100%;
  display: flex;
  justify-content: space-evenly;
}

.links a {
  color: #bbbbbb;
}

.restart-banner {
  background-color: #f44336;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.restart-banner .message {
  display: flex;
  align-items: center;
}

.restart-banner .message .material-symbols-outlined {
  margin: 0 8px;
}

.restart-banner .restart-button {
  margin: 0 8px;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.update-check-button {
  display: flex;
  align-items: center;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button:disabled {
  border: 1px solid #888888;
  cursor: not-allowed;
}

.updating,
.no-update {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.no-auto-updater {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.updating .material-symbols-outlined {
  animation: rotation 1s infinite linear;
}

@keyframes rotation {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(359deg);
  }
}

.update-button {
  display: flex;
  align-items: center;
  background-color: #f44336;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button .material-symbols-outlined,
.updating .material-symbols-outlined,
.update-button .material-symbols-outlined {
  margin-right: 4px;
}

.version-info {
  user-select: text;
}

.setting.disabled {
  color: #c6c6c6;
}

.authorized-companions-table {
  width: 100%;
  table-layout: fixed;
}

.authorized-companions-table tr .companion {
  width: 70%;
  word-wrap: break-word;
}

.authorized-companions-table tr .companion .id {
  color: #969696;
  font-size: 14px;
}

.authorized-companions-table tbody tr .version {
  word-wrap: break-word;
}

.authorized-companions-table tr th,
.authorized-companions-table tr td {
  padding: 4px;
}

.authorized-companions-table th {
  text-align: left;
}

.authorized-companions-table thead tr th {
  border-bottom: 1px solid #212121;
}
.authorized-companions-table thead tr .controls {
  width: 48px;
}

.authorized-companions-table tbody button {
  border-radius: 4px;
  padding: 4px;
  display: flex;
  align-items: center;
  background-color: #212121;
  cursor: pointer;
  border: none;
}

.no-authorized-companions {
  color: #bbbbbb;
  padding: 4px;
}

.tv-control-pin {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tv-control-pin .pin-value {
  font-family: monospace;
  font-size: 16px;
  letter-spacing: 0.15em;
  background-color: #212121;
  border-radius: 4px;
  padding: 6px 10px;
}

.tv-control-pin button {
  border-radius: 4px;
  padding: 6px 10px;
  background-color: #212121;
  cursor: pointer;
  border: none;
  color: inherit;
}

.discord-failure {
  margin: 0;
  color: #969696;
}

button {
  margin: 3px 3px 3px 4px;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  background-color: #212121;
  cursor: pointer;
  border: none;
}

.shortcuts-tab .shortcut-title {
  display: flex;
  justify-content: center;
  align-items: center;
}

.shortcuts-tab .shortcut-title .register-error {
  margin-left: 4px;
  color: #f44336;
}

/* AI & Audio custom styling */
.ai-audio-tab {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 16px 0;
}

.settings-section {
  border-bottom: 1px solid #212121;
  padding-bottom: 24px;
}

.settings-section:last-of-type {
  border-bottom: none;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 500;
  color: #eeeeee;
  margin: 0 0 4px 0;
}

.section-title .material-symbols-outlined {
  color: hsl(265, 80%, 65%);
  font-size: 24px;
}

.section-subtitle {
  color: #969696;
  font-size: 13px;
  margin: 0 0 16px 0;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompts-container {
  background-color: #0b0b0b;
  border-radius: 8px;
  border: 1px solid #1a1a1a;
  padding: 16px;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.prompt-header h4 {
  margin: 0 0 4px 0;
  color: #eeeeee;
  font-size: 14px;
}

.prompt-header .prompt-desc {
  color: #888888;
  font-size: 12px;
  margin: 0;
}

.prompt-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.prompt-field-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.improve-prompt-btn {
  background: none;
  border: 1px solid #1f1f1f;
  border-radius: 4px;
  color: hsl(265, 85%, 70%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.improve-prompt-btn:hover:not(:disabled) {
  background-color: hsl(265, 60%, 15%);
  border-color: hsl(265, 80%, 45%);
  color: hsl(265, 95%, 85%);
}

.improve-prompt-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.improve-prompt-btn .material-symbols-outlined {
  font-size: 14px;
}

.improve-prompt-btn.is-loading .material-symbols-outlined {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  100% {
    transform: rotate(360deg);
  }
}

.prompt-field label {
  color: #bbbbbb;
  font-size: 13px;
  font-weight: 500;
}

.prompt-field textarea {
  background-color: #121212;
  color: #e0e0e0;
  border: 1px solid #262626;
  border-radius: 6px;
  padding: 10px;
  font-family: "Fira Code", "Courier New", monospace;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.prompt-field textarea:focus {
  border-color: hsl(265, 60%, 50%);
  box-shadow: 0 0 0 2px rgba(138, 75, 241, 0.15);
}

.agent-config-block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: #0d0d0d;
  border-radius: 6px;
  border: 1px solid #141414;
  padding: 14px;
}

.agent-title {
  margin: 0;
  color: hsl(265, 85%, 80%);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}

.agent-title .material-symbols-outlined {
  font-size: 16px;
}

.agent-desc {
  margin: 0 0 4px 0;
  color: #a0a0a0;
  font-size: 11px;
}

.agent-separator {
  border: 0;
  border-top: 1px solid #1f1f1f;
  margin: 12px 0;
}

/* Audio Compressor Panel */
.compressor-panel {
  background-color: #0b0b0b;
  border-radius: 8px;
  border: 1px solid #1a1a1a;
  padding: 20px;
  margin-top: 12px;
}

.compressor-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
}

.compressor-control {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.control-name {
  color: #eeeeee;
  font-size: 13px;
  font-weight: 500;
}

.control-value {
  color: hsl(265, 85%, 70%);
  font-family: monospace;
  font-size: 13px;
  font-weight: 600;
}

.compressor-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  background: #212121;
  outline: none;
  margin: 4px 0;
}

.compressor-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: hsl(265, 80%, 65%);
  cursor: pointer;
  transition:
    transform 0.1s ease,
    background 0.1s ease;
}

.compressor-slider::-webkit-slider-thumb:hover {
  transform: scale(1.15);
  background: hsl(265, 90%, 70%);
}

.control-desc {
  color: #888888;
  font-size: 11px;
  line-height: 1.4;
}

/* Integrations hint box */
.hint-box {
  background-color: #0b0b0b;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
}

.hint-icon {
  font-size: 32px;
  color: hsl(265, 80%, 65%);
}

.hint-box button {
  background-color: hsl(265, 60%, 30%);
  border: 1px solid hsl(265, 60%, 45%);
  color: #eeeeee;
  border-radius: 6px;
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.2s ease,
    border-color 0.2s ease;
}

.hint-box button:hover {
  background-color: hsl(265, 65%, 35%);
  border-color: hsl(265, 70%, 55%);
}
</style>
