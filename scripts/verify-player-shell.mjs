import fs from "fs";
import path from "path";

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function assertIncludes(file, text) {
  const content = read(file);
  if (!content.includes(text)) {
    throw new Error(`${file} does not include ${JSON.stringify(text)}`);
  }
}

function assertNotIncludes(file, text) {
  const content = read(file);
  if (content.includes(text)) {
    throw new Error(`${file} must not include ${JSON.stringify(text)}`);
  }
}

function assertFile(file) {
  if (!fs.existsSync(path.join(root, file))) {
    throw new Error(`${file} does not exist`);
  }
}

const schema = "src/shared/store/schema.ts";
assertIncludes(schema, "export enum TopBarLayout");
assertIncludes(schema, "export enum PlayerLayout");
assertIncludes(schema, "FullscreenVu = 3");
assertIncludes(schema, "export enum LightssAiProvider");
assertIncludes(schema, 'Ollama = "ollama"');
assertIncludes(schema, 'OpenRouter = "openrouter"');
assertIncludes(schema, "export enum CloseAction");
assertIncludes(schema, "export enum MinimizeAction");
assertIncludes(schema, "topBarLayout: TopBarLayout;");
assertIncludes(schema, "playerLayout: PlayerLayout;");
assertIncludes(schema, "vuMeterEnabled: boolean;");
assertIncludes(schema, "export enum VuMeterStyle");
assertIncludes(schema, "AlbumGlow = 4");
assertIncludes(schema, "vuMeterStyle: VuMeterStyle;");
assertIncludes(schema, "lightssAiProvider: LightssAiProvider;");
assertIncludes(schema, "lightssOpenAIModel: string;");
assertIncludes(schema, "lightssOpenAIApiKey: string | null;");
assertIncludes(schema, "lightssOpenRouterModel: string;");
assertIncludes(schema, "lightssOpenRouterApiKey: string | null;");
assertIncludes(schema, "lightssOllamaBaseUrl: string;");
assertIncludes(schema, "lightssOllamaModel: string;");
assertIncludes(schema, "closeAction: CloseAction;");
assertIncludes(schema, "minimizeAction: MinimizeAction;");

const main = "src/main/index.ts";
assertIncludes(main, "topBarLayout: TopBarLayout.TwoLevel");
assertIncludes(main, "playerLayout: PlayerLayout.ExpandedStrip");
assertIncludes(main, "vuMeterEnabled: true");
assertIncludes(main, "vuMeterStyle: VuMeterStyle.Bars");
assertIncludes(main, 'app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");');
assertIncludes(main, "closeAction: CloseAction.MiniPlayer");
assertIncludes(main, "minimizeAction: MinimizeAction.MiniPlayer");
assertIncludes(main, 'mainWindow.webContents.send("settings:stateChanged", newState, oldState);');
assertIncludes(main, 'mainWindow.webContents.send("lightss:aiMessage"');
assertIncludes(main, "lightss.onAiMessage(message =>");

