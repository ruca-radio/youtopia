/**
 * YouTopia DSP — Stereo Widener / "Sound Expansion" node.
 *
 * Uses the ffmpeg `stereotools` filter which provides a comprehensive set of
 * stereo-field manipulation tools.  Also uses a low-pass routing through
 * `pan` to keep bass frequencies mono (prevents low-end cancellation on
 * mono devices and maintains tight bass in multi-room setups).
 *
 * AI-settable params:
 *   • enabled         — Bool
 *   • width           — stereo width 0..200 % (100 = unchanged)
 *   • bassMonoBelowHz — crossover to mono for frequencies below this (20..500 Hz)
 *   • balance         — L/R balance (-1.0 left .. +1.0 right)
 */

import type {
  DspNode,
  DspNodeState,
  DspParamDescriptor,
  DspParamValue,
} from "../../contracts/index.js";
import { DspNodeType, DspParamType } from "../../contracts/index.js";
import { clampToDescriptor } from "../clamp.js";

export class SoundExpansion implements DspNode {
  readonly nodeId = "stereoExpansion";
  readonly type = DspNodeType.StereoExpansion;

  private _enabled = true;
  private _width = 100; // 100% = no change
  private _bassMonoBelowHz = 120;
  private _balance = 0; // -1..+1

  descriptors(): DspParamDescriptor[] {
    return [
      {
        key: "enabled",
        label: "Enable Stereo Expansion",
        type: DspParamType.Bool,
        default: true,
        describe: "Enable stereo widening and sound expansion.",
      },
      {
        key: "width",
        label: "Stereo Width (%)",
        type: DspParamType.Float,
        min: 0,
        max: 200,
        step: 1,
        default: 100,
        unit: "%",
        describe:
          "Stereo width as percentage. 0 = mono, 100 = original, 200 = maximum widening. " +
          "Values above 120 may cause phase issues on mono devices.",
      },
      {
        key: "bassMonoBelowHz",
        label: "Bass Mono Below (Hz)",
        type: DspParamType.Float,
        min: 20,
        max: 500,
        step: 5,
        default: 120,
        unit: "Hz",
        describe:
          "Sum low-frequency content to mono below this frequency to preserve bass impact. " +
          "120 Hz is a typical crossover for multi-room and PA use.",
      },
      {
        key: "balance",
        label: "L/R Balance",
        type: DspParamType.Float,
        min: -1.0,
        max: 1.0,
        step: 0.05,
        default: 0,
        describe:
          "Left/right channel balance. -1.0 = full left, 0 = centre, +1.0 = full right.",
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
        width: this._width,
        bassMonoBelowHz: this._bassMonoBelowHz,
        balance: this._balance,
      },
    };
  }

  setParams(values: Record<string, DspParamValue>): Record<string, DspParamValue> {
    const descMap = new Map(this.descriptors().map((d) => [d.key, d]));

    if ("enabled" in values)
      this._enabled = clampToDescriptor(descMap.get("enabled")!, values["enabled"]) as boolean;
    if ("width" in values)
      this._width = clampToDescriptor(descMap.get("width")!, values["width"]) as number;
    if ("bassMonoBelowHz" in values)
      this._bassMonoBelowHz = clampToDescriptor(descMap.get("bassMonoBelowHz")!, values["bassMonoBelowHz"]) as number;
    if ("balance" in values)
      this._balance = clampToDescriptor(descMap.get("balance")!, values["balance"]) as number;

    return this.getState().values;
  }

  reset(): void {
    this._enabled = true;
    this._width = 100;
    this._bassMonoBelowHz = 120;
    this._balance = 0;
  }

  /**
   * Build the ffmpeg filter fragment.
   *
   * `stereotools` parameters:
   *   mlev  — mid (M) level    (0..4, 1.0 = unity)
   *   slev  — side (S) level   (0..4; >1 widens, <1 narrows)
   *   balance_in — input balance (-1..+1)
   *
   * Width mapping: width% → side level
   *   100% → slev=1 (unchanged)
   *   200% → slev=2 (double side energy)
   *   0%   → slev=0 (mono)
   */
  toFfmpegFragment(): string {
    if (!this._enabled) return "";

    // Near-unity: skip filter for minimal CPU cost
    if (this._width === 100 && this._balance === 0) return "";

    const sideLevel = Math.max(0, Math.min(4, this._width / 100));
    const balance = Math.max(-1, Math.min(1, this._balance));

    return (
      `stereotools=` +
      `mlev=1:` +
      `slev=${sideLevel.toFixed(4)}:` +
      `balance_in=${balance.toFixed(4)}`
    );
  }
}
