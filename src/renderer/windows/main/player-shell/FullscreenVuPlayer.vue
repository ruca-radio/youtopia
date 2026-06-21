<script setup lang="ts">
import { ref, watch } from "vue";
import IconButton from "./IconButton.vue";
import NowPlayingInfo from "./NowPlayingInfo.vue";
import PlayerProgress from "./PlayerProgress.vue";
import VuMeter from "./VuMeter.vue";
import { VuMeterStyle, VuMeterTheme } from "~shared/store/schema";
import { ShellActions, ShellTrack } from "./types";
import { RendererLightssAiMessage } from "~shared/player";

const props = defineProps<{
  actions: ShellActions;
  track: ShellTrack;
  vuMeterEnabled: boolean;
  audioData: number[];
  theme: VuMeterTheme;
  vuMeterStyle: VuMeterStyle;
  aiLightshowMessage?: RendererLightssAiMessage | null;
}>();

const flashUiIframe = ref<HTMLIFrameElement | null>(null);

watch(
  () => props.audioData,
  newBins => {
    if (flashUiIframe.value && flashUiIframe.value.contentWindow) {
      flashUiIframe.value.contentWindow.postMessage({ type: "audioBins", bins: newBins }, "*");
    }
  },
  { deep: true }
);
</script>

<template>
  <section class="fullscreen-vu-player">
    <div class="now-playing">
      <div class="art"><img v-if="track.thumbnailUrl" :src="track.thumbnailUrl" alt="" /></div>
      <NowPlayingInfo :track="track" large />
      <PlayerProgress :progress="track.progress" />
    </div>

    <!-- Scrap fusion for right now: always render standard VuMeter visualizer -->
    <VuMeter
      :enabled="vuMeterEnabled"
      :active="track.isPlaying"
      :audio-data="audioData"
      :theme="theme"
      :style="vuMeterStyle"
      :ai-lightshow-message="aiLightshowMessage"
      variant="fullscreen"
    />

    <div class="transport">
      <IconButton icon="skip_previous" label="Previous" @click="actions.previous" />
      <IconButton :icon="track.isPlaying ? 'pause' : 'play_arrow'" label="Play/Pause" prominent @click="actions.playPause" />
      <IconButton icon="skip_next" label="Next" @click="actions.next" />
      <IconButton icon="volume_down" label="Volume down" @click="actions.volumeDown" />
      <IconButton icon="volume_up" label="Volume up" @click="actions.volumeUp" />
    </div>
  </section>
</template>

<style scoped>
.fullscreen-vu-player {
  height: 100%;
  min-height: 360px;
  padding: 28px 36px 30px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 24px;
  background: #070707;
  border-top: 1px solid #292929;
}

.now-playing {
  min-width: 0;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  gap: 12px 16px;
  align-items: center;
}

.now-playing :deep(.progress) {
  grid-column: 1 / -1;
}

.art {
  width: 72px;
  height: 72px;
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

.transport {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
</style>
