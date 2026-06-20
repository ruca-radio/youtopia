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
  <header class="two-level-top-bar">
    <div class="top-row">
      <div class="left">
        <div class="brand" title="Youtopia"><span class="material-symbols-outlined">music_note</span></div>
        <IconButton icon="home" label="Home" @click="actions.navigateHome" />
        <IconButton icon="search" label="Search" @click="actions.focusSearch" />
      </div>

      <div class="center" aria-label="Player mode shortcuts">
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
      </div>

      <div class="right">
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
    </div>

    <div class="workspace-row">
      <button class="search" title="Focus YouTube Music search" @click="actions.focusSearch">
        <span class="material-symbols-outlined">search</span>
        <span>Search, explore, build playlists</span>
      </button>
      <div class="system-slot">
        <slot name="system-status"></slot>
      </div>
      <nav>
        <button @click="actions.focusSearch">Explore</button>
        <button @click="actions.focusSearch">Library</button>
        <button @click="actions.focusSearch">Playlists</button>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.two-level-top-bar {
  height: 96px;
  background: #080808;
  border-bottom: 1px solid #242424;
  -webkit-app-region: drag;
}

.top-row {
  height: 42px;
  padding: 0 10px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 10px;
}

.left,
.center,
.right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.center {
  justify-content: center;
}

.right {
  justify-content: flex-end;
}

.brand {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #d72b2b;
  display: grid;
  place-items: center;
}

.workspace-row {
  height: 54px;
  padding: 0 16px;
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(168px, 220px) auto;
  align-items: center;
  gap: 12px;
  background: #101010;
  border-top: 1px solid #1d1d1d;
}

.system-slot {
  min-width: 0;
}

.search {
  min-width: 0;
  height: 34px;
  border: 1px solid #303030;
  border-radius: 8px;
  padding: 0 12px;
  background: #1a1a1a;
  color: #aaa;
  display: flex;
  align-items: center;
  gap: 9px;
  -webkit-app-region: no-drag;
  cursor: pointer;
}

.search span:last-child {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

nav {
  display: flex;
  gap: 8px;
}

nav button {
  height: 30px;
  min-width: 72px;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  background: #1f1f1f;
  color: #d8d8d8;
  -webkit-app-region: no-drag;
  cursor: pointer;
}

nav button:hover {
  background: #292929;
}
</style>
