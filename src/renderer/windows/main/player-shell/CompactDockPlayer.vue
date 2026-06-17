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
  <section class="compact-dock-player">
    <div class="art"></div>
    <div class="details">
      <NowPlayingInfo :track="track" />
      <PlayerProgress :progress="track.progress" />
    </div>
    <div class="transport">
      <IconButton icon="skip_previous" label="Previous" @click="actions.previous" />
      <IconButton :icon="track.isPlaying ? 'pause' : 'play_arrow'" label="Play/Pause" prominent @click="actions.playPause" />
      <IconButton icon="skip_next" label="Next" @click="actions.next" />
      <IconButton icon="favorite" label="Like" @click="actions.toggleLike" />
      <IconButton icon="queue_music" label="Queue" />
    </div>
    <VuMeter :enabled="vuMeterEnabled" />
  </section>
</template>

<style scoped>
.compact-dock-player {
  height: 104px;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: 56px minmax(160px, 1fr) auto 84px;
  gap: 12px;
  align-items: center;
  background: rgba(12, 12, 12, 0.98);
  border-top: 1px solid #292929;
}

.art {
  width: 56px;
  height: 56px;
  border-radius: 8px;
  background: linear-gradient(135deg, #b51d2d, #181818);
}

.details {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.transport {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
