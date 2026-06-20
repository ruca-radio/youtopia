<script setup lang="ts">
import IconButton from "./IconButton.vue";
import NowPlayingInfo from "./NowPlayingInfo.vue";
import PlayerProgress from "./PlayerProgress.vue";
import SystemStatusPill from "./SystemStatusPill.vue";
import VuMeter from "./VuMeter.vue";
import { RendererLightssAiMessage } from "~shared/player";
import { VuMeterStyle, VuMeterTheme } from "~shared/store/schema";
import { ShellActions, ShellTrack } from "./types";

defineProps<{
  actions: ShellActions;
  track: ShellTrack;
  vuMeterEnabled: boolean;
  audioData: number[];
  theme: VuMeterTheme;
  vuMeterStyle: VuMeterStyle;
  aiLightshowMessage: RendererLightssAiMessage | null;
  vuStatus: { label: string; state: "idle" | "ok" | "busy" | "warn" | "bad" };
  aiStatus: { label: string; state: "idle" | "ok" | "busy" | "warn" | "bad" };
  wledStatus: { label: string; state: "idle" | "ok" | "busy" | "warn" | "bad" };
  lightStatus: { label: string; state: "idle" | "ok" | "busy" | "warn" | "bad" };
}>();
</script>

<template>
  <section class="mini-player">
    <div class="art"><img v-if="track.thumbnailUrl" :src="track.thumbnailUrl" alt="" /></div>
    <div class="details">
      <NowPlayingInfo :track="track" />
      <PlayerProgress :progress="track.progress" />
    </div>
    <div class="transport">
      <IconButton icon="skip_previous" label="Previous" @click="actions.previous" />
      <IconButton :icon="track.isPlaying ? 'pause' : 'play_arrow'" label="Play/Pause" prominent @click="actions.playPause" />
      <IconButton icon="skip_next" label="Next" @click="actions.next" />
    </div>
    <VuMeter :enabled="vuMeterEnabled" :active="track.isPlaying" :audio-data="audioData" :theme="theme" :style="vuMeterStyle" />
    <SystemStatusPill compact :message="aiLightshowMessage" :vu-status="vuStatus" :ai-status="aiStatus" :wled-status="wledStatus" :light-status="lightStatus" />
    <IconButton icon="open_in_full" label="Restore full window" @click="actions.restoreFromMiniPlayer" />
  </section>
</template>

<style scoped>
.mini-player {
  height: 100vh;
  padding: 12px;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto 62px 34px 34px;
  gap: 10px;
  align-items: center;
  background: #0b0b0b;
  border: 1px solid #292929;
  color: #eeeeee;
  -webkit-app-region: drag;
}

.mini-player > * {
  -webkit-app-region: no-drag;
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
