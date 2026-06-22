<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
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
  fusionHtml?: string;
}>();

const flashUiIframe = ref<HTMLIFrameElement | null>(null);
const sanitizedFusionHtml = computed(() => sanitizeFusionHtml(props.fusionHtml || ""));
const hasFusion = computed(() => Boolean(sanitizedFusionHtml.value));

function sanitizeFusionHtml(html: string) {
  let safe = html.trim();
  if (!safe) return "";
  safe = safe.slice(0, 180000);
  safe = safe.replace(/<script\b[^>]*\bsrc\s*=\s*["'][^"']*["'][^>]*>\s*<\/script>/gi, "");
  safe = safe.replace(/<(iframe|object|embed|base|form)\b[\s\S]*?<\/\1>/gi, "");
  safe = safe.replace(/<(iframe|object|embed|base|form)\b[^>]*\/?>/gi, "");
  safe = safe.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, "");
  safe = safe.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  safe = safe.replace(/javascript\s*:/gi, "");
  return safe;
}

function postFusionPlayerState() {
  if (!flashUiIframe.value?.contentWindow || !hasFusion.value) return;
  flashUiIframe.value.contentWindow.postMessage(
    {
      type: "playerState",
      player: {
        title: props.track.title,
        artist: props.track.artist,
        album: props.track.album,
        albumArtUrl: props.track.thumbnailUrl,
        progressPercent: props.track.progress,
        durationLabel: props.track.durationLabel,
        isPlaying: props.track.isPlaying,
        volume: props.track.volume
      },
      lightss: {
        hostLine: props.aiLightshowMessage?.hostLine || "",
        tickerMessage: props.aiLightshowMessage?.tickerMessage || "",
        aiStatus: props.aiLightshowMessage?.aiStatus || "",
        wledStatus: props.aiLightshowMessage?.wledStatus || "",
        displayTheme: props.aiLightshowMessage?.displayTheme || {},
        visualScene: props.aiLightshowMessage?.visualScene || {}
      }
    },
    "*"
  );
}

function handleFusionControlMessage(event: MessageEvent) {
  if (!flashUiIframe.value?.contentWindow || event.source !== flashUiIframe.value.contentWindow) return;
  const data = event.data as { command?: unknown; type?: unknown } | null;
  if (!data || data.type !== "youtopiaControl") return;

  const commands: Record<string, () => void> = {
    next: props.actions.next,
    playPause: props.actions.playPause,
    previous: props.actions.previous,
    seekBackward: props.actions.seekBackward,
    seekForward: props.actions.seekForward,
    toggleLike: props.actions.toggleLike,
    volumeDown: props.actions.volumeDown,
    volumeUp: props.actions.volumeUp
  };
  const command = String(data.command || "");
  commands[command]?.();
}

onMounted(() => window.addEventListener("message", handleFusionControlMessage));
onUnmounted(() => window.removeEventListener("message", handleFusionControlMessage));

watch(
  () => props.audioData,
  newBins => {
    if (flashUiIframe.value && flashUiIframe.value.contentWindow) {
      flashUiIframe.value.contentWindow.postMessage({ type: "audioBins", bins: newBins }, "*");
    }
  },
  { deep: true }
);

watch([() => props.track, () => props.aiLightshowMessage, sanitizedFusionHtml], () => setTimeout(postFusionPlayerState, 0), { deep: true });
</script>

<template>
  <section :class="{ 'fullscreen-vu-player': true, 'has-fusion': hasFusion }">
    <iframe
      v-if="hasFusion"
      ref="flashUiIframe"
      class="fusion-frame"
      :srcdoc="sanitizedFusionHtml"
      sandbox="allow-scripts"
      title="AI fusion visualizer"
      @load="postFusionPlayerState"
    ></iframe>
    <div class="now-playing">
      <div class="art"><img v-if="track.thumbnailUrl" :src="track.thumbnailUrl" alt="" /></div>
      <NowPlayingInfo :track="track" large />
      <PlayerProgress :progress="track.progress" />
    </div>

    <VuMeter
      v-if="!hasFusion"
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
  position: relative;
  height: 100%;
  min-height: 360px;
  padding: 28px 36px 30px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 24px;
  background: #070707;
  border-top: 1px solid #292929;
  overflow: hidden;
}

.fusion-frame {
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  border: 0;
  background: #000000;
}

.has-fusion {
  background: #000000;
}

.now-playing {
  position: relative;
  z-index: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  grid-template-rows: 1fr auto;
  gap: 12px 16px;
  align-items: center;
}

.has-fusion .now-playing {
  align-self: start;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.42);
  backdrop-filter: blur(18px);
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
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
}
</style>
