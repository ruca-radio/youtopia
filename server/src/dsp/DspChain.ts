/**
 * YouTopia DSP — DspChain implementation.
 *
 * Implements the DspChain contract: ordered list of nodes in canonical signal
 * order, produces a combined ffmpeg filtergraph string, supports per-node
 * enable/bypass, applies DspParamPatch sets with clamping, and serializes
 * state for the AI control surface + client UI.
 *
 * Canonical signal order (per ADR-0003):
 *   EQ → Compressor → Expander/Limiter → NoiseReduction → StereoExpansion
 *   (BeatDetector taps audio in parallel — analysis only, not in the main graph)
 */

import type {
  DspChain as IDspChain,
  DspNode,
  DspNodeState,
  DspParamPatch,
  BeatTelemetry,
} from "../contracts/index.js";
import { DspNodeType } from "../contracts/index.js";

import { Equalizer } from "./nodes/Equalizer.js";
import { Compressor } from "./nodes/Compressor.js";
import { LimiterExpander } from "./nodes/LimiterExpander.js";
import { NoiseReduction } from "./nodes/NoiseReduction.js";
import { SoundExpansion } from "./nodes/SoundExpansion.js";

/** Minimum beat telemetry shape (updated by BeatDetector). */
const DEFAULT_BEAT_TELEMETRY: BeatTelemetry = {
  bpm: 0,
  confidence: 0,
  lastBeatAt: 0,
  phase: 0,
};

/**
 * Concrete DspChain.  Instantiate one per Session.
 * All nodes are pre-created and ordered; each can be individually bypassed.
 */
export class DspChainImpl implements IDspChain {
  private readonly _nodes: DspNode[];
  private _beatTelemetry: BeatTelemetry = { ...DEFAULT_BEAT_TELEMETRY };

  constructor() {
    // Canonical order: EQ → Compressor → LimiterExpander → NoiseReduction → StereoExpansion
    this._nodes = [
      new Equalizer(),
      new Compressor(),
      new LimiterExpander(),
      new NoiseReduction(),
      new SoundExpansion(),
    ];
  }

  // ── DspChain interface ──────────────────────────────────────────────────

  nodes(): DspNode[] {
    return [...this._nodes];
  }

  get(type: DspNodeType): DspNode | undefined {
    return this._nodes.find((n) => n.type === type);
  }

  snapshot(): DspNodeState[] {
    return this._nodes.map((n) => n.getState());
  }

  applyPatches(patches: DspParamPatch[]): DspNodeState[] {
    for (const patch of patches) {
      const node = this._nodes.find((n) => n.nodeId === patch.nodeId);
      if (node) {
        node.setParams(patch.values);
      }
    }
    return this.snapshot();
  }

  beat(): BeatTelemetry {
    return { ...this._beatTelemetry };
  }

  // ── Additional methods for runtime use ─────────────────────────────────

  /**
   * Build the complete ffmpeg audio filtergraph string for this chain.
   * Nodes that are disabled/bypassed are omitted.
   * Returns an empty string if no active nodes produce a filter.
   *
   * Usage: pass this string to ffmpeg as `-af "<graph>"`.
   */
  buildFfmpegFiltergraph(): string {
    const fragments: string[] = [];

    for (const node of this._nodes) {
      // Only nodes with a toFfmpegFragment() method (our concrete nodes)
      const frag = (node as NodeWithFfmpeg).toFfmpegFragment?.();
      if (frag && frag.trim().length > 0) {
        fragments.push(frag.trim());
      }
    }

    return fragments.join(",");
  }

  /**
   * Update the beat telemetry from BeatDetector.
   * Called by the BeatDetector on each analysis cycle.
   */
  updateBeat(telemetry: BeatTelemetry): void {
    this._beatTelemetry = { ...telemetry };
  }

  /**
   * Reset all nodes to their default parameter values.
   */
  resetAll(): void {
    for (const node of this._nodes) {
      node.reset();
    }
    this._beatTelemetry = { ...DEFAULT_BEAT_TELEMETRY };
  }
}

/** Local structural type — concrete DSP nodes expose this method. */
interface NodeWithFfmpeg {
  toFfmpegFragment?: () => string;
}

/** Factory: create a fresh DspChain for a new session. */
export function createDspChain(): DspChainImpl {
  return new DspChainImpl();
}
