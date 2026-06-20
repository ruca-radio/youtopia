<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import YTMViewLoading from "../../components/YTMViewLoading.vue";
import { RendererLightssAiMessage, RendererPlayerState, RendererVideoState } from "~shared/player";
import { MemoryStoreSchema, PlayerLayout, StoreSchema, TopBarLayout, VuMeterStyle, VuMeterTheme } from "~shared/store/schema";
import CommandTopBar from "./player-shell/CommandTopBar.vue";
import CompactDockPlayer from "./player-shell/CompactDockPlayer.vue";
import ControlConsolePlayer from "./player-shell/ControlConsolePlayer.vue";
import ExpandedStripPlayer from "./player-shell/ExpandedStripPlayer.vue";
import FullscreenVuPlayer from "./player-shell/FullscreenVuPlayer.vue";
import IconButton from "./player-shell/IconButton.vue";
import MiniPlayer from "./player-shell/MiniPlayer.vue";
import SystemStatusPill from "./player-shell/SystemStatusPill.vue";
import TwoLevelTopBar from "./player-shell/TwoLevelTopBar.vue";
import { placeholderTrack, ShellActions, ShellTrack } from "./player-shell/types";

const keyboardFocus = ref<HTMLElement>(null);
const keyboardFocusZero = ref<HTMLElement>(null);
const topBarLayout = ref<TopBarLayout>(TopBarLayout.TwoLevel);
const playerLayout = ref<PlayerLayout>(PlayerLayout.ExpandedStrip);
const vuMeterEnabled = ref(true);
const vuMeterTheme = ref<VuMeterTheme>(VuMeterTheme.Default);
const vuMeterStyle = ref<VuMeterStyle>(VuMeterStyle.Bars);
const miniPlayer = ref(false);
const playerState = ref<RendererPlayerState | null>(null);
const audioData = ref<number[]>([]);
const aiLightshowMessage = ref<RendererLightssAiMessage | null>(null);
const lastAudioDataAt = ref(0);
const lastNonZeroAudioDataAt = ref(0);
const statusNow = ref(Date.now());
const AUDIO_ANALYZER_STALE_MS = 1200;
let audioAnalyzerRestartTimeout: ReturnType<typeof setTimeout> | null = null;
let statusClockInterval: ReturnType<typeof setInterval> | null = null;

const topBarComponent = computed(() => (topBarLayout.value === TopBarLayout.Command ? CommandTopBar : TwoLevelTopBar));
const playerComponent = computed(() => {
  switch (playerLayout.value) {
    case PlayerLayout.CompactDock:
      return CompactDockPlayer;
    case PlayerLayout.ControlConsole:
      return ControlConsolePlayer;
    case PlayerLayout.FullscreenVu:
      return FullscreenVuPlayer;
    case PlayerLayout.ExpandedStrip:
    default:
      return ExpandedStripPlayer;
  }
});

const shellClasses = computed(() => ({
  "main-shell": true,
  "mini-player-shell": miniPlayer.value,
  "command-top-bar": topBarLayout.value === TopBarLayout.Command,
  "two-level-top-bar": topBarLayout.value === TopBarLayout.TwoLevel,
  "compact-player": playerLayout.value === PlayerLayout.CompactDock,
  "expanded-player": playerLayout.value === PlayerLayout.ExpandedStrip,
  "console-player": playerLayout.value === PlayerLayout.ControlConsole,
  "fullscreen-vu-player": playerLayout.value === PlayerLayout.FullscreenVu
}));

const vuStatus = computed(() => {
  if (!vuMeterEnabled.value) return { label: "VU off", state: "idle" };
  if (!track.value.isPlaying) return { label: "VU idle", state: "idle" };
  if (audioData.value.some(value => value > 0) && statusNow.value - lastNonZeroAudioDataAt.value < 1500) {
    return { label: "VU live", state: "ok" };
  }
  return { label: "VU fallback", state: "warn" };
});

const aiStatus = computed(() => {
  const status = aiLightshowMessage.value?.aiStatus;
  if (status === "connected") return { label: "AI ready", state: "ok" };
  if (status === "planning") return { label: "AI planning", state: "busy" };
  if (status === "failed") return { label: "AI failed", state: "bad" };
  return { label: "AI idle", state: "idle" };
});

const wledStatus = computed(() => {
  const status = aiLightshowMessage.value?.wledStatus;
  if (status === "connected") return { label: "Lights online", state: "ok" };
  if (status === "failed") return { label: "Lights failed", state: "bad" };
  return { label: "Lights unknown", state: "idle" };
});

