<script setup lang="ts">
import IconButton from "./IconButton.vue";
import NowPlayingInfo from "./NowPlayingInfo.vue";
import PlayerProgress from "./PlayerProgress.vue";
import VuMeter from "./VuMeter.vue";
import { VuMeterStyle, VuMeterTheme } from "~shared/store/schema";
import { ShellActions, ShellTrack } from "./types";

import { RendererLightssAiMessage } from "~shared/player";

defineProps<{
  actions: ShellActions;
  track: ShellTrack;
  vuMeterEnabled: boolean;
  audioData: number[];
  theme: VuMeterTheme;
  vuMeterStyle: VuMeterStyle;
  aiLightshowMessage?: RendererLightssAiMessage | null;
}>();
</script>

<template>
  <section class="expanded-strip-player">
    <div class="hero">
      <div class="art"><img v-if="track.thumbnailUrl" :src="track.thumbnailUrl" alt="" /></div>
      <NowPlayingInfo :track="track" large />
      <VuMeter
        :enabled="vuMeterEnabled"
        :active="track.isPlaying"
        :audio-data="audioData"
        :theme="theme"
        :style="vuMeterStyle"
        :ai-lightshow-message="aiLightshowMessage"
        variant="expanded"
      />
    </div>
    <div class="controls">
      <div class="quick-actions">
        <IconButton icon="favorite" label="Like" @click="actions.toggleLike" />
        <IconButton icon="thumb_down" label="Dislike" @click="actions.toggleDislike" />
        <IconButton icon="queue_music" label="Queue" />
      </div>
      <div class="center">
        <IconButton icon="skip_previous" label="Previous" @click="actions.previous" />
        <IconButton :icon="track.isPlaying ? 'pause' : 'play_arrow'" label="Play/Pause" prominent @click="actions.playPause" />
        <IconButton icon="skip_next" label="Next" @click="actions.next" />
      </div>
      <div class="volume">
        <IconButton icon="volume_down" label="Volume down" @click="actions.volumeDown" />
        <PlayerProgress :progress="track.volume" />
        <IconButton icon="volume_up" label="Volume up" @click="actions.volumeUp" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.expanded-strip-player {
  height: 148px;
  padding: 12px 16px;
  display: grid;
  grid-template-rows: 72px 52px;
  gap: 10px;
  background: #0c0c0c;
  border-top: 1px solid #292929;
}

.hero {
  min-width: 0;
  border: 1px solid #2b2b2b;
  border-radius: 10px;
  padding: 10px;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) 104px;
  gap: 12px;
  align-items: center;
  background: linear-gradient(135deg, #261015, #141414 56%);
}

.art {
  width: 54px;
  height: 54px;
  border-radius: 8px;
  background: linear-gradient(135deg, #b51d2d, #181818);
  overflow: hidden;
}

.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.controls,
.quick-actions,
.center,
.volume {
  display: flex;
  align-items: center;
}

.controls {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 12px;
}

.quick-actions,
.center {
  gap: 8px;
}

.volume {
  justify-content: flex-end;
  gap: 8px;
}

.volume :deep(.progress) {
  width: 78px;
}
</style>
