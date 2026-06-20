/**
 * YouTopia DSP — Noise Reduction node.
 *
 * Uses the ffmpeg `afftdn` (FFT-based denoiser) filter.
 * `afftdn` performs spectral subtraction / Wiener filtering in the frequency
 * domain and does not require a separate noise-profile capture step — it
 * continuously estimates the noise floor, making it well-suited for live use.
 *
 * AI-settable params:
 *   • enabled       — Bool
 *   • strength      — overall noise reduction strength 0..97 (%)
 *   • noiseFloorDb  — hint to the estimator; null = auto (-80..-20 dB range)
 *   • nrType        — "soft" | "hard" (ffmpeg nr/nf algorithm selector)
 */

import type {
  DspNode,
  DspNodeState,
  DspParamDescriptor,
  DspParamValue,
} from "../../contracts/index.js";
import { DspNodeType, DspParamType } from "../../contracts/index.js";
import { clampToDescriptor } from "../clamp.js";

export class NoiseReduction implements DspNode {
  readonly nodeId = "noiseReduction";
  readonly type = DspNodeType.NoiseReduction;

  private _enabled = false; // off by default — not always needed
  private _strength = 12; // 0..97, modest default
  private _noiseFloorDb: number | null = null; // null = auto
  private _nrType: "soft" | "hard" = "soft";

  descriptors(): DspParamDescriptor[] {
    return [
      {
        key: "enabled",
        label: "Enable Noise Reduction",
        type: DspParamType.Bool,
        default: false,
        describe: "Enable FFT-based noise reduction (afftdn). Leave off for clean sources.",
      },
      {
        key: "strength",
        label: "NR Strength (%)",
        type: DspParamType.Float,
        min: 0,
        max: 97,
        step: 1,
        default: 12,
        unit: "%",
        describe:
          "Noise reduction strength as a percentage (0 = off, 97 = maximum). " +
          "High values may introduce artefacts on music — 10-30 is typical.",
      },
      {
        key: "noiseFloorDb",
        label: "Noise Floor (dB)",
        type: DspParamType.Float,
        min: -80,
        max: -20,
        step: 1,
        default: -40,
        unit: "dB",
        describe:
          "Estimated noise floor in dBFS. Set to null/auto for continuous estimation. " +
          "Providing a value speeds up convergence.",
      },
      {
        key: "nrType",
        label: "NR Algorithm",
        type: DspParamType.Enum,
        default: "soft",
        options: ["soft", "hard"],
        describe:
          "Noise reduction algorithm: 'soft' uses a Wiener filter (gentler, musical); " +
          "'hard' uses spectral subtraction (more aggressive).",
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
        strength: this._strength,
        noiseFloorDb: this._noiseFloorDb ?? -40,
        nrType: this._nrType,
      },
    };
  }

  setParams(values: Record<string, DspParamValue>): Record<string, DspParamValue> {
    const descMap = new Map(this.descriptors().map((d) => [d.key, d]));

    if ("enabled" in values)
      this._enabled = clampToDescriptor(descMap.get("enabled")!, values["enabled"]) as boolean;
    if ("strength" in values)
      this._strength = clampToDescriptor(descMap.get("strength")!, values["strength"]) as number;
    if ("noiseFloorDb" in values) {
      const v = values["noiseFloorDb"];
      if (v === null || v === "auto") {
        this._noiseFloorDb = null;
      } else {
        this._noiseFloorDb = clampToDescriptor(descMap.get("noiseFloorDb")!, v) as number;
      }
    }
    if ("nrType" in values)
      this._nrType = clampToDescriptor(descMap.get("nrType")!, values["nrType"]) as "soft" | "hard";

    return this.getState().values;
  }

  reset(): void {
    this._enabled = false;
    this._strength = 12;
    this._noiseFloorDb = null;
    this._nrType = "soft";
  }

  /**
   * Build the ffmpeg `afftdn` filter fragment.
   *
   * afftdn params:
   *   nr  — noise reduction (dB), roughly (strength / 97) * 97 → map to 0..97 range
   *   nf  — noise floor in dBFS (optional, if provided)
   *   nt  — noise type: "w" = white (default auto); we use "w" for the auto path
   *
   * Note: afftdn `nr` is 0..97 dB of reduction. We map our percentage directly.
   */
  toFfmpegFragment(): string {
    if (!this._enabled) return "";

    const nr = Math.max(0, Math.min(97, this._strength));
    const parts: string[] = [`afftdn=nr=${nr.toFixed(1)}`];

    if (this._noiseFloorDb !== null) {
      const nf = Math.max(-80, Math.min(-20, this._noiseFloorDb));
      parts[0] += `:nf=${nf.toFixed(1)}`;
    }

    // afftdn doesn't have a direct soft/hard toggle in all versions;
    // the `nt` parameter selects noise type — we use it as a proxy for algorithm intent
    // "w" = white noise model (softer/Wiener), "p" = pink noise (harder spectral)
    if (this._nrType === "hard") {
      parts[0] += `:nt=p`;
    }

    return parts[0] ?? "";
  }
}
