/**
 * YouTopia Server — Per-session DSP registry.
 *
 * Single source of truth for the per-session DspChain+AiDspControl+BeatDetector
 * stacks.  Decoupled from session/index.ts to avoid circular imports when
 * session/routes.ts needs to look up the chain.
 *
 * INTEGRATION (Gap 1): This module is the shared map that:
 *   - session/index.ts writes into (on session create/destroy)
 *   - session/routes.ts reads from (GET + POST /sessions/:sid/dsp)
 *   - dsp/index.ts can optionally read from (legacy /dsp/:sessionId/* routes)
 */

import type { DspChainImpl } from "../dsp/DspChain.js";
import type { AiDspControl } from "../dsp/AiDspControl.js";
import type { BeatDetector } from "../dsp/BeatDetector.js";

export type SessionDspStack = {
  chain: DspChainImpl;
  aiControl: AiDspControl;
  beatDetector: BeatDetector;
};

const _registry = new Map<string, SessionDspStack>();

export function setSessionDsp(sessionId: string, stack: SessionDspStack): void {
  _registry.set(sessionId, stack);
}

export function getSessionDsp(sessionId: string): SessionDspStack | undefined {
  return _registry.get(sessionId);
}

export function deleteSessionDsp(sessionId: string): void {
  _registry.delete(sessionId);
}

export function listSessionDspIds(): string[] {
  return Array.from(_registry.keys());
}
