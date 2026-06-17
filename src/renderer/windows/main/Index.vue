<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import YTMViewLoading from "../../components/YTMViewLoading.vue";
import { PlayerLayout, StoreSchema, TopBarLayout } from "~shared/store/schema";
import CommandTopBar from "./player-shell/CommandTopBar.vue";
import CompactDockPlayer from "./player-shell/CompactDockPlayer.vue";
import ControlConsolePlayer from "./player-shell/ControlConsolePlayer.vue";
import ExpandedStripPlayer from "./player-shell/ExpandedStripPlayer.vue";
import IconButton from "./player-shell/IconButton.vue";
import TwoLevelTopBar from "./player-shell/TwoLevelTopBar.vue";
import { placeholderTrack, ShellActions } from "./player-shell/types";

const keyboardFocus = ref<HTMLElement>(null);
const keyboardFocusZero = ref<HTMLElement>(null);
const topBarLayout = ref<TopBarLayout>(TopBarLayout.TwoLevel);
const playerLayout = ref<PlayerLayout>(PlayerLayout.ExpandedStrip);
const vuMeterEnabled = ref(true);

const topBarComponent = computed(() => (topBarLayout.value === TopBarLayout.Command ? CommandTopBar : TwoLevelTopBar));
const playerComponent = computed(() => {
  switch (playerLayout.value) {
    case PlayerLayout.CompactDock:
      return CompactDockPlayer;
    case PlayerLayout.ControlConsole:
      return ControlConsolePlayer;
    case PlayerLayout.ExpandedStrip:
    default:
      return ExpandedStripPlayer;
  }
});

const shellClasses = computed(() => ({
  "main-shell": true,
  "command-top-bar": topBarLayout.value === TopBarLayout.Command,
  "two-level-top-bar": topBarLayout.value === TopBarLayout.TwoLevel,
  "compact-player": playerLayout.value === PlayerLayout.CompactDock,
  "expanded-player": playerLayout.value === PlayerLayout.ExpandedStrip,
  "console-player": playerLayout.value === PlayerLayout.ControlConsole
}));

const actions: ShellActions = {
  focusSearch: () => window.ytmd.focusSearch(),
  navigateHome: () => window.ytmd.ytmViewNavigateDefault(),
  next: () => window.ytmd.playerControl("next"),
  openMiniPlayer: () => window.ytmd.openMiniPlayer(),
  openSettings: () => window.ytmd.openSettingsWindow(),
  playPause: () => window.ytmd.playerControl("playPause"),
  previous: () => window.ytmd.playerControl("previous"),
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
}

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
});
</script>

<template>
  <div ref="keyboardFocusZero" tabindex="0"></div>
  <div :class="shellClasses">
    <component :is="topBarComponent" :actions="actions">
      <template #window-controls>
        <div class="window-controls">
          <IconButton icon="remove" label="Minimize" @click="minimizeWindow" />
          <IconButton icon="crop_square" label="Maximize" @click="maximizeWindow" />
          <IconButton icon="close" label="Close" @click="closeWindow" />
        </div>
      </template>
    </component>

    <component :is="playerComponent" class="player-surface" :actions="actions" :track="placeholderTrack" :vu-meter-enabled="vuMeterEnabled" />
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