const lightStatus = computed(() => {
  const status = aiLightshowMessage.value?.lightStatus;
  if (status === "applied") return { label: "Scene live", state: "ok" };
  if (status === "failed") return { label: "Scene failed", state: "bad" };
  return { label: "Scene idle", state: "idle" };
});

const track = computed<ShellTrack>(() => {
  if (!playerState.value?.videoDetails) return placeholderTrack;

  const durationSeconds = playerState.value.videoDetails.durationSeconds;
  const progress = durationSeconds > 0 ? (playerState.value.videoProgress / durationSeconds) * 100 : 0;

  return {
    album: playerState.value.videoDetails.album ?? "",
    artist: playerState.value.videoDetails.artist || "Unknown artist",
    durationLabel: formatDuration(durationSeconds),
    isPlaying: playerState.value.trackState === RendererVideoState.Playing,
    progress,
    thumbnailUrl: getBestThumbnailUrl(playerState.value.videoDetails.thumbnails),
    title: playerState.value.videoDetails.title || "Unknown track",
    volume: playerState.value.volume
  };
});

const actions: ShellActions = {
  focusSearch: () => window.ytmd.focusSearch(),
  navigateHome: () => window.ytmd.ytmViewNavigateDefault(),
  next: () => window.ytmd.playerControl("next"),
  openMiniPlayer: () => window.ytmd.openMiniPlayer(),
  openSettings: () => window.ytmd.openSettingsWindow(),
  playPause: () => window.ytmd.playerControl("playPause"),
  previous: () => window.ytmd.playerControl("previous"),
  restoreFromMiniPlayer: () => window.ytmd.restoreFromMiniPlayer(),
  setPlayerLayout: (layout: PlayerLayout) => window.ytmd.store.set("appearance.playerLayout", layout),
  setTopBarLayout: (layout: TopBarLayout) => window.ytmd.store.set("appearance.topBarLayout", layout),
  toggleDislike: () => window.ytmd.playerControl("toggleDislike"),
  toggleLike: () => window.ytmd.playerControl("toggleLike"),
  volumeDown: () => window.ytmd.playerControl("volumeDown"),
  volumeUp: () => window.ytmd.playerControl("volumeUp")
};
const minimizeWindow = () => window.ytmd.minimizeWindow();
const maximizeWindow = () => window.ytmd.maximizeWindow();
const closeWindow = () => window.ytmd.closeWindow();

function syncAppearance(appearance: StoreSchema["appearance"]) {
  topBarLayout.value = appearance.topBarLayout ?? TopBarLayout.TwoLevel;
  playerLayout.value = appearance.playerLayout ?? PlayerLayout.ExpandedStrip;
  vuMeterEnabled.value = appearance.vuMeterEnabled ?? true;
  vuMeterTheme.value = appearance.vuMeterTheme ?? VuMeterTheme.Default;
  vuMeterStyle.value = appearance.vuMeterStyle ?? VuMeterStyle.Bars;
}

function syncMemoryState(memoryState: MemoryStoreSchema) {
  miniPlayer.value = memoryState.mainWindowMiniPlayer ?? false;
}

function formatDuration(totalSeconds: number) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "--:--";

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60)
    .toString()
    .padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function getBestThumbnailUrl(thumbnails: { height: number; url: string; width: number }[]) {
  if (!thumbnails.length) return "";
  return thumbnails.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.url ?? "";
}

function updateAudioAnalyzer() {
  if (vuMeterEnabled.value && track.value.isPlaying) {
    window.ytmd.startAudioAnalyzer();
    scheduleAudioAnalyzerStaleCheck();
  } else {
    clearAudioAnalyzerStaleCheck();
    window.ytmd.stopAudioAnalyzer();
    audioData.value = [];
    lastAudioDataAt.value = 0;
    lastNonZeroAudioDataAt.value = 0;
  }
}

function clearAudioAnalyzerStaleCheck() {
  if (audioAnalyzerRestartTimeout) {
    clearTimeout(audioAnalyzerRestartTimeout);
    audioAnalyzerRestartTimeout = null;
  }
}

function scheduleAudioAnalyzerStaleCheck() {
  clearAudioAnalyzerStaleCheck();

  audioAnalyzerRestartTimeout = setTimeout(() => {
    audioAnalyzerRestartTimeout = null;
    if (!vuMeterEnabled.value || !track.value.isPlaying) return;
    if (Date.now() - lastNonZeroAudioDataAt.value >= AUDIO_ANALYZER_STALE_MS) {
      restartAudioAnalyzer();
      return;
    }
    scheduleAudioAnalyzerStaleCheck();
  }, AUDIO_ANALYZER_STALE_MS);
}

