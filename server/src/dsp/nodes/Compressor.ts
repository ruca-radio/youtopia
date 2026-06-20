/**
 * YouTopia DSP — Dynamic Range Compressor node.
 *
 * Maps to the ffmpeg `acompressor` filter.
 * All params are AI-readable via DspParamDescriptor and hard-clamped to safe
 * ranges (mirrors lightss clampNumber discipline).
 *
 * AI-settable params:
 *   • enabled      — Bool
 *   • thresholdDb  — input level above which compression starts (-60..0 dB)
 *   • ratio        — compression ratio N:1 (1..20)
 *   • attackMs     — attack time in ms (0.01..200)
 *   • releaseMs    — release time in ms (1..9000)
 *   • kneeDb       — soft-knee width in dB (0..40)
 *   • makeupDb     — makeup gain applied after compression (0..24 dB)
 */

import type {
  DspNode,
  DspNodeState,
  DspParamDescriptor,
  DspParamValue,
} from "../../contracts/index.js";
import { DspNodeType, DspParamType } from "../../contracts/index.js";
import { clampToDescriptor } from "../clamp.js";

export class Compressor implements DspNode {
  readonly nodeId = "compressor";
  readonly type = DspNodeType.Compressor;

  private _enabled = true;
  private _thresholdDb = -18;
  private _ratio = 3;
  private _attackMs = 20;
  private _releaseMs = 250;
  private _kneeDb = 2.82843; // ffmpeg default
  private _makeupDb = 0;

  descriptors(): DspParamDescriptor[] {
    return [
      {
        key: "enabled",
        label: "Enable Compressor",
        type: DspParamType.Bool,
        default: true,
        describe: "Bypass dynamic range compressor when false.",
      },
      {
        key: "thresholdDb",
        label: "Threshold (dBFS)",
        type: DspParamType.Float,
        min: -60,
        max: 0,
        step: 0.5,
        default: -18,
        unit: "dB",
        describe: "Level above which compression is applied. Typical range -30 to -6 dB.",
      },
      {
        key: "ratio",
        label: "Ratio",
        type: DspParamType.Float,
        min: 1,
        max: 20,
        step: 0.1,
        default: 3,
        unit: ":1",
        describe: "Compression ratio N:1. 2 = gentle, 4 = moderate, 10+ = hard limiting.",
      },
      {
        key: "attackMs",
        label: "Attack (ms)",
        type: DspParamType.Float,
        min: 0.01,
        max: 200,
        step: 0.5,
        default: 20,
        unit: "ms",
        describe: "Time to reach full compression after signal exceeds threshold.",
      },
      {
        key: "releaseMs",
        label: "Release (ms)",
        type: DspParamType.Float,
        min: 1,
        max: 9000,
        step: 1,
        default: 250,
        unit: "ms",
        describe: "Time to recover to unity gain after signal drops below threshold.",
      },
      {
        key: "kneeDb",
        label: "Knee Width (dB)",
        type: DspParamType.Float,
        min: 0,
        max: 40,
        step: 0.5,
        default: 2.83,
        unit: "dB",
        describe: "Knee width in dB for a softer transition into compression. 0 = hard knee.",
      },
      {
        key: "makeupDb",
        label: "Makeup Gain (dB)",
        type: DspParamType.Float,
        min: 0,
        max: 24,
        step: 0.5,
        default: 0,
        unit: "dB",
        describe: "Gain applied after compression to restore perceived loudness.",
      },
    ];
  }

  getState(): DspNodeState {
    return {
      nodeId: this.nodeId,
      type: this.type,
      enabled: this._enabled,
      values: {
        enabled: this._enabled,
        thresholdDb: this._thresholdDb,
        ratio: this._ratio,
        attackMs: this._attackMs,
        releaseMs: this._releaseMs,
        kneeDb: this._kneeDb,
        makeupDb: this._makeupDb,
      },
    };
  }

  setParams(values: Record<string, DspParamValue>): Record<string, DspParamValue> {
    const descMap = new Map(this.descriptors().map((d) => [d.key, d]));

    if ("enabled" in values)
      this._enabled = clampToDescriptor(descMap.get("enabled")!, values["enabled"]) as boolean;
    if ("thresholdDb" in values)
      this._thresholdDb = clampToDescriptor(descMap.get("thresholdDb")!, values["thresholdDb"]) as number;
    if ("ratio" in values)
      this._ratio = clampToDescriptor(descMap.get("ratio")!, values["ratio"]) as number;
    if ("attackMs" in values)
      this._attackMs = clampToDescriptor(descMap.get("attackMs")!, values["attackMs"]) as number;
    if ("releaseMs" in values)
      this._releaseMs = clampToDescriptor(descMap.get("releaseMs")!, values["releaseMs"]) as number;
    if ("kneeDb" in values)
      this._kneeDb = clampToDescriptor(descMap.get("kneeDb")!, values["kneeDb"]) as number;
    if ("makeupDb" in values)
      this._makeupDb = clampToDescriptor(descMap.get("makeupDb")!, values["makeupDb"]) as number;

    return this.getState().values;
  }

  reset(): void {
    this._enabled = true;
    this._thresholdDb = -18;
    this._ratio = 3;
    this._attackMs = 20;
    this._releaseMs = 250;
    this._kneeDb = 2.82843;
    this._makeupDb = 0;
  }

  /**
   * Build the ffmpeg `acompressor` filter string.
   * Returns empty string when disabled.
   *
   * ffmpeg acompressor params:
   *   threshold — linear gain (0..1), so we convert from dB
   *   ratio, attack (ms), release (ms), knee (dB), makeup (linear)
   */
  toFfmpegFragment(): string {
    if (!this._enabled) return "";

    // ffmpeg acompressor uses threshold as a ratio 0..1 (linear amplitude)
    const threshold = Math.pow(10, this._thresholdDb / 20);
    const clampedThreshold = Math.max(0.000977, Math.min(1, threshold));

    const makeup = Math.pow(10, this._makeupDb / 20);
    const clampedMakeup = Math.max(1, Math.min(64, makeup));

    return (
      `acompressor=` +
      `threshold=${clampedThreshold.toFixed(6)}:` +
      `ratio=${this._ratio.toFixed(2)}:` +
      `attack=${this._attackMs.toFixed(2)}:` +
      `release=${this._releaseMs.toFixed(2)}:` +
      `knee=${this._kneeDb.toFixed(4)}:` +
      `makeup=${clampedMakeup.toFixed(4)}`
    );
  }
}
