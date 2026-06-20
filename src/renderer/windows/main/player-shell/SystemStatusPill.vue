<script setup lang="ts">
import { computed, ref } from "vue";
import { RendererLightssAiMessage } from "~shared/player";

type StatusState = "idle" | "ok" | "busy" | "warn" | "bad";
type StatusItem = {
  label: string;
  state: StatusState;
};

const props = defineProps<{
  message: RendererLightssAiMessage | null;
  vuStatus: StatusItem;
  aiStatus: StatusItem;
  wledStatus: StatusItem;
  lightStatus: StatusItem;
  compact?: boolean;
}>();

const open = ref(false);
const title = computed(() => props.message?.title ?? "AI Lightshow");
const body = computed(() => props.message?.message ?? "Waiting for playback and controller status.");
const provider = computed(() => props.message?.provider ?? "ollama");
const model = computed(() => props.message?.model ?? "kimi-k2.7-code:cloud");
const lightsStatus = computed<StatusItem>(() => {
  if (props.wledStatus.state === "bad" || props.lightStatus.state === "bad") {
    return { label: "Lights failed", state: "bad" };
  }

  if (props.lightStatus.state === "ok") {
    return { label: "Lights live", state: "ok" };
  }

  if (props.wledStatus.state === "ok") {
    return { label: "Lights online", state: "ok" };
  }

  return { label: "Lights unknown", state: "idle" };
});
</script>

<template>
  <div class="system-status" :class="{ compact }">
    <button class="pill" title="System status" @click="open = !open">
      <span class="material-symbols-outlined">auto_awesome</span>
      <span class="dots">
        <i :class="aiStatus.state" title="AI"></i>
        <i :class="lightsStatus.state" title="Lights"></i>
      </span>
      <span v-if="!compact" class="label">{{ title }}</span>
    </button>
    <div v-if="open && !compact" class="popover">
      <strong>{{ title }}</strong>
      <p>{{ body }}</p>
      <div class="chips">
        <span :class="['chip', vuStatus.state]">{{ vuStatus.label }}</span>
        <span :class="['chip', aiStatus.state]">{{ aiStatus.label }}</span>
        <span :class="['chip', lightsStatus.state]">{{ lightsStatus.label }}</span>
      </div>
      <span class="meta">
        {{ provider }} / {{ model }}
        <template v-if="message?.genre || message?.mood || message?.bpm">
          · {{ message.genre || "genre" }} · {{ message.mood || "mood" }} · {{ message.bpm || "BPM" }} BPM
        </template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.system-status {
  position: relative;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.pill {
  width: 100%;
  height: 32px;
  min-width: 0;
  border: 1px solid #303030;
  border-radius: 8px;
  padding: 0 9px;
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  color: #dddddd;
  background: #171717;
  cursor: pointer;
}

.compact .pill {
  width: 34px;
  grid-template-columns: auto;
  place-items: center;
  padding: 0;
}

.pill:hover {
  border-color: #4a4a4a;
  background: #1f1f1f;
}

.pill .material-symbols-outlined {
  font-size: 18px;
}

.dots {
  display: flex;
  gap: 3px;
}

.compact .dots {
  display: none;
}

.dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #666666;
}

.dots i.ok {
  background: #22c55e;
}

.dots i.busy,
.dots i.warn {
  background: #f59e0b;
}

.dots i.bad {
  background: #ef4444;
}

.label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  text-align: left;
}

.popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: min(390px, calc(100vw - 36px));
  padding: 12px;
  display: grid;
  gap: 8px;
  color: #eeeeee;
  background: rgba(15, 15, 15, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}

.popover strong {
  font-size: 14px;
}

.popover p {
  margin: 0;
  color: #d7d7d7;
  font-size: 12px;
  line-height: 1.35;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  min-height: 20px;
  padding: 3px 7px;
  border-radius: 999px;
  font-size: 11px;
  color: #d6d6d6;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.chip.ok {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.32);
}

.chip.busy,
.chip.warn {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.32);
}

.chip.bad {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.34);
}

.meta {
  color: #a7a7a7;
  font-size: 11px;
  line-height: 1.2;
}
</style>
