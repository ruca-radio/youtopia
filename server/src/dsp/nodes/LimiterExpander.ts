/**
 * YouTopia DSP — Limiter + Expander/Gate node.
 *
 * Combines:
 *   • ffmpeg `alimiter` — true-peak / brickwall limiter
 *   • ffmpeg `agate`    — downward expander / noise gate
 *
 * The limiter sub-section prevents any output from exceeding a ceiling
 * (SAFETY: AI can only raise the ceiling to -0.1 dBFS max — never 0 dBFS or above,
 * to protect downstream D/A converters and speakers).
 *
 * AI-settable params:
 *   Limiter:
 *     • limiterEnabled   — Bool
 *     • ceilingDb        — brickwall ceiling (-12..-0.1 dBFS)
 *     • limiterReleaseMs — release time (1..1000 ms)
 *   Expander/Gate:
 *     • expanderEnabled  — Bool
 *     • gateThresholdDb  — gate open threshold (-80..0 dB)
 *     • expanderRatio    — expansion ratio 1..9
 *     • expanderAttackMs — attack (0.01..200 ms)
 *     • expanderReleaseMs — release (1..4000 ms)
 */

import type {
  DspNode,
  DspNodeState,
  DspParamDescriptor,
  DspParamValue,
} from "../../contracts/index.js";
import { DspNodeType, DspParamType } from "../../contracts/index.js";
import { clampToDescriptor } from "../clamp.js";

// SAFETY: ceiling hard-capped at -0.1 dBFS
const CEILING_MAX_DB = -0.1;
const CEILING_MIN_DB = -12;

export class LimiterExpander implements DspNode {
  readonly nodeId = "limiter";
  readonly type = DspNodeType.Limiter;

  // Limiter state
  private _limiterEnabled = true;
  private _ceilingDb = -1.0;
  private _limiterReleaseMs = 50;

  // Expander/Gate state
  private _expanderEnabled = false; // off by default — most content doesn't need it
  private _gateThresholdDb = -40;
  private _expanderRatio = 2;
  private _expanderAttackMs = 20;
  private _expanderReleaseMs = 250;

  descriptors(): DspParamDescriptor[] {
    return [
      // ── Limiter ──────────────────────────────────────────────────────────
      {
        key: "limiterEnabled",
        label: "Enable Limiter",
        type: DspParamType.Bool,
        default: true,
        describe: "Brickwall limiter. Keep enabled to protect equipment.",
      },
      {
        key: "ceilingDb",
        label: "Limiter Ceiling (dBFS)",
        type: DspParamType.Float,
        min: CEILING_MIN_DB,
        max: CEILING_MAX_DB,
        step: 0.1,
        default: -1.0,
        unit: "dBFS",
        describe:
          `Brickwall output ceiling. Hard limit [${CEILING_MIN_DB}, ${CEILING_MAX_DB}] dBFS. ` +
          "Never set to 0 or above — protects D/A converters and speakers.",
      },
      {
        key: "limiterReleaseMs",
        label: "Limiter Release (ms)",
        type: DspParamType.Float,
        min: 1,
        max: 1000,
        step: 1,
        default: 50,
        unit: "ms",
        describe: "Release time of the brickwall limiter in milliseconds.",
      },

      // ── Expander / Gate ───────────────────────────────────────────────────
      {
        key: "expanderEnabled",
        label: "Enable Expander/Gate",
        type: DspParamType.Bool,
        default: false,
        describe: "Enable the downward expander / noise gate.",
      },
      {
        key: "gateThresholdDb",
        label: "Gate Threshold (dB)",
        type: DspParamType.Float,
        min: -80,
        max: 0,
        step: 0.5,
        default: -40,
        unit: "dB",
        describe: "Signal level below which the expander/gate attenuates. Lower = more open.",
      },
      {
        key: "expanderRatio",
        label: "Expander Ratio",
        type: DspParamType.Float,
        min: 1,
        max: 9,
        step: 0.1,
        default: 2,
        unit: ":1",
        describe: "Expansion ratio below threshold. 2:1 = gentle; high values approach a gate.",
      },
      {
        key: "expanderAttackMs",
        label: "Expander Attack (ms)",
        type: DspParamType.Float,
        min: 0.01,
        max: 200,
        step: 0.5,
        default: 20,
        unit: "ms",
        describe: "Attack time of the expander (time to open).",
      },
      {
        key: "expanderReleaseMs",
        label: "Expander Release (ms)",
        type: DspParamType.Float,
        min: 1,
        max: 4000,
        step: 1,
        default: 250,
        unit: "ms",
        describe: "Release time of the expander (time to close after signal drops).",
      },
    ];
  }