const settings = "src/renderer/windows/settings/Settings.vue";
assertIncludes(settings, "TopBarLayout");
assertIncludes(settings, "PlayerLayout");
assertIncludes(settings, "LightssAiProvider");
assertIncludes(settings, "CloseAction");
assertIncludes(settings, "MinimizeAction");
assertIncludes(settings, "topBarLayout");
assertIncludes(settings, "playerLayout");
assertIncludes(settings, "[PlayerLayout.FullscreenVu]: 'Fullscreen VU'");
assertIncludes(settings, "vuMeterEnabled");
assertIncludes(settings, "vuMeterStyle");
assertIncludes(settings, "[VuMeterStyle.AlbumGlow]: 'Album glow'");
assertIncludes(settings, "integrations.lightssEnabled ?? false");
assertIncludes(settings, "integrations.lightssReactiveEnabled ?? true");
assertIncludes(settings, 'integrations.lightssHost ?? "http://10.27.27.110"');
assertIncludes(settings, "integrations.lightssAiProvider ?? LightssAiProvider.Ollama");
assertIncludes(settings, 'integrations.lightssOpenAIModel ?? "gpt-5.5"');
assertIncludes(settings, "integrations.lightssOpenAIApiKey ?? null");
assertIncludes(settings, 'integrations.lightssOpenAIRealtimeModel ?? "gpt-realtime-2"');
assertIncludes(settings, 'integrations.lightssOpenAIRealtimeVoice ?? "marin"');
assertIncludes(settings, 'integrations.lightssOpenAIAudioDirectorModel ?? "gpt-5.5"');
assertIncludes(settings, 'integrations.lightssOpenRouterModel ?? "openrouter/free"');
assertIncludes(settings, "integrations.lightssOpenRouterApiKey ?? null");
assertIncludes(settings, 'integrations.lightssOllamaBaseUrl ?? "http://10.27.27.10:11434"');
assertIncludes(settings, 'integrations.lightssOllamaModel ?? "kimi-k2.7-code:cloud"');
assertIncludes(settings, "integrations.lightssBridgePath ?? null");
assertIncludes(settings, "integrations.lightssPythonPath ?? null");
assertIncludes(settings, "closeAction");
assertIncludes(settings, "minimizeAction");

const components = [
  "src/renderer/windows/main/player-shell/types.ts",
  "src/renderer/windows/main/player-shell/IconButton.vue",
  "src/renderer/windows/main/player-shell/MiniPlayer.vue",
  "src/renderer/windows/main/player-shell/SystemStatusPill.vue",
  "src/renderer/windows/main/player-shell/VuMeter.vue",
  "src/renderer/windows/main/player-shell/PlayerProgress.vue",
  "src/renderer/windows/main/player-shell/NowPlayingInfo.vue",
  "src/renderer/windows/main/player-shell/CommandTopBar.vue",
  "src/renderer/windows/main/player-shell/TwoLevelTopBar.vue",
  "src/renderer/windows/main/player-shell/CompactDockPlayer.vue",
  "src/renderer/windows/main/player-shell/FullscreenVuPlayer.vue",
  "src/renderer/windows/main/player-shell/ExpandedStripPlayer.vue",
  "src/renderer/windows/main/player-shell/ControlConsolePlayer.vue"
];

for (const component of components) {
  assertFile(component);
}

const preload = "src/renderer/windows/main/preload.ts";
assertIncludes(preload, "playerControl");
assertIncludes(preload, "openMiniPlayer");
assertIncludes(preload, "restoreFromMiniPlayer");
assertIncludes(preload, "focusSearch");
assertIncludes(preload, "getPlayerState");
assertIncludes(preload, "onPlayerStateChanged");
assertIncludes(preload, "onLightssAiMessage");