function restartAudioAnalyzer() {
  clearAudioAnalyzerStaleCheck();
  window.ytmd.stopAudioAnalyzer();
  audioData.value = [];
  lastAudioDataAt.value = 0;
  lastNonZeroAudioDataAt.value = 0;

  setTimeout(() => {
    if (!vuMeterEnabled.value || !track.value.isPlaying) return;
    window.ytmd.startAudioAnalyzer();
    scheduleAudioAnalyzerStaleCheck();
  }, 100);
}

watch([vuMeterEnabled, () => track.value.isPlaying, playerLayout], updateAudioAnalyzer, { immediate: true });

onMounted(() => {
  window.onfocus = () => {
    if (document.activeElement != keyboardFocusZero.value) {
      // This resets the focus of keyboard navigation
      keyboardFocusZero.value.focus();
      keyboardFocusZero.value.blur();
    }
  };

  keyboardFocus.value.onfocus = () => {
    window.ytmd.switchFocus("ytm");
  };

  window.ytmd.requestWindowState();

  window.ytmd.store.get("appearance").then(syncAppearance);
  window.ytmd.store.onDidAnyChange(newState => {
    syncAppearance(newState.appearance);
  });
  window.ytmd.memoryStore.get("mainWindowMiniPlayer").then(value => {
    miniPlayer.value = value ?? false;
  });
  window.ytmd.memoryStore.onStateChanged(syncMemoryState);
  window.ytmd.getPlayerState().then(state => {
    playerState.value = state;
  });
  window.ytmd.onPlayerStateChanged(state => {
    playerState.value = state;
  });
  window.ytmd.onAudioData(data => {
    lastAudioDataAt.value = Date.now();
    if (data.some(value => value > 0)) {
      lastNonZeroAudioDataAt.value = Date.now();
    }
    audioData.value = data;
  });
  window.ytmd.onLightssAiMessage(message => {
    aiLightshowMessage.value = message;
  });

  statusClockInterval = setInterval(() => {
    statusNow.value = Date.now();
  }, 500);
});

onUnmounted(() => {
  clearAudioAnalyzerStaleCheck();
  if (statusClockInterval) {
    clearInterval(statusClockInterval);
    statusClockInterval = null;
  }
});
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0"></div>
  <div :class="shellClasses">
    <MiniPlayer
      v-if="miniPlayer"
      :actions="actions"
      :track="track"
      :vu-meter-enabled="vuMeterEnabled"
      :audio-data="audioData"
      :theme="vuMeterTheme"
      :vu-meter-style="vuMeterStyle"
      :ai-lightshow-message="aiLightshowMessage"
      :vu-status="vuStatus"
      :ai-status="aiStatus"
      :wled-status="wledStatus"
      :light-status="lightStatus"
    />
    <component :is="topBarComponent" v-if="!miniPlayer" :actions="actions" :active-player-layout="playerLayout" :active-top-bar-layout="topBarLayout">
      <template #system-status>
        <SystemStatusPill :message="aiLightshowMessage" :vu-status="vuStatus" :ai-status="aiStatus" :wled-status="wledStatus" :light-status="lightStatus" />
      </template>
      <template #window-controls>
        <div class="window-controls">
          <IconButton icon="remove" label="Minimize" @click="minimizeWindow" />
          <IconButton icon="crop_square" label="Maximize" @click="maximizeWindow" />
          <IconButton icon="close" label="Close" @click="closeWindow" />
        </div>
      </template>
    </component>

    <component
      :is="playerComponent"
      v-if="!miniPlayer"
      class="player-surface"
      :actions="actions"
      :track="track"
      :vu-meter-enabled="vuMeterEnabled"
      :audio-data="audioData"
      :theme="vuMeterTheme"
      :vu-meter-style="vuMeterStyle"
    />
  </div>
  <Suspense>
    <YTMViewLoading />
  </Suspense>
  <div ref="keyboardFocus" tabindex="32767"></div>
</template>

<style scoped>
.main-shell {
  position: fixed;
  inset: 0;
  z-index: 10;
  pointer-events: none;
  color: #eeeeee;
  background: transparent;
}

.main-shell > * {
  pointer-events: auto;
}

.player-surface {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}

.fullscreen-vu-player.command-top-bar .player-surface {
  top: 44px;
}

.fullscreen-vu-player.two-level-top-bar .player-surface {
  top: 96px;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.window-controls :deep(.icon-button:last-child:hover) {
  border-color: #c42b2b;
  background: #c42b2b;
}
</style>