  getState(): DspNodeState {
    return {
      nodeId: this.nodeId,
      type: this.type,
      enabled: this._limiterEnabled || this._expanderEnabled,
      values: {
        limiterEnabled: this._limiterEnabled,
        ceilingDb: this._ceilingDb,
        limiterReleaseMs: this._limiterReleaseMs,
        expanderEnabled: this._expanderEnabled,
        gateThresholdDb: this._gateThresholdDb,
        expanderRatio: this._expanderRatio,
        expanderAttackMs: this._expanderAttackMs,
        expanderReleaseMs: this._expanderReleaseMs,
      },
    };
  }

  setParams(values: Record<string, DspParamValue>): Record<string, DspParamValue> {
    const descMap = new Map(this.descriptors().map((d) => [d.key, d]));

    if ("limiterEnabled" in values)
      this._limiterEnabled = clampToDescriptor(descMap.get("limiterEnabled")!, values["limiterEnabled"]) as boolean;
    if ("ceilingDb" in values)
      this._ceilingDb = clampToDescriptor(descMap.get("ceilingDb")!, values["ceilingDb"]) as number;
    if ("limiterReleaseMs" in values)
      this._limiterReleaseMs = clampToDescriptor(descMap.get("limiterReleaseMs")!, values["limiterReleaseMs"]) as number;
    if ("expanderEnabled" in values)
      this._expanderEnabled = clampToDescriptor(descMap.get("expanderEnabled")!, values["expanderEnabled"]) as boolean;
    if ("gateThresholdDb" in values)
      this._gateThresholdDb = clampToDescriptor(descMap.get("gateThresholdDb")!, values["gateThresholdDb"]) as number;
    if ("expanderRatio" in values)
      this._expanderRatio = clampToDescriptor(descMap.get("expanderRatio")!, values["expanderRatio"]) as number;
    if ("expanderAttackMs" in values)
      this._expanderAttackMs = clampToDescriptor(descMap.get("expanderAttackMs")!, values["expanderAttackMs"]) as number;
    if ("expanderReleaseMs" in values)
      this._expanderReleaseMs = clampToDescriptor(descMap.get("expanderReleaseMs")!, values["expanderReleaseMs"]) as number;

    return this.getState().values;
  }

  reset(): void {
    this._limiterEnabled = true;
    this._ceilingDb = -1.0;
    this._limiterReleaseMs = 50;
    this._expanderEnabled = false;
    this._gateThresholdDb = -40;
    this._expanderRatio = 2;
    this._expanderAttackMs = 20;
    this._expanderReleaseMs = 250;
  }

  /**
   * Build the ffmpeg filter fragment.
   * Expander (agate) runs before limiter (alimiter) in the signal chain.
   *
   * alimiter params:
   *   level_in, level_out (linear), limit (linear peak ceiling), attack, release (ms)
   * agate params:
   *   threshold (linear 0..1), ratio, attack, release (ms)
   */
  toFfmpegFragment(): string {
    const parts: string[] = [];

    if (this._expanderEnabled) {
      const gateThresholdLinear = Math.pow(10, this._gateThresholdDb / 20);
      const clampedGateThresh = Math.max(0.000031623, Math.min(1, gateThresholdLinear));
      parts.push(
        `agate=` +
          `threshold=${clampedGateThresh.toFixed(6)}:` +
          `ratio=${this._expanderRatio.toFixed(2)}:` +
          `attack=${this._expanderAttackMs.toFixed(2)}:` +
          `release=${this._expanderReleaseMs.toFixed(2)}`,
      );
    }

    if (this._limiterEnabled) {
      // SAFETY: ceiling always ≤ CEILING_MAX_DB before passing to ffmpeg
      const ceilDb = Math.max(CEILING_MIN_DB, Math.min(CEILING_MAX_DB, this._ceilingDb));
      const limitLinear = Math.pow(10, ceilDb / 20);
      parts.push(
        `alimiter=` +
          `level_in=1:` +
          `level_out=1:` +
          `limit=${limitLinear.toFixed(6)}:` +
          `attack=5:` +
          `release=${this._limiterReleaseMs.toFixed(2)}:` +
          `level=disabled`,
      );
    }

    return parts.join(",");
  }
}
