<script setup lang="ts">
import IconButton from "./IconButton.vue";
import { PlayerLayout, TopBarLayout } from "~shared/store/schema";
import { ShellActions } from "./types";

defineProps<{
  actions: ShellActions;
  activePlayerLayout: PlayerLayout;
  activeTopBarLayout: TopBarLayout;
}>();
</script>

<template>
  <header class="command-top-bar">
    <div class="left">
      <div class="brand" title="Youtopia"><span class="material-symbols-outlined">music_note</span></div>
      <IconButton icon="home" label="Home" @click="actions.navigateHome" />
      <IconButton icon="arrow_back" label="Back" disabled />
      <IconButton icon="arrow_forward" label="Forward" disabled />
    </div>

    <button class="search" title="Focus YouTube Music search" @click="actions.focusSearch">
      <span class="material-symbols-outlined">search</span>
      <span class="label">Search songs, artists, albums, playlists</span>
      <span class="hint">Ctrl K</span>
    </button>

    <div class="system-slot">
      <slot name="system-status"></slot>
    </div>

    <div class="right">
      <IconButton
        icon="vertical_align_bottom"
        label="Compact Dock"
        :disabled="activePlayerLayout === PlayerLayout.CompactDock"
        @click="actions.setPlayerLayout(PlayerLayout.CompactDock)"
      />
      <IconButton
        icon="splitscreen_bottom"
        label="Expanded Strip"
        :disabled="activePlayerLayout === PlayerLayout.ExpandedStrip"
        @click="actions.setPlayerLayout(PlayerLayout.ExpandedStrip)"
      />
      <IconButton
        icon="view_sidebar"
        label="Control Console"
        :disabled="activePlayerLayout === PlayerLayout.ControlConsole"
        @click="actions.setPlayerLayout(PlayerLayout.ControlConsole)"
      />
      <IconButton
        icon="equalizer"
        label="Fullscreen VU"
        :disabled="activePlayerLayout === PlayerLayout.FullscreenVu"
        @click="actions.setPlayerLayout(PlayerLayout.FullscreenVu)"
      />
      <IconButton icon="queue_music" label="Queue" />
      <IconButton
        :icon="activeTopBarLayout === TopBarLayout.Command ? 'view_agenda' : 'toolbar'"
        label="Switch top bar"
        @click="actions.setTopBarLayout(activeTopBarLayout === TopBarLayout.Command ? TopBarLayout.TwoLevel : TopBarLayout.Command)"
      />
      <IconButton icon="settings" label="Settings" @click="actions.openSettings" />
      <IconButton icon="picture_in_picture_alt" label="Mini-player" @click="actions.openMiniPlayer" />
      <slot name="window-controls"></slot>
    </div>
  </header>
</template>

<style scoped>
.command-top-bar {
  height: 44px;
  padding: 0 10px;
  display: grid;
  grid-template-columns: auto minmax(220px, 1fr) minmax(168px, 220px) auto;
  gap: 12px;
  align-items: center;
  background: #070707;
  border-bottom: 1px solid #242424;
  -webkit-app-region: drag;
}

.left,
.right,
.system-slot {
  display: flex;
  align-items: center;
  gap: 6px;
}

.system-slot {
  min-width: 0;
}

.brand {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #d72b2b;
  display: grid;
  place-items: center;
}

.search {
  min-width: 0;
  height: 32px;
  border: 1px solid #303030;
  border-radius: 8px;
  padding: 0 10px;
  background: #171717;
  color: #aaa;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 8px;
  text-align: left;
  -webkit-app-region: no-drag;
  cursor: pointer;
}

.search:hover {
  border-color: #4a4a4a;
  color: #e6e6e6;
}

.label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hint {
  color: #777;
  font-size: 11px;
}
</style>
