/**
 * YouTopia DSP — 30-band graphic Equalizer node.
 *
 * Maps to the ffmpeg `equalizer` filter chained 30 times (one per ISO 1/3-octave
 * centre frequency).  Each band is a parametric shelving/peak filter; the set
 * of 30 bands fully covers the audible spectrum at standard ISO 1/3-octave
 * spacing (approximately 25 Hz – 20 kHz).
 *
 * AI-settable params:
 *   • gains   — FloatArray[30], per-band gain in dB, hard-clamped -12..+12
 *   • preampDb — overall makeup gain, -6..+6 dB
 *   • enabled  — Bool
 */

import type {
  DspNode,
  DspNodeState,
  DspParamDescriptor,
  DspParamValue,
} from "../../contracts/index.js";
import { DspNodeType, DspParamType } from "../../contracts/index.js";
import { clampToDescriptor } from "../clamp.js";

// ISO 1/3-octave centre frequencies (25 Hz – 20 kHz, 30 bands)
export const ISO_BAND_FREQS: readonly number[] = [
  25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200,
  250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000,
  2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000,
];

const BAND_COUNT = 30;
const GAIN_MIN = -12;
const GAIN_MAX = 12;
const PREAMP_MIN = -6;
const PREAMP_MAX = 6;
// Q factor for graphic-EQ style bands (constant ~1.41 for 1/3-octave)
const BAND_Q = 1.41;

function defaultGains(): number[] {
  return new Array<number>(BAND_COUNT).fill(0);
}

export class Equalizer implements DspNode {
  readonly nodeId = "eq";
  readonly type = DspNodeType.Equalizer;

  private _enabled = true;
  private _gains: number[] = defaultGains();
  private _preampDb = 0;

  descriptors(): DspParamDescriptor[] {
    return [
      {
        key: "enabled",
        label: "Enable EQ",
        type: DspParamType.Bool,
        default: true,
        describe: "Bypass the 30-band equalizer when false.",
      },
      {
        key: "gains",
        label: "Band Gains (dB)",
        type: DspParamType.FloatArray,
        arrayLength: BAND_COUNT,
        elementMin: GAIN_MIN,
        elementMax: GAIN_MAX,
        step: 0.5,
        default: defaultGains(),
        unit: "dB",
        describe:
          `Array of ${BAND_COUNT} per-band gain values in dB, one per ISO 1/3-octave ` +
          `centre frequency (${ISO_BAND_FREQS[0]} Hz – ${ISO_BAND_FREQS[BAND_COUNT - 1]} Hz). ` +
          `Each clamped to [${GAIN_MIN}, ${GAIN_MAX}] dB.`,
      },
      {
        key: "preampDb",
        label: "Preamp (dB)",
        type: DspParamType.Float,
        min: PREAMP_MIN,
        max: PREAMP_MAX,
        step: 0.5,
        default: 0,
        unit: "dB",
        describe: "Overall output trim applied after all bands.",
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
        gains: [...this._gains],
        preampDb: this._preampDb,
      },
    };
  }

  setParams(values: Record<string, DspParamValue>): Record<string, DspParamValue> {
    const descriptors = this.descriptors();
    const descMap = new Map(descriptors.map((d) => [d.key, d]));

    if ("enabled" in values) {
      this._enabled = clampToDescriptor(descMap.get("enabled")!, values["enabled"]) as boolean;
    }
    if ("gains" in values) {
      this._gains = clampToDescriptor(descMap.get("gains")!, values["gains"]) as number[];
    }
    if ("preampDb" in values) {
      this._preampDb = clampToDescriptor(descMap.get("preampDb")!, values["preampDb"]) as number;
    }

    return {
      enabled: this._enabled,
      gains: [...this._gains],
      preampDb: this._preampDb,
    };
  }

  reset(): void {
    this._enabled = true;
    this._gains = defaultGains();
    this._preampDb = 0;
  }

  /**
   * Build the ffmpeg filter fragment for this node.
   * Returns an empty string when disabled (node is bypassed).
   *
   * Uses 30 chained `equalizer` filters, one per ISO band.
   * Each filter: equalizer=f=<Hz>:t=o:w=<bw>:g=<dB>
   *   t=o  → bandwidth type "octave" — w is octave fraction
   *   w=0.67 → ~2/3 octave bandwidth (1/3 oct each side) for 1/3-oct graphic band
   */
  toFfmpegFragment(): string {
    if (!this._enabled) return "";

    const activeBands = this._gains
      .map((gain, i) => ({ gain, freq: ISO_BAND_FREQS[i]! }))
      .filter(({ gain }) => Math.abs(gain) > 0.01); // skip unity bands for perf

    if (activeBands.length === 0 && this._preampDb === 0) return "";

    const parts: string[] = [];

    for (const { gain, freq } of activeBands) {
      const g = Math.max(GAIN_MIN, Math.min(GAIN_MAX, gain));
      parts.push(`equalizer=f=${freq}:t=o:w=0.67:g=${g.toFixed(2)}`);
    }

    if (this._preampDb !== 0) {
      const clampedPreamp = Math.max(PREAMP_MIN, Math.min(PREAMP_MAX, this._preampDb));
      parts.push(`volume=${clampedPreamp.toFixed(2)}dB`);
    }

    return parts.join(",");
  }
}
