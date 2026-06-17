<script setup lang="ts">
import { ShellTrack } from "./types";

defineProps<{
  track: ShellTrack;
  large?: boolean;
}>();
</script>

<template>
  <div :class="{ 'now-playing-info': true, large }">
    <p class="title">{{ track.title }}</p>
    <p class="meta">
      {{ track.artist }}<span v-if="track.album"> • {{ track.album }}</span>
    </p>
  </div>
</template>

<style scoped>
.now-playing-info {
  min-width: 0;
}

.title,
.meta {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.title {
  color: #f3f3f3;
  font-size: 14px;
  font-weight: 760;
}

.meta {
  margin-top: 3px;
  color: #a7a7a7;
  font-size: 11px;
}

.large .title {
  font-size: 18px;
}

.large .meta {
  font-size: 12px;
}
</style>
