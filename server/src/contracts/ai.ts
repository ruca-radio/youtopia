/**
 * YouTopia Intelligent Music Server — AI control surface.
 *
 * How the agent (reusing the lightss multi-provider pipeline: OpenAI /
 * OpenRouter / Ollama / Gemini — see src/main/integrations/lightss/index.ts)
 * reads the available DSP/playback controls and issues changes from natural
 * language. The agent NEVER writes hardware/DSP directly; it emits intents
 * which the server validates, allowlists, and clamps (same discipline as the
 * lightss SAFE_EFFECTS / clampNumber guardrails).
 */

import type { AiProvider } from "./enums";
import type { DspParamDescriptor, DspParamPatch } from "./dsp";
import type { SearchQuery } from "./media";

/**
 * The machine-readable description of everything the agent may control for a
 * session. Built by the server and handed to the model as context.
 */
export type AiControlSurface = {
  sessionId: string;
  /** All DSP nodes and their AI-readable param descriptors. */
  dsp: Array<{
    nodeId: string;
    type: string;
    params: DspParamDescriptor[];
  }>;
  /** Transport actions the agent may request. */
  transportActions: AiTransportAction[];
  /** Hard safety rules the model is told it must obey (mirrors lightss). */
  safety: AiSafetyRules;
};

/** Transport verbs the agent may emit. */
export type AiTransportAction =
  | "play"
  | "pause"
  | "next"
  | "previous"
  | "seek"
  | "setVolume"
  | "enqueue"
  | "playNow"
  | "setRepeat"
  | "setShuffle";

/** Safety envelope passed to the model and enforced server-side. */
export type AiSafetyRules = {
  /** No strobe/blink/flash (carried through to visualization/WLED). */
  noStrobe: boolean;
  noBlinkingEffects: boolean;
  /** DSP values are clamped to descriptor bounds before apply. */
  clampDspToDescriptorBounds: boolean;
  /** WLED primary color must match the TV VU hot color. */
  alignWledToVuHotColor: boolean;
  /** TV base stays true black. */
  trueBlackTvBase: boolean;
};

/** A single natural-language request from a user (typed or transcribed). */
export type AiChatRequest = {
  sessionId: string;
  userId: string;
  text: string;
  /** Optional provider override; defaults to configured provider. */
  provider?: AiProvider;
};

/**
 * Structured intent the model returns. The server resolves each intent into
 * concrete, validated operations. Unknown/unsafe intents are dropped.
 */
export type AiIntent =
  | { kind: "transport"; action: AiTransportAction; arg?: number | string | boolean }
  | { kind: "search"; query: SearchQuery }
  | { kind: "dsp"; patches: DspParamPatch[] }
  | { kind: "lighting"; note: string } // delegated to existing lightss pipeline
  | { kind: "answer"; text: string };

/** The agent's full response to a chat request. */
export type AiChatResponse = {
  sessionId: string;
  /** Natural-language reply to show the user. */
  reply: string;
  /** Ordered intents the server will execute (post-validation). */
  intents: AiIntent[];
  provider: AiProvider;
  model: string;
  /** Intents rejected by safety/allowlist, for transparency/debugging. */
  rejected?: Array<{ intent: AiIntent; reason: string }>;
};

/**
 * The agent runtime. Reuses lightss provider plumbing; lives server-side so
 * both the desktop app and remote clients share one brain.
 */
export interface AiController {
  /** Build the control surface the model reasons over for a session. */
  describeSurface(sessionId: string): AiControlSurface;
  /** Run a chat turn: returns reply + validated intents (already clamped). */
  handle(request: AiChatRequest): Promise<AiChatResponse>;
}
