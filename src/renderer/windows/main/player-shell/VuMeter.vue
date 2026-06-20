<script setup lang="ts">
import { computed } from "vue";
import { VuMeterStyle, VuMeterTheme } from "~shared/store/schema";

const props = defineProps<{
  enabled: boolean;
  active?: boolean;
  audioData?: number[];
  theme?: VuMeterTheme;
  style?: VuMeterStyle;
  variant?: "compact" | "expanded" | "console" | "fullscreen";
}>();

const barCount = 8;

const simulatedBars = [
  { level: 34, speed: 0.62, delay: 0.0 },
  { level: 58, speed: 0.74, delay: 0.12 },
  { level: 82, speed: 0.55, delay: 0.24 },
  { level: 66, speed: 0.68, delay: 0.08 },
  { level: 44, speed: 0.8, delay: 0.32 },
  { level: 28, speed: 0.52, delay: 0.16 },
  { level: 72, speed: 0.7, delay: 0.04 },
  { level: 52, speed: 0.58, delay: 0.28 }
];

function getBinLevel(audioData: number[], barIndex: number): number {
  const binCount = audioData.length;
  if (binCount === 0) return 0;

  // Emphasize lower frequencies with a quadratic curve.
  const start = Math.floor(binCount * (barIndex / barCount) ** 2);
  const end = Math.max(start + 1, Math.floor(binCount * ((barIndex + 1) / barCount) ** 2));

  let sum = 0;
  let count = 0;
  for (let i = start; i < end && i < binCount; i++) {
    sum += audioData[i];
    count++;
  }

  if (count === 0) return 0;
  return (sum / count / 255) * 100;
}

const bars = computed(() => {
  const hasLiveAudioData = props.enabled && props.active && props.audioData && props.audioData.some(value => value > 0);

  return simulatedBars.map((bar, index) => {
    if (hasLiveAudioData) {
      return {
        level: getBinLevel(props.audioData as number[], index),
        speed: bar.speed,
        delay: bar.delay,
        animated: false
      };
    }

    return {
      level: bar.level,
      speed: bar.speed,
      delay: bar.delay,
      animated: props.enabled && props.active
    };
  });
});

const themeClass = computed(() => {
  switch (props.theme) {
    case VuMeterTheme.Classic:
      return "theme-classic";
    case VuMeterTheme.Ocean:
      return "theme-ocean";
    case VuMeterTheme.Fire:
      return "theme-fire";
    case VuMeterTheme.Mono:
      return "theme-mono";
    case VuMeterTheme.Neon:
      return "theme-neon";
    case VuMeterTheme.Default:
    default:
      return "theme-default";
  }
});

const styleClass = computed(() => {
  switch (props.style) {
    case VuMeterStyle.ClassicLed:
      return "style-classic-led";
    case VuMeterStyle.DotMatrix:
      return "style-dot-matrix";
    case VuMeterStyle.SpectrumLine:
      return "style-spectrum-line";
    case VuMeterStyle.AlbumGlow:
      return "style-album-glow";
    case VuMeterStyle.Bars:
    default:
      return "style-bars";
  }
});
</script>

<template>
  <div :class="['vu-meter', variant ?? 'compact', themeClass, styleClass, { disabled: !enabled, idle: enabled && !active }]" aria-hidden="true">
    <span
      v-for="(bar, index) in bars"
      :key="index"
      :style="{
        '--vu-base': `${bar.level}%`,
        '--vu-min': `${Math.max(12, bar.level * 0.35)}%`,
        '--vu-speed': `${bar.speed}s`,
        '--vu-delay': `${bar.delay}s`,
        'height': bar.animated ? undefined : `${bar.level}%`
      }"
      :class="{ animated: bar.animated }"
    >
      <i></i>
    </span>
  </div>
</template>

<style scoped>
.vu-meter {
  height: 46px;
  display: flex;
  align-items: end;
  gap: 3px;
}

.vu-meter span {
  width: 5px;
  min-height: 4px;
  border-radius: 4px;
  background: #27ce73;
  height: var(--vu-base);
  transition: height 90ms linear;
}

.vu-meter span i {
  display: none;
}

.vu-meter span.animated {
  animation: vu-bounce var(--vu-speed) ease-in-out var(--vu-delay) infinite alternate;
}

