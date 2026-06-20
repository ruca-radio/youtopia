/**
 * YouTopia DSP — plugin registration entry point.
 *
 * Registers the DSP subsystem with the plugin loader.  At boot, this:
 *   1. Wires a DSP route to the Fastify app (GET /api/v1/dsp/:sessionId/surface,
 *      PATCH /api/v1/dsp/:sessionId/params) so the AI agent and client UI can
 *      read + set DSP parameters.
 *   2. Exposes createDspChain() and createAiDspControl() factories that the
 *      session layer (Pod D) calls to build per-session DSP instances.
 *
 * File ownership: server/src/dsp/** — Pod C only.
 */

import { registerPlugin } from "../plugins/loader.js";
import type { DspChainImpl } from "./DspChain.js";
import type { AiDspControl } from "./AiDspControl.js";
import { createDspChain } from "./DspChain.js";
import { createAiDspControl } from "./AiDspControl.js";
import { BeatDetector } from "./BeatDetector.js";

// ── Re-exports for other pods ─────────────────────────────────────────────────

export { createDspChain } from "./DspChain.js";
export { createAiDspControl } from "./AiDspControl.js";
export { BeatDetector, generateClickTrack } from "./BeatDetector.js";
export type { DspChainImpl } from "./DspChain.js";
export type { AiDspControl } from "./AiDspControl.js";

// ── Per-session factory ───────────────────────────────────────────────────────

/** Create a full DSP stack for one session (chain + AI control + beat detector). */
export function createSessionDsp(sessionId: string): {
  chain: DspChainImpl;
  aiControl: AiDspControl;
  beatDetector: BeatDetector;
} {
  const chain = createDspChain();
  const aiControl = createAiDspControl(chain);
  const beatDetector = new BeatDetector();

  // Wire beat telemetry updates into the chain
  beatDetector.on("beat", (telemetry) => {
    chain.updateBeat(telemetry);
  });

  void sessionId; // reserved for future session-specific initialization

  return { chain, aiControl, beatDetector };
}

// ── Plugin registration ───────────────────────────────────────────────────────

registerPlugin({
  name: "dsp",
  async setup(ctx) {
    ctx.logger.info("DSP subsystem initializing");

    // ── REST routes ──────────────────────────────────────────────────────────
    // INTEGRATION (Gap 1): These legacy routes now delegate to the shared
    // per-session DSP registry (session/dspRegistry.ts) so both route families
    // (/api/v1/dsp/:sessionId/* and /api/v1/sessions/:sid/dsp) share the same
    // DspChain instance.  Falls back to a local map for sessions not yet in
    // the registry (edge case: DSP accessed before session engine boots).

    const { getSessionDsp: getRegistryDsp } = await import("../session/dspRegistry.js");

    const localFallbackMap = new Map<string, ReturnType<typeof createSessionDsp>>();

    function getOrCreateDsp(sessionId: string): ReturnType<typeof createSessionDsp> {
      // Prefer the real chain from the registry (Gap 1)
      const registered = getRegistryDsp(sessionId);
      if (registered) return registered;
      // Fall back to local (shouldn't happen in normal flow once session engine is up)
      if (!localFallbackMap.has(sessionId)) {
        localFallbackMap.set(sessionId, createSessionDsp(sessionId));
      }
      return localFallbackMap.get(sessionId)!;
    }

    // GET /api/v1/dsp/:sessionId/surface
    // Returns the AiControlSurface.dsp section — all param descriptors + current values.
    ctx.fastify.get<{ Params: { sessionId: string } }>(
      "/api/v1/dsp/:sessionId/surface",
      async (request, reply) => {
        const { sessionId } = request.params;
        const { aiControl } = getOrCreateDsp(sessionId);
        const surface = aiControl.buildControlSurface(sessionId);
        return reply.send(surface);
      },
    );

    // GET /api/v1/dsp/:sessionId/snapshot
    // Returns the current DspNodeState[] for all nodes.
    ctx.fastify.get<{ Params: { sessionId: string } }>(
      "/api/v1/dsp/:sessionId/snapshot",
      async (request, reply) => {
        const { sessionId } = request.params;
        const { aiControl } = getOrCreateDsp(sessionId);
        return reply.send(aiControl.getSnapshot());
      },
    );

    // PATCH /api/v1/dsp/:sessionId/params
    // Apply DspParamPatch[] from the AI agent or UI.
    // Body: { patches: DspParamPatch[] }
    ctx.fastify.patch<{
      Params: { sessionId: string };
      Body: { patches: Array<{ nodeId: string; values: Record<string, unknown> }> };
    }>(
      "/api/v1/dsp/:sessionId/params",
      async (request, reply) => {
        const { sessionId } = request.params;
        const body = request.body ?? {};
        const patches = Array.isArray(body.patches) ? body.patches : [];
        const { aiControl } = getOrCreateDsp(sessionId);
        const newState = aiControl.applyPatches(patches as never);
        return reply.send({ snapshot: newState });
      },
    );

    // GET /api/v1/dsp/:sessionId/beat
    // Returns the latest BeatTelemetry for visualization/lightss handoff.
    ctx.fastify.get<{ Params: { sessionId: string } }>(
      "/api/v1/dsp/:sessionId/beat",
      async (request, reply) => {
        const { sessionId } = request.params;
        const { chain } = getOrCreateDsp(sessionId);
        return reply.send(chain.beat());
      },
    );

    ctx.logger.info(
      {
        routes: [
          "GET /api/v1/dsp/:sessionId/surface",
          "GET /api/v1/dsp/:sessionId/snapshot",
          "PATCH /api/v1/dsp/:sessionId/params",
          "GET /api/v1/dsp/:sessionId/beat",
        ],
      },
      "DSP routes registered",
    );
  },
});
