/**
 * YouTopia DSP — AI DSP Control Surface bridge.
 *
 * This module bridges the DspChain to the AI control surface defined in
 * contracts/ai.ts.  It:
 *
 *   1. Builds an AiControlSurface.dsp descriptor array so an AI agent can
 *      discover every adjustable parameter, its range, units, and defaults.
 *
 *   2. Applies DspParamPatch[] (validated + clamped) to the DspChain
 *      — mirroring the lightss clampNumber/SAFE_* allowlist discipline.
 *
 *   3. Maps natural-language-ish intents (e.g. { target: "compressor.ratio",
 *      value: 4 }) through a simple dot-notation resolver into typed patches.
 *
 *   4. Exposes a buildControlSurface() helper that other pods / the REST
 *      handler can call to hand context to the AI agent.
 *
 * SAFETY:
 *   - All values are HARD-CLAMPED to descriptor [min, max] before they
 *     reach any node.  No raw AI value ever reaches ffmpeg directly.
 *   - The limiter ceiling can only be set within CEILING_MAX_DB = -0.1 dBFS
 *     (enforced in LimiterExpander.ts).
 *   - Unknown nodeId or param keys are silently ignored (allowlist approach).
 */

import type {
  AiControlSurface,
  AiSafetyRules,
  DspParamDescriptor,
  DspParamPatch,
  DspNodeState,
} from "../contracts/index.js";
import type { DspChainImpl } from "./DspChain.js";
import { clampToDescriptor } from "./clamp.js";

// ── Safety rules (declared once, handed to the model with every request) ─────

export const DSP_SAFETY_RULES: AiSafetyRules = {
  noStrobe: true,
  noBlinkingEffects: true,
  clampDspToDescriptorBounds: true,
  alignWledToVuHotColor: true,
  trueBlackTvBase: true,
};

// ── Per-node param cache ──────────────────────────────────────────────────────

/** One entry in the AiControlSurface.dsp array. */
export type AiDspNodeEntry = {
  nodeId: string;
  type: string;
  params: DspParamDescriptor[];
};

// ── AiDspControl ─────────────────────────────────────────────────────────────

export class AiDspControl {
  private readonly _chain: DspChainImpl;

  constructor(chain: DspChainImpl) {
    this._chain = chain;
  }

  // ── Surface building ──────────────────────────────────────────────────────

  /**
   * Build the dsp section of an AiControlSurface for the given session.
   * The returned object is safe to serialize and send to the AI model.
   */
  buildControlSurface(sessionId: string): AiControlSurface {
    const dsp: AiControlSurface["dsp"] = this._chain.nodes().map((node) => ({
      nodeId: node.nodeId,
      type: node.type,
      params: node.descriptors(),
    }));

    return {
      sessionId,
      dsp,
      transportActions: [
        "play",
        "pause",
        "next",
        "previous",
        "seek",
        "setVolume",
        "enqueue",
        "playNow",
        "setRepeat",
        "setShuffle",
      ],
      safety: DSP_SAFETY_RULES,
    };
  }

  /**
   * Get the current AI-readable state snapshot (nodeId + values for all nodes).
   */
  getSnapshot(): DspNodeState[] {
    return this._chain.snapshot();
  }

  // ── Intent → Patch resolution ─────────────────────────────────────────────

  /**
   * Map a natural-language-style intent to a clamped DspParamPatch[].
   *
   * Supported target formats:
   *   "compressor.ratio"    → nodeId="compressor", key="ratio"
   *   "eq.gains"            → nodeId="eq",          key="gains"
   *   "limiter.ceilingDb"   → nodeId="limiter",     key="ceilingDb"
   *
   * The value is clamped to the param descriptor bounds before being applied.
   * Unknown nodeId or param keys are ignored.
   *
   * @param target  dot-notation path "nodeId.paramKey"
   * @param value   Raw value from the agent (not yet validated)
   * @returns       Effective (clamped) DspNodeState[] after applying the patch
   */
  applyIntent(
    target: string,
    value: unknown,
  ): DspNodeState[] {
    const dotIdx = target.indexOf(".");
    if (dotIdx < 0) return this._chain.snapshot();

    const nodeId = target.slice(0, dotIdx);
    const key = target.slice(dotIdx + 1);

    const node = this._chain.nodes().find((n) => n.nodeId === nodeId);
    if (!node) return this._chain.snapshot();

    const desc = node.descriptors().find((d) => d.key === key);
    if (!desc) return this._chain.snapshot();

    // Clamp the incoming value before passing to the node
    const clamped = clampToDescriptor(desc, value as never);

    return this._chain.applyPatches([
      { nodeId, values: { [key]: clamped } },
    ]);
  }

  /**
   * Apply a batch of raw DspParamPatch[] from the AI agent.
   * Each value is re-clamped to its descriptor bounds.
   *
   * @param patches  Raw patches from the AI model.
   * @returns        Effective (clamped) DspNodeState[] after all patches applied.
   */
  applyPatches(patches: DspParamPatch[]): DspNodeState[] {
    const safePatchList: DspParamPatch[] = [];

    for (const patch of patches) {
      const node = this._chain.nodes().find((n) => n.nodeId === patch.nodeId);
      if (!node) continue; // unknown nodeId — drop

      const descMap = new Map(node.descriptors().map((d) => [d.key, d]));
      const safeValues: DspParamPatch["values"] = {};

      for (const [key, rawValue] of Object.entries(patch.values)) {
        const desc = descMap.get(key);
        if (!desc) continue; // unknown key — drop (allowlist)
        safeValues[key] = clampToDescriptor(desc, rawValue);
      }

      if (Object.keys(safeValues).length > 0) {
        safePatchList.push({ nodeId: patch.nodeId, values: safeValues });
      }
    }

    return this._chain.applyPatches(safePatchList);
  }

  // ── Convenience getters ───────────────────────────────────────────────────

  /** Return all DspParamDescriptors across all nodes (flattened). */
  allDescriptors(): AiDspNodeEntry[] {
    return this._chain.nodes().map((node) => ({
      nodeId: node.nodeId,
      type: node.type,
      params: node.descriptors(),
    }));
  }

  /** Current filtergraph string — for logging/debugging. */
  currentFiltergraph(): string {
    return this._chain.buildFfmpegFiltergraph();
  }
}

/** Factory: create an AiDspControl bound to a DspChainImpl. */
export function createAiDspControl(chain: DspChainImpl): AiDspControl {
  return new AiDspControl(chain);
}