.vu-meter.theme-default span:nth-child(3),
.vu-meter.theme-default span:nth-child(7) {
  background: #f3c34c;
}

.vu-meter.theme-classic span {
  background: linear-gradient(to top, #27ce73 0%, #27ce73 55%, #f3c34c 55%, #f3c34c 80%, #d72b2b 80%, #d72b2b 100%);
}

.vu-meter.theme-ocean span {
  background: linear-gradient(to top, #0ea5e9 0%, #22d3ee 50%, #67e8f9 100%);
}

.vu-meter.theme-fire span {
  background: linear-gradient(to top, #f59e0b 0%, #ef4444 50%, #b91c1c 100%);
}

.vu-meter.theme-mono span {
  background: linear-gradient(to top, #9ca3af 0%, #e5e7eb 50%, #ffffff 100%);
}

.vu-meter.theme-neon span {
  background: linear-gradient(to top, #a855f7 0%, #ec4899 50%, #f43f5e 100%);
}

.vu-meter.expanded {
  height: 92px;
  gap: 4px;
}

.vu-meter.expanded span,
.vu-meter.console span {
  width: 7px;
}

.vu-meter.console {
  height: 128px;
  justify-content: center;
}

.vu-meter.fullscreen {
  width: min(100%, 920px);
  height: 100%;
  min-height: 240px;
  margin: 0 auto;
  justify-content: center;
  gap: clamp(8px, 2vw, 18px);
}

.vu-meter.fullscreen span {
  width: clamp(20px, 5vw, 54px);
  border-radius: 10px;
}

.vu-meter.style-classic-led {
  align-items: center;
}

.vu-meter.style-classic-led span {
  position: relative;
  height: 100% !important;
  min-height: 100%;
  background:
    linear-gradient(
      to top,
      transparent 0 10%,
      rgba(0, 0, 0, 0.35) 10% 13%,
      transparent 13% 23%,
      rgba(0, 0, 0, 0.35) 23% 26%,
      transparent 26% 36%,
      rgba(0, 0, 0, 0.35) 36% 39%,
      transparent 39% 49%,
      rgba(0, 0, 0, 0.35) 49% 52%,
      transparent 52% 62%,
      rgba(0, 0, 0, 0.35) 62% 65%,
      transparent 65% 75%,
      rgba(0, 0, 0, 0.35) 75% 78%,
      transparent 78% 88%,
      rgba(0, 0, 0, 0.35) 88% 91%,
      transparent 91% 100%
    ),
    linear-gradient(to top, #27ce73 0%, #27ce73 var(--vu-base), rgba(255, 255, 255, 0.08) var(--vu-base), rgba(255, 255, 255, 0.08) 100%);
  box-shadow: 0 0 10px rgba(39, 206, 115, 0.2);
}

.vu-meter.style-dot-matrix {
  align-items: center;
}

.vu-meter.style-dot-matrix span {
  height: 100% !important;
  min-height: 100%;
  border-radius: 999px;
  background:
    radial-gradient(circle at 50% 90%, var(--dot-color, #27ce73) 0 36%, transparent 39%) 0 0 / 100% 12.5% repeat-y,
    linear-gradient(to top, transparent 0%, transparent var(--vu-base), rgba(255, 255, 255, 0.08) var(--vu-base), rgba(255, 255, 255, 0.08) 100%);
  opacity: 0.95;
}

.vu-meter.style-spectrum-line {
  align-items: center;
  gap: 1px;
}

.vu-meter.style-spectrum-line span {
  width: 3px;
  border-radius: 999px;
}

.vu-meter.style-album-glow span {
  box-shadow:
    0 0 12px currentColor,
    0 0 26px rgba(255, 255, 255, 0.16);
  filter: saturate(1.24);
}

.vu-meter.style-album-glow.fullscreen span {
  box-shadow:
    0 0 18px currentColor,
    0 0 48px rgba(255, 255, 255, 0.18);
}

.vu-meter.idle span,
.vu-meter.disabled span {
  animation: none;
  background: #3a3a3a;
}

.vu-meter.disabled span {
  height: 12%;
}

@keyframes vu-bounce {
  0% {
    height: var(--vu-min);
  }
  100% {
    height: var(--vu-base);
  }
}
</style>
