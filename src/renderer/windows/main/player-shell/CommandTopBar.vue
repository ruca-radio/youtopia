<script setup lang="ts">
import IconButton from "./IconButton.vue";
import { ShellActions } from "./types";

defineProps<{
  actions: ShellActions;
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

    <div class="right">
      <IconButton icon="space_dashboard" label="Player layout" />
      <IconButton icon="equalizer" label="Meters" />
      <IconButton icon="queue_music" label="Queue" />
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
  grid-template-columns: auto minmax(260px, 1fr) auto;
  gap: 12px;
  align-items: center;
  background: #070707;
  border-bottom: 1px solid #242424;
  -webkit-app-region: drag;
}

.left,
.right {
  display: flex;
  align-items: center;
  gap: 6px;
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
