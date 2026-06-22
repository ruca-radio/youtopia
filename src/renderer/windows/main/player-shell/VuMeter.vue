<script setup lang="ts">
import { computed } from "vue";
import { VuMeterStyle, VuMeterTheme } from "~shared/store/schema";
import { RendererLightssAiMessage } from "~shared/player";

const props = defineProps<{
  enabled: boolean;
  active?: boolean;
  audioData?: number[];
  theme?: VuMeterTheme;
  style?: VuMeterStyle;
  variant?: "compact" | "expanded" | "console" | "fullscreen";
  aiLightshowMessage?: RendererLightssAiMessage | null;
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
  let styleName = "bars";
  if (props.aiLightshowMessage?.visualScene?.vuStyle) {
    styleName = props.aiLightshowMessage.visualScene.vuStyle;
  } else {
    switch (props.style) {
      case VuMeterStyle.ClassicLed:
        styleName = "classicLed";
        break;
      case VuMeterStyle.DotMatrix:
        styleName = "dotMatrix";
        break;
      case VuMeterStyle.SpectrumLine:
        styleName = "spectrumLine";
        break;
      case VuMeterStyle.AlbumGlow:
        styleName = "albumGlow";
        break;
      case VuMeterStyle.RadialWave:
        styleName = "radialWave";
        break;
      case VuMeterStyle.WaveScope:
        styleName = "waveScope";
        break;
      case VuMeterStyle.PixelBlocks:
        styleName = "pixelBlocks";
        break;
      case VuMeterStyle.FloatingOrbs:
        styleName = "floatingOrbs";
        break;
      case VuMeterStyle.FireFlame:
        styleName = "fireFlame";
        break;
      case VuMeterStyle.DoubleSpectrum:
        styleName = "doubleSpectrum";
        break;
      case VuMeterStyle.NeonPulse:
        styleName = "neonPulse";
        break;
      case VuMeterStyle.Bars:
      default:
        styleName = "bars";
        break;
    }
  }

  // Translate camelCase to style-* class
  if (styleName === "classicLed") return "style-classic-led";
  if (styleName === "dotMatrix") return "style-dot-matrix";
  if (styleName === "spectrumLine") return "style-spectrum-line";
  if (styleName === "albumGlow") return "style-album-glow";
  if (styleName === "radialWave") return "style-radial-wave";
  if (styleName === "waveScope") return "style-wave-scope";
  if (styleName === "pixelBlocks") return "style-pixel-blocks";
  if (styleName === "floatingOrbs") return "style-floating-orbs";
  if (styleName === "fireFlame") return "style-fire-flame";
  if (styleName === "doubleSpectrum") return "style-double-spectrum";
  if (styleName === "neonPulse") return "style-neon-pulse";
  return "style-bars";
});

const computedThemeColors = computed(() => {
  if (props.aiLightshowMessage?.displayTheme) {
    const dt = props.aiLightshowMessage.displayTheme;
    return {
      low: dt.vuLowColor || "#22c55e",
      mid: dt.vuMidColor || "#facc15",
      high: dt.vuHighColor || "#ef4444",
      accent: dt.accentColor || "#ef4444"
    };
  }
  return null;
});

const computedRotation = computed(() => {
  if (props.aiLightshowMessage?.visualScene?.vuRotation !== undefined) {
    return `${props.aiLightshowMessage.visualScene.vuRotation}deg`;
  }
  return "0deg";
});

const computedColorShift = computed(() => {
  if (props.aiLightshowMessage?.visualScene?.vuColorShift !== undefined) {
    return `${props.aiLightshowMessage.visualScene.vuColorShift}deg`;
  }
  return "0deg";
});
</script>