assertIncludes("src/shared/player.ts", "export type RendererPlayerState");
assertIncludes("src/shared/player.ts", "export type RendererLightssVuStyle");
assertIncludes("src/shared/player.ts", "albumArtMode: \"off\" | \"corner\" | \"hero\" | \"ambient\";");
assertIncludes("src/shared/player.ts", "vuStyle: RendererLightssVuStyle;");
assertIncludes("src/shared/player.ts", "export type RendererLightssAiMessage");
assertIncludes("src/shared/player.ts", 'aiStatus?: "idle" | "planning" | "connected" | "failed";');
assertIncludes("src/shared/player.ts", 'wledStatus?: "unknown" | "connected" | "failed";');
assertIncludes("src/shared/player.ts", 'lightStatus?: "idle" | "applied" | "failed";');
assertIncludes("src/shared/player.ts", "displayTheme?: RendererLightssDisplayTheme;");
assertIncludes("src/shared/player.ts", "export type RendererLightssVisualScene");
assertIncludes("src/shared/player.ts", "visualScene?: RendererLightssVisualScene;");
assertIncludes("src/shared/player.ts", "tickerMessage?: string;");
assertIncludes("src/shared/player.ts", "hostLine?: string;");
assertIncludes("src/main/index.ts", 'ipcMain.handle("playerState:get"');
assertIncludes("src/main/index.ts", 'mainWindow.webContents.send("playerState:stateChanged"');
assertIncludes("src/main/index.ts", "let audioAnalyzerSubscribed = false;");
assertIncludes("src/main/index.ts", 'ytmView.webContents.send("audioAnalyzer:control", "start");');
assertIncludes("src/main/index.ts", "updateTvAudioData(frequencyData);");
assertIncludes("src/main/index.ts", "updateTvLightssMessage(message);");
assertIncludes("src/main/index.ts", "function enterMiniPlayerMode()");
assertIncludes("src/main/index.ts", "function restoreMainWindowMode()");
assertIncludes("src/main/index.ts", "PlayerLayout.FullscreenVu");
assertIncludes("src/main/index.ts", "height: 0");
assertNotIncludes("src/main/index.ts", "lightss.handleAudioData(frequencyData);");
assertIncludes("src/main/index.ts", 'lightssHost: "http://10.27.27.110"');
assertIncludes("src/main/integrations/lightss/index.ts", 'const DEFAULT_WLED_HOST = "http://10.27.27.110";');
assertIncludes("src/main/integrations/lightss/index.ts", 'const DEFAULT_OPENAI_MODEL = "gpt-5.5";');
assertIncludes("src/main/integrations/lightss/index.ts", 'const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-2";');
assertIncludes("src/main/integrations/lightss/index.ts", "djGptRealtime");
assertIncludes("src/main/integrations/lightss/index.ts", 'const DEFAULT_OPENROUTER_MODEL = "openrouter/free";');
assertIncludes("src/main/integrations/lightss/index.ts", "https://openrouter.ai/api/v1/chat/completions");
assertIncludes("src/main/integrations/lightss/index.ts", 'const DEFAULT_OLLAMA_BASE_URL = "http://10.27.27.10:11434";');
assertIncludes("src/main/integrations/lightss/index.ts", 'const DEFAULT_OLLAMA_MODEL = "kimi-k2.7-code:cloud";');
assertIncludes("src/main/integrations/lightss/index.ts", "https://api.openai.com/v1/responses");
assertIncludes("src/main/integrations/lightss/index.ts", "/api/generate");
assertIncludes("src/main/integrations/lightss/index.ts", "requestAiLightshowPlan");
assertIncludes("src/main/integrations/lightss/index.ts", "requestOpenRouterLightshowPlan");
assertIncludes("src/main/integrations/lightss/index.ts", "buildOpenRouterLightshowContext");
assertIncludes("src/main/integrations/lightss/index.ts", "requestOllamaLightshowPlan");
assertIncludes("src/main/integrations/lightss/index.ts", "emitAiMessage");
assertIncludes("src/main/integrations/lightss/index.ts", "aiPlanRetryAfter");
assertIncludes("src/main/integrations/lightss/index.ts", "OPENAI_API_KEY");
assertIncludes("src/main/integrations/lightss/index.ts", "OPENROUTER_API_KEY");
assertIncludes("src/main/integrations/lightss/index.ts", "AI WLED lightshow");
assertIncludes("src/main/integrations/lightss/index.ts", "SAFE_EFFECTS");
assertIncludes("src/main/integrations/lightss/index.ts", "postWledState");
assertIncludes("src/main/integrations/lightss/index.ts", "getWledSnapshotEndpoint");
assertIncludes("src/main/integrations/lightss/index.ts", 'state: await this.getWledSnapshotEndpoint("/json/state")');
assertIncludes("src/main/integrations/lightss/index.ts", 'info: await this.getWledSnapshotEndpoint("/json/info")');
assertIncludes("src/main/integrations/lightss/index.ts", 'effects: await this.getWledSnapshotEndpoint("/json/effects")');
assertIncludes("src/main/integrations/lightss/index.ts", 'palettes: await this.getWledSnapshotEndpoint("/json/palettes")');
assertIncludes("src/main/integrations/lightss/index.ts", 'config: await this.getWledSnapshotEndpoint("/json/cfg")');
assertIncludes("src/main/integrations/lightss/index.ts", 'fxdata: await this.getWledSnapshotEndpoint("/json/fxdata")');
assertIncludes("src/main/integrations/lightss/index.ts", 'networks: await this.getWledSnapshotEndpoint("/json/net")');
assertIncludes("src/main/integrations/lightss/index.ts", "optional WLED snapshot endpoint failed");
assertIncludes("src/main/integrations/lightss/index.ts", "displayTheme");
assertIncludes("src/main/integrations/lightss/index.ts", "visualScene");
assertIncludes("src/main/integrations/lightss/index.ts", "tickerMessage");
assertIncludes("src/main/integrations/lightss/index.ts", "hostLine");
assertIncludes("src/main/integrations/lightss/index.ts", "audioProfile");
assertIncludes("src/main/integrations/lightss/index.ts", "hostPersonality");
assertIncludes("src/main/integrations/lightss/index.ts", "late-night VJ");
assertIncludes("src/main/integrations/lightss/index.ts", "progressPercent");
assertIncludes("src/main/integrations/lightss/index.ts", "albumArtAvailable");
assertIncludes("src/main/integrations/lightss/index.ts", "getLatestTvAudioProfile");
assertIncludes("src/main/integrations/lightss/index.ts", "fun song facts");
assertIncludes("src/main/integrations/lightss/index.ts", "safe TV host persona");
assertIncludes("src/main/integrations/lightss/index.ts", "sanitizeDisplayTheme");
assertIncludes("src/main/integrations/lightss/index.ts", "displayThemeFromAiStep");
assertIncludes("src/main/integrations/lightss/index.ts", "currentDisplayTheme = appliedDisplayTheme");
assertIncludes("src/main/integrations/lightss/index.ts", "vuHighColor: primary");
assertIncludes("src/main/integrations/lightss/index.ts", "vuMidColor: this.blendHexColors(primary, secondary)");
assertIncludes("src/main/integrations/lightss/index.ts", "sanitizeVisualScene");
assertIncludes("src/main/integrations/lightss/index.ts", '"classicLed"');
assertIncludes("src/main/integrations/lightss/index.ts", '"albumGlow"');
assertIncludes("src/main/integrations/lightss/index.ts", "albumArtMode");
assertIncludes("src/main/integrations/lightss/index.ts", "soften flash and transition intensity");
assertIncludes("src/main/integrations/lightss/index.ts", "noAbruptMidSongArtifactColorChanges");
assertIncludes("src/main/integrations/lightss/index.ts", "Do not make abrupt color changes to TV artifacts");
assertIncludes("src/main/integrations/lightss/index.ts", "roomLighting");
assertIncludes("src/main/integrations/lightss/index.ts", "ambient bias lighting");
assertNotIncludes("src/main/integrations/lightss/index.ts", "buildLightshowPayload");
assertNotIncludes("src/main/integrations/lightss/index.ts", "DEFAULT_LIGHTCTL");
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv/state"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv/events"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv/audio"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv/audio/status"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv/program"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.post("/tv/control"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.get("/tv/provider-logo/:provider"');
assertIncludes("src/main/integrations/companion-server/index.ts", "createTvAudioStream");
assertIncludes("src/main/integrations/companion-server/index.ts", "createTvProgramStream");
assertIncludes("src/main/integrations/companion-server/index.ts", "getTvAudioStatus");
assertIncludes("src/main/integrations/companion-server/index.ts", "getProviderLogoPath");
assertIncludes("src/main/integrations/companion-server/index.ts", "providerName");
assertIncludes("src/main/integrations/companion-server/index.ts", "requestAnimationFrame(render)");
assertIncludes("src/main/integrations/companion-server/index.ts", "status-lights");
assertIncludes("src/main/integrations/companion-server/index.ts", "status-light");
assertIncludes("src/main/integrations/companion-server/index.ts", "setStatusLight");
assertIncludes("src/main/integrations/companion-server/index.ts", "updateTextIfChanged");
assertIncludes("src/main/integrations/companion-server/index.ts", "lastAppliedStateSignature");
assertIncludes("src/main/integrations/companion-server/index.ts", "lastAlbumArtUrl");
assertIncludes("src/main/integrations/companion-server/index.ts", "VU_SMOOTHING_ATTACK");
assertIncludes("src/main/integrations/companion-server/index.ts", "VU_SMOOTHING_RELEASE");
assertIncludes("src/main/integrations/companion-server/index.ts", 'this.fastifyServer.post("/tv/dj-gpt/session"');
assertIncludes("src/main/integrations/companion-server/index.ts", "talk to the post");
assertIncludes("src/main/integrations/companion-server/index.ts", "gpt-realtime-2");
assertIncludes("src/main/integrations/companion-server/index.ts", "ambient bias light");
assertIncludes("src/main/integrations/companion-server/index.ts", 'id="djGptConnect"');
assertIncludes("src/main/integrations/companion-server/index.ts", "RTCPeerConnection");
assertIncludes("src/main/integrations/companion-server/index.ts", 'fetch("/tv/dj-gpt/session"');
assertIncludes("src/main/integrations/companion-server/index.ts", "Youtopia TV");
assertIncludes("src/main/integrations/companion-server/index.ts", "getTvReceiverHtml");
assertIncludes("src/main/integrations/companion-server/index.ts", '<video id="program"');
assertIncludes("src/main/integrations/companion-server/index.ts", "Server output live: audio and video in one feed");
assertIncludes("src/main/integrations/companion-server/index.ts", '<audio id="tvAudio"');
assertIncludes("src/main/integrations/companion-server/index.ts", "Connect audio");
assertIncludes("src/main/integrations/companion-server/index.ts", "syncTvAudioStatus");
assertIncludes("src/main/integrations/companion-server/index.ts", 'id="ticker"');
assertIncludes("src/main/integrations/companion-server/index.ts", "tickerMessage");
assertIncludes("src/main/integrations/companion-server/index.ts", "@keyframes tickerScroll");
assertIncludes("src/main/integrations/companion-server/index.ts", "normalizeTvDirector");
assertIncludes("src/main/integrations/companion-server/index.ts", "deriveTvDirector");
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily: "ribbons"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "halos"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "orbits"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "spectrumField"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "albumGlow"');
assertIncludes("src/main/integrations/companion-server/index.ts", "showHud");
assertIncludes("src/main/integrations/companion-server/index.ts", "scheduleHudHide");
assertIncludes("src/main/integrations/companion-server/index.ts", 'body.classList.add("hud-visible")');
assertIncludes("src/main/integrations/companion-server/index.ts", 'body.classList.add("hud-idle")');
assertIncludes("src/main/integrations/companion-server/index.ts", "registerTvInputActivity");
assertIncludes("src/main/integrations/companion-server/index.ts", "maybeAutoRecoverAudio");
assertIncludes("src/main/integrations/companion-server/index.ts", "preferredAudioFormat = getPreferredAudioFormat()");
assertIncludes("src/main/integrations/companion-server/index.ts", "fallbackToMp3Audio");
assertNotIncludes("src/main/integrations/companion-server/index.ts", "setInterval(function flash");
assertIncludes("src/main/integrations/companion-server/index.ts", "icon-button");
assertIncludes("src/main/integrations/companion-server/index.ts", "sr-only");
assertIncludes("src/main/integrations/companion-server/index.ts", "Decrease audio delay");
assertIncludes("src/main/integrations/companion-server/index.ts", "Increase audio delay");
assertIncludes("src/main/integrations/companion-server/index.ts", "Play or pause");
assertIncludes("src/main/integrations/companion-server/index.ts", "setButtonLabel");
assertIncludes("src/main/integrations/companion-server/index.ts", "sendTvControl");
assertIncludes("src/main/integrations/companion-server/index.ts", "allowedTvCommands");
assertIncludes("src/main/integrations/companion-server/index.ts", "audioDelayMs");
assertIncludes("src/main/integrations/companion-server/index.ts", "activeTvAudioStop");
assertIncludes("src/main/integrations/companion-server/index.ts", "scheduleDelayedAudioConnect");
assertIncludes("src/main/integrations/companion-server/index.ts", "disconnectTvAudio");
assertIncludes("src/main/integrations/companion-server/index.ts", 'window.addEventListener("pagehide", disconnectTvAudio);');
assertIncludes("src/main/integrations/companion-server/index.ts", 'fetch("/tv/audio/status", { cache: "no-store" })');
assertIncludes("src/main/integrations/companion-server/index.ts", 'audioConnect.addEventListener("click", scheduleDelayedAudioConnect);');
assertIncludes("src/main/integrations/companion-server/index.ts", "tvAudio.play()");
assertIncludes("src/main/integrations/companion-server/index.ts", "getPreferredAudioFormat");
assertIncludes("src/main/integrations/companion-server/index.ts", 'canPlayType("audio/webm; codecs=opus")');
assertIncludes("src/main/integrations/companion-server/index.ts", 'request.raw.on("close"');
assertFile("src/main/integrations/companion-server/tv-audio-stream.ts");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", "export function createTvAudioStream");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", "export function createTvProgramStream");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", "video/webm");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", "showwaves");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", "drawtext");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"libvpx"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", "export function getTvAudioStatus");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-probesize"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-analyzeduration"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-cluster_time_limit"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"40"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"wpctl"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"@DEFAULT_AUDIO_SINK@"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"node.name"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", 'source + ".monitor"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", 'spawn("ffmpeg"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"ffmpeg"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"pulse"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"audio/mpeg"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"audio/webm"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"libopus"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-fflags"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"nobuffer"');
assertIncludes("src/main/integrations/companion-server/index.ts", "applyDisplayTheme");
assertIncludes("src/main/integrations/companion-server/index.ts", "applyVisualScene");
assertIncludes("src/main/integrations/companion-server/index.ts", 'id="albumArt"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'id="albumArtBackdrop"');
assertIncludes("src/main/integrations/companion-server/index.ts", "albumArtMode");
assertIncludes("src/main/integrations/companion-server/index.ts", "data-vu-style");
assertIncludes("src/main/integrations/companion-server/index.ts", '<canvas id="scene"');
assertIncludes("src/main/integrations/companion-server/index.ts", "background: #000000");
assertIncludes("src/main/integrations/companion-server/index.ts", "--vu-low");
assertIncludes("src/main/integrations/companion-server/index.ts", "fontFamily");
assertIncludes("forge.config.ts", "./src/assets/provider-logos/openai.png");
assertIncludes("src/main/tv-display-state.ts", "getTvDisplayState");
assertIncludes("src/main/tv-display-state.ts", "updateTvAppearance");
assertIncludes("src/main/tv-display-state.ts", "albumArtUrl");
assertIncludes("src/main/tv-display-state.ts", "vuMeterStyle");
assertIncludes("src/main/tv-display-state.ts", "getLatestTvAudioProfile");
assertIncludes("src/main/tv-display-state.ts", "bass");
assertIncludes("src/main/tv-display-state.ts", "treble");
assertIncludes("src/main/integrations/companion-server/api/v1/index.ts", '"/audio-director/plan"');
assertIncludes("src/main/integrations/companion-server/api/v1/index.ts", "fadeVolume");
assertIncludes("src/main/integrations/companion-server/api/v1/index.ts", "buildPlaylist");
assertIncludes("src/main/integrations/companion-server/api/v1/index.ts", "program director");

const audioAnalyzer = "src/renderer/ytmview/scripts/audioanalyzer.script.js";
assertFile(audioAnalyzer);
assertIncludes(audioAnalyzer, "window.__YTMD_AUDIO_ANALYZER__ = { start, stop };");
assertIncludes(audioAnalyzer, "captureStream");
assertIncludes(audioAnalyzer, "createMediaStreamSource");
assertIncludes(audioAnalyzer, "disconnectAnalyzer();");
assertIncludes(audioAnalyzer, 'audioContext.state === "suspended"');
assertIncludes(audioAnalyzer, "window.ytmd.sendAudioData(Array.from(data));");
assertNotIncludes(audioAnalyzer, "window.__YTMD_AUDIO_ANALYZER__.start();");
assertNotIncludes(audioAnalyzer, "createMediaElementSource(mediaElement)");
assertNotIncludes(audioAnalyzer, "mediaElement.crossOrigin");

const vuMeter = "src/renderer/windows/main/player-shell/VuMeter.vue";
assertIncludes(vuMeter, "value > 0");
assertIncludes(vuMeter, "hasLiveAudioData");
assertIncludes(vuMeter, "variant?: \"compact\" | \"expanded\" | \"console\" | \"fullscreen\"");
assertIncludes(vuMeter, "style?: VuMeterStyle");
assertIncludes(vuMeter, "style-album-glow");
assertIncludes(vuMeter, "style-dot-matrix");
assertIncludes(vuMeter, "style-spectrum-line");
assertIncludes(vuMeter, "animated: false");
assertIncludes(vuMeter, ".vu-meter.fullscreen");
assertIncludes("src/renderer/windows/main/Index.vue", "lastAudioDataAt");
assertIncludes("src/renderer/windows/main/Index.vue", "lastNonZeroAudioDataAt");
assertIncludes("src/renderer/windows/main/Index.vue", "restartAudioAnalyzer");
assertIncludes("src/renderer/windows/main/Index.vue", "playerLayout");
assertIncludes("src/renderer/windows/main/Index.vue", "vuMeterStyle");
assertIncludes("src/renderer/windows/main/Index.vue", "thumbnailUrl");
assertIncludes("src/renderer/windows/main/Index.vue", "AUDIO_ANALYZER_STALE_MS");
assertIncludes("src/renderer/windows/main/Index.vue", "aiLightshowMessage");
assertIncludes("src/renderer/windows/main/Index.vue", "onLightssAiMessage");
assertIncludes("src/renderer/windows/main/Index.vue", "SystemStatusPill");
assertIncludes("src/renderer/windows/main/Index.vue", "Lights online");
assertIncludes("src/renderer/windows/main/Index.vue", "VU live");
assertIncludes("src/renderer/windows/main/player-shell/CommandTopBar.vue", 'slot name="system-status"');
assertIncludes("src/renderer/windows/main/player-shell/TwoLevelTopBar.vue", 'slot name="system-status"');
assertIncludes("src/renderer/windows/main/player-shell/SystemStatusPill.vue", "AI Lightshow");
assertIncludes("src/renderer/windows/main/player-shell/SystemStatusPill.vue", "lightsStatus");
assertIncludes("src/renderer/windows/main/player-shell/SystemStatusPill.vue", "chip");

const compactDock = "src/renderer/windows/main/player-shell/CompactDockPlayer.vue";
assertIncludes(compactDock, "132px");
assertIncludes(compactDock, 'variant="compact"');

console.log("Player shell verification passed");
