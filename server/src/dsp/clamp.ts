/**
 * YouTopia DSP — clamping helpers.
 *
 * Mirrors the lightss clampNumber discipline so AI-supplied values are always
 * safe before they reach an ffmpeg filter or any audio output path.
 * SAFETY: all values that could affect gain, ceiling, or output level MUST
 * pass through clampToDescriptor() before being forwarded to ffmpeg.
 */

import type { DspParamDescriptor, DspParamValue } from "../contracts/index.js";
import { DspParamType } from "../contracts/index.js";

/**
 * Clamp a numeric value to [min, max].
 * Returns `fallback` if `value` is not a finite number.
 */
export function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Clamp a param value against its descriptor.
 * - Float/Int scalar: clamp to [min, max].
 * - Bool: coerce to boolean.
 * - Enum: allowlist check (falls back to descriptor.default).
 * - FloatArray: clamp each element to [elementMin, elementMax], enforce arrayLength.
 */
export function clampToDescriptor(
  descriptor: DspParamDescriptor,
  value: DspParamValue,
): DspParamValue {
  switch (descriptor.type) {
    case DspParamType.Float:
    case DspParamType.Int: {
      const min = descriptor.min ?? -Infinity;
      const max = descriptor.max ?? Infinity;
      const fallback =
        typeof descriptor.default === "number" ? descriptor.default : 0;
      return clampNumber(value, min, max, fallback);
    }

    case DspParamType.Bool: {
      if (typeof value === "boolean") return value;
      if (value === 1 || value === "true" || value === "1") return true;
      if (value === 0 || value === "false" || value === "0") return false;
      return Boolean(descriptor.default);
    }

    case DspParamType.Enum: {
      const options = descriptor.options ?? [];
      if (typeof value === "string" && options.includes(value)) return value;
      // Fall back to default
      return typeof descriptor.default === "string" ? descriptor.default : options[0] ?? "";
    }

    case DspParamType.FloatArray: {
      if (!Array.isArray(value)) {
        // Return a copy of the default array
        const def = descriptor.default;
        return Array.isArray(def) ? [...def] : [];
      }
      const eMin = descriptor.elementMin ?? -Infinity;
      const eMax = descriptor.elementMax ?? Infinity;
      const len = descriptor.arrayLength ?? value.length;
      const defArr = Array.isArray(descriptor.default)
        ? descriptor.default
        : new Array<number>(len).fill(0);
      return Array.from({ length: len }, (_, i) =>
        clampNumber(value[i], eMin, eMax, defArr[i] ?? 0),
      );
    }

    default:
      return value;
  }
}