<template>
  <div
    :class="['vu-meter', variant ?? 'compact', themeClass, styleClass, { disabled: !enabled, idle: enabled && !active }]"
    :style="{
      '--vu-color-low': computedThemeColors?.low || undefined,
      '--vu-color-mid': computedThemeColors?.mid || undefined,
      '--vu-color-high': computedThemeColors?.high || undefined,
      '--vu-color-accent': computedThemeColors?.accent || undefined,
      '--vu-rotation': computedRotation,
      '--vu-color-shift': computedColorShift,
      '--vu-bar-count': barCount
    }"
    aria-hidden="true"
  >
    <span
      v-for="(bar, index) in bars"
      :key="index"
      :style="{
        '--vu-base': `${bar.level}%`,
        '--vu-min': `${Math.max(12, bar.level * 0.35)}%`,
        '--vu-speed': `${bar.speed}s`,
        '--vu-delay': `${bar.delay}s`,
        '--vu-index': index,
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
  transform: rotate(var(--vu-rotation, 0deg));
  filter: hue-rotate(var(--vu-color-shift, 0deg));
  transform-origin: center;
  transition:
    transform 900ms cubic-bezier(0.34, 1.56, 0.64, 1),
    filter 700ms ease;
}

.vu-meter span {
  width: 5px;
  min-height: 4px;
  border-radius: 4px;
  background: var(--vu-color-low, #27ce73);
  height: var(--vu-base);
  transition: height 90ms linear;
}

.vu-meter span i {
  display: none;
}

.vu-meter span.animated {
  animation: vu-bounce var(--vu-speed) ease-in-out var(--vu-delay) infinite alternate;
}

.vu-meter.theme-default span {
  background: var(--vu-color-low, #27ce73);
}

.vu-meter.theme-default span:nth-child(3),
.vu-meter.theme-default span:nth-child(7) {
  background: var(--vu-color-mid, #f3c34c);
}

.vu-meter.theme-classic span {
  background: linear-gradient(
    to top,
    var(--vu-color-low, #27ce73) 0%,
    var(--vu-color-low, #27ce73) 55%,
    var(--vu-color-mid, #f3c34c) 55%,
    var(--vu-color-mid, #f3c34c) 80%,
    var(--vu-color-high, #d72b2b) 80%,
    var(--vu-color-high, #d72b2b) 100%
  );
}

.vu-meter.theme-ocean span {
  background: linear-gradient(to top, var(--vu-color-low, #0ea5e9) 0%, var(--vu-color-mid, #22d3ee) 50%, var(--vu-color-high, #67e8f9) 100%);
}

.vu-meter.theme-fire span {
  background: linear-gradient(to top, var(--vu-color-low, #f59e0b) 0%, var(--vu-color-mid, #ef4444) 50%, var(--vu-color-high, #b91c1c) 100%);
}

.vu-meter.theme-mono span {
  background: linear-gradient(to top, var(--vu-color-low, #9ca3af) 0%, var(--vu-color-mid, #e5e7eb) 50%, var(--vu-color-high, #ffffff) 100%);
}

.vu-meter.theme-neon span {
  background: linear-gradient(to top, var(--vu-color-low, #a855f7) 0%, var(--vu-color-mid, #ec4899) 50%, var(--vu-color-high, #f43f5e) 100%);
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
    linear-gradient(
      to top,
      var(--vu-color-low, #27ce73) 0%,
      var(--vu-color-low, #27ce73) var(--vu-base),
      rgba(255, 255, 255, 0.08) var(--vu-base),
      rgba(255, 255, 255, 0.08) 100%
    );
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
    radial-gradient(circle at 50% 90%, var(--dot-color, var(--vu-color-low, #27ce73)) 0 36%, transparent 39%) 0 0 / 100% 12.5% repeat-y,
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

/* Style: radialWave */
.vu-meter.style-radial-wave {
  position: relative;
  width: 100px;
  height: 100px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.vu-meter.style-radial-wave span {
  position: absolute;
  bottom: 50%;
  left: calc(50% - 2.5px);
  width: 5px;
  transform-origin: bottom center;
  transform: rotate(calc(var(--vu-index) * (360deg / var(--vu-bar-count)))) translateY(-16px);
  height: calc(var(--vu-base) * 0.45 + 4px) !important;
  border-radius: 999px;
  margin: 0;
}
.vu-meter.fullscreen.style-radial-wave {
  width: 260px;
  height: 260px;
}
.vu-meter.fullscreen.style-radial-wave span {
  width: 12px;
  left: calc(50% - 6px);
  transform: rotate(calc(var(--vu-index) * (360deg / var(--vu-bar-count)))) translateY(-50px);
  height: calc(var(--vu-base) * 0.85 + 8px) !important;
}

/* Style: waveScope */
.vu-meter.style-wave-scope {
  align-items: center;
  gap: 2px;
}
.vu-meter.style-wave-scope span {
  border-radius: 999px;
  height: calc(var(--vu-base) * 0.8 + 6px) !important;
  background: linear-gradient(to bottom, var(--vu-color-high, #ef4444), var(--vu-color-mid, #facc15) 50%, var(--vu-color-high, #ef4444));
}

/* Style: pixelBlocks */
.vu-meter.style-pixel-blocks span {
  border-radius: 0;
  background:
    repeating-linear-gradient(to top, transparent 0, transparent 3px, #000000 3px, #000000 5px),
    linear-gradient(to top, var(--vu-color-low, #27ce73) 0%, var(--vu-color-mid, #f3c34c) 62%, var(--vu-color-high, #d72b2b) 100%);
}

/* Style: floatingOrbs */
.vu-meter.style-floating-orbs {
  align-items: end;
  position: relative;
}
.vu-meter.style-floating-orbs span {
  width: clamp(8px, 2.5vw, 24px);
  height: clamp(8px, 2.5vw, 24px) !important;
  border-radius: 50%;
  transform: translateY(calc(-1 * var(--vu-base) * 0.7));
  margin: 0;
  box-shadow: 0 0 10px var(--vu-color-high, #ef4444);
  transition: transform 100ms cubic-bezier(0.1, 0.8, 0.3, 1);
}

/* Style: fireFlame */
.vu-meter.style-fire-flame span {
  width: clamp(6px, 1.8vw, 28px);
  border-radius: 999px 999px 0 0;
  background: linear-gradient(to top, #ef4444, #f97316 45%, #facc15 85%, #ffffff 100%);
  box-shadow:
    0 0 14px rgba(249, 115, 22, 0.6),
    inset 0 2px 4px rgba(255, 255, 255, 0.4);
  animation: vu-flicker 1.2s ease-in-out infinite alternate;
}

/* Style: doubleSpectrum */
.vu-meter.style-double-spectrum {
  align-items: center;
}
.vu-meter.style-double-spectrum span {
  height: calc(var(--vu-base) * 0.8 + 6px) !important;
  background: linear-gradient(
    to bottom,
    var(--vu-color-high, #ef4444),
    var(--vu-color-mid, #facc15) 40%,
    var(--vu-color-low, #22c55e) 50%,
    var(--vu-color-mid, #facc15) 60%,
    var(--vu-color-high, #ef4444)
  );
  border-radius: 6px;
}

/* Style: neonPulse */
.vu-meter.style-neon-pulse span {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid var(--vu-color-high, #ef4444);
  box-shadow:
    0 0 10px var(--vu-color-high, #ef4444),
    inset 0 0 4px var(--vu-color-mid, #facc15);
  position: relative;
}
.vu-meter.style-neon-pulse span::after {
  content: "";
  position: absolute;
  top: 10%;
  left: calc(50% - 0.75px);
  width: 1.5px;
  height: 80%;
  background: #ffffff;
  border-radius: 999px;
  opacity: 0.9;
  box-shadow: 0 0 6px #ffffff;
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

@keyframes vu-flicker {
  0% {
    opacity: 0.88;
    filter: brightness(0.9) blur(0.2px);
  }
  100% {
    opacity: 1;
    filter: brightness(1.1) blur(0.6px);
  }
}
</style>
