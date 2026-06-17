<script setup lang="ts">
import IconButton from "./IconButton.vue";
import NowPlayingInfo from "./NowPlayingInfo.vue";
import PlayerProgress from "./PlayerProgress.vue";
import VuMeter from "./VuMeter.vue";
import { ShellActions, ShellTrack } from "./types";

defineProps<{
  actions: ShellActions;
  track: ShellTrack;
  vuMeterEnabled: boolean;
}>();
</script>

<template>
  <section class="control-console-player">
    <div class="summary">
      <div class="art"></div>
      <NowPlayingInfo :track="track" />
      <PlayerProgress :progress="track.progress" />
    </div>
    <div class="queue-panel">
      <p>Queue</p>
      <span></span>
      <span></span>
      <span></span>
    </div>
    <div class="transport">
      <IconButton icon="skip_previous" label="Previous" @click="actions.previous" />
      <IconButton :icon="track.isPlaying ? 'pause' : 'play_arrow'" label="Play/Pause" prominent @click="actions.playPause" />
      <IconButton icon="skip_next" label="Next" @click="actions.next" />
      <IconButton icon="favorite" label="Like" @click="actions.toggleLike" />
      <IconButton icon="thumb_down" label="Dislike" @click="actions.toggleDislike" />
    </div>
    <div class="meters">
      <p>Meters</p>
      <VuMeter :enabled="vuMeterEnabled" variant="console" />
    </div>
  </section>
</template>

<style scoped>
.control-console-player {
  height: 176px;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(150px, 220px) auto 150px;
  gap: 12px;
  align-items: stretch;
  background: #0c0c0c;
  border-top: 1px solid #292929;
}

.summary,
.queue-panel,
.meters {
  border: 1px solid #2b2b2b;
  border-radius: 10px;
  background: #151515;
}

.summary {
  padding: 10px;
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  gap: 10px;
}

.summary :deep(.progress) {
  grid-column: 1 / -1;
}

.art {
  width: 62px;
  height: 62px;
  border-radius: 8px;
  background: linear-gradient(135deg, #b51d2d, #181818);
}

.queue-panel {
  padding: 12px;
  display: grid;
  align-content: start;
  gap: 8px;
}

.queue-panel p,
.meters p {
  margin: 0;
  color: #aaa;
  font-size: 11px;
}

.queue-panel span {
  height: 12px;
  border-radius: 4px;
  background: #292929;
}

.queue-panel span:last-child {
  width: 70%;
}

.transport {
  display: flex;
  align-items: center;
  gap: 8px;
}

.meters {
  padding: 12px;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 8px;
}
</style>
