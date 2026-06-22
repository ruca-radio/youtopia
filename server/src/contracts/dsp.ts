/**
 * YouTopia Intelligent Music Server — DSP / enrichment chain contracts.
 *
 * Defines the DSP node interface, the per-effect parameter models, and — most
 * importantly — a JSON-schema-like *param descriptor* model so an AI agent can
 * (a) discover every adjustable parameter, its range, and units, and
 * (b) set parameters via a uniform, allowlisted+clamped path.
 *
 * SAFETY: every parameter carries hard min/max bounds. The AI control surface
 * (see ai.ts) MUST clamp proposed values into [min,max] before they reach a
 * node — mirroring the lightss clampNumber()/SAFE_* allowlist pattern in
 * src/main/integrations/lightss/index.ts. Nodes also re-clamp defensively.
 *
 * Pod C implements nodes (in-process Web Audio-style graph and/or ffmpeg
 * filtergraph). This file is types only.
 */

import type { DspNodeType, DspParamType } from "./enums";

/* ------------------------------------------------------------------ *
 * AI-describable parameter descriptor model
 * ------------------------------------------------------------------ */

/**
 * Self-describing parameter spec. The agent reads an array of these to learn
 * what it may change. Analogous to a single JSON-schema property plus UI hints.
 */
export type DspParamDescriptor = {
  /** Stable key used in get/set, e.g. "threshold", "bands". */
  key: string;
  /** Human label for UI and AI prompts, e.g. "Threshold". */
  label: string;
  type: DspParamType;
  /** Units string for AI/UI, e.g. "dB", "ms", ":1", "Hz". */
  unit?: string;
  /** Hard lower bound (scalar params). AI proposals are clamped to this. */
  min?: number;
  /** Hard upper bound (scalar params). */
  max?: number;
  /** Step granularity for UI; advisory. */
  step?: number;
  /** Safe default applied on reset. */
  default: number | boolean | string | number[];
  /** Allowed values when type === Enum. */
  options?: string[];
  /** For FloatArray params: fixed element count (e.g. 30 EQ bands). */
  arrayLength?: number;
  /** Per-element bounds for FloatArray params. */
  elementMin?: number;
  elementMax?: number;
  /** One-line description fed to the agent. */
  describe: string;
};

/** A concrete parameter value the agent or UI sets. */
export type DspParamValue = number | boolean | string | number[];

/** A set of param mutations targeting one node. */
export type DspParamPatch = {
  nodeId: string;
  values: Record<string, DspParamValue>;
};

/* ------------------------------------------------------------------ *
 * Per-effect parameter models
 * ------------------------------------------------------------------ */

/** One band of the 30-band graphic EQ. */
export type EqBand = {
  /** Center frequency in Hz (ISO 1/3-octave, ~25 Hz .. ~16 kHz). */
  frequencyHz: number;
  /** Gain in dB; bounded (e.g. -12..+12). */
  gainDb: number;
  /** Q / bandwidth; constant per graphic band but exposed for parametric use. */
  q?: number;
};

export type EqualizerParams = {
  enabled: boolean;
  /** Exactly 30 bands. Order matches frequencyHz ascending. */
  bands: EqBand[];
  /** Overall makeup/output gain in dB. */
  preampDb: number;
};

export type CompressorParams = {
  enabled: boolean;
  /** Threshold in dB (negative). Matches store audioCompressorThreshold. */
  thresholdDb: number;
  /** Ratio N:1 (matches store audioCompressorRatio). */
  ratio: number;
  /** Attack in ms (matches store audioCompressorAttack). */
  attackMs: number;
  /** Release in ms (matches store audioCompressorRelease). */
  releaseMs: number;
  /** Knee width in dB. */
  kneeDb: number;
  /** Makeup gain in dB. */
  makeupDb: number;
};

export type LimiterParams = {
  enabled: boolean;
  /** Ceiling in dBFS (e.g. -1.0). Never exceeded on output. */
  ceilingDb: number;
  /** Release in ms. */
  releaseMs: number;
};

export type ExpanderParams = {
  enabled: boolean;
  /** Threshold in dB below which downward expansion applies. */
  thresholdDb: number;
  /** Expansion ratio 1:N. */
  ratio: number;
  /** Attack/release in ms. */
  attackMs: number;
  releaseMs: number;
};

export type NoiseReductionParams = {
  enabled: boolean;
  /** Reduction strength 0..100 (% suppression of noise floor). */
  strength: number;
  /** Estimated/locked noise-floor in dB; null = auto-estimate. */
  noiseFloorDb: number | null;
};

/** Stereo width / "sound expansion" (harmonic + spatial widening). */
export type StereoExpansionParams = {
  enabled: boolean;
  /** Width 0 (mono) .. 200 (%). 100 = unchanged. */
  width: number;
  /** Bass-mono crossover Hz to keep low end centered. */
  bassMonoBelowHz: number;
};

/** Read-only output of the beat detector — not user-set. */
export type BeatDetectionParams = {
  enabled: boolean;
  /** Detection sensitivity 0..100. */
  sensitivity: number;
};

/** Live beat/tempo telemetry emitted on the event bus (see api.ts). */
export type BeatTelemetry = {
  /** Estimated tempo in BPM (bounded 40..220). */
  bpm: number;
  /** Confidence 0..1. */
  confidence: number;
  /** Epoch ms of the most recent detected beat. */
  lastBeatAt: number;
  /** Phase 0..1 within the current beat for visual sync. */
  phase: number;
};

/* ------------------------------------------------------------------ *
 * DSP node + chain
 * ------------------------------------------------------------------ */

/** Serializable snapshot of one node's identity + current values. */
export type DspNodeState = {
  nodeId: string;
  type: DspNodeType;
  enabled: boolean;
  /** Current values keyed by param descriptor key. */
  values: Record<string, DspParamValue>;
};

/**
 * A single processing node in the per-session DSP chain.
 * Nodes are stateless re: AI; they expose descriptors and accept clamped sets.
 */
export interface DspNode {
  readonly nodeId: string;
  readonly type: DspNodeType;

  /** The AI-readable parameter descriptors for this node. */
  descriptors(): DspParamDescriptor[];

  /** Current serializable state. */
  getState(): DspNodeState;

  /**
   * Apply a patch. Implementations MUST clamp each value to its descriptor
   * bounds/allowlist before use and return the effective (clamped) values.
   */
  setParams(values: Record<string, DspParamValue>): Record<string, DspParamValue>;

  /** Restore descriptor defaults. */
  reset(): void;
}

/**
 * The ordered DSP chain bound to a Session. Canonical order:
 * EQ -> Compressor -> Expander -> Limiter -> NoiseReduction -> StereoExpansion,
 * with BeatDetector tapping the signal in parallel (analysis only).
 */
export interface DspChain {
  /** Nodes in signal-flow order. */
  nodes(): DspNode[];
  get(type: DspNodeType): DspNode | undefined;
  /** Full chain snapshot for the AI control surface + client UI. */
  snapshot(): DspNodeState[];
  /** Apply a batch of patches atomically; returns the effective snapshot. */
  applyPatches(patches: DspParamPatch[]): DspNodeState[];
  /** Latest beat telemetry for visualization/lightss hand-off. */
  beat(): BeatTelemetry;
}
