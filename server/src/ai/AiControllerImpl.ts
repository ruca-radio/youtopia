/**
 * YouTopia Server — AiController implementation.
 *
 * Implements the AiController contract (ai.ts):
 *   describeSurface(sessionId) → AiControlSurface
 *   handle(request)           → AiChatResponse
 *
 * Surface building aggregates:
 *   - DSP control surface (from AiDspControl.buildControlSurface)
 *   - Available transport actions
 *   - Current now-playing snapshot
 *   - Safety rules
 *
 * Chat handling:
 *   1. Build control surface as context.
 *   2. Call configured AI provider (Ollama default per PM Decision #4).
 *   3. Parse structured intents from the response.
 *   4. VALIDATE + CLAMP all DSP patches (hard rule — never skip).
 *   5. Apply validated intents via the session's DspChain / SessionManager.
 *   6. Degrade gracefully if the provider is unreachable.
 *
 * SAFETY INVARIANT: No AI-emitted numeric value reaches a DSP node without
 * passing through AiDspControl.applyPatches() (which calls clampToDescriptor
 * on every value). Unknown nodeIds and param keys are silently dropped.
 */

import type {
  AiController,
  AiControlSurface,
  AiChatRequest,
  AiChatResponse,
  AiIntent,
  AiTransportAction,
} from "../contracts/index.js";
import { AiProvider } from "../contracts/index.js";
import type { SessionManager } from "../session/SessionManager.js";
import type { AiDspControl } from "../dsp/AiDspControl.js";
import { DSP_SAFETY_RULES } from "../dsp/AiDspControl.js";
import type { AiConfig } from "../config/index.js";
import { callProvider, extractJsonObject } from "./providers.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Per-session DSP registry (shared with dsp/index.ts plugin)
// ---------------------------------------------------------------------------

/** Map of sessionId → AiDspControl. Populated by wiring in session/index.ts.
 * NOTE: We maintain this map here (rather than in session/dspRegistry) because
 * the AI controller needs AiDspControl specifically, and the registry already
 * serves both route families. Keeping a separate map avoids adding another
 * dependency from ai/ → session/dspRegistry. */
const sessionDspControls = new Map<string, AiDspControl>();

export function registerSessionDspControl(sessionId: string, control: AiDspControl): void {
  sessionDspControls.set(sessionId, control);
}

export function unregisterSessionDspControl(sessionId: string): void {
  sessionDspControls.delete(sessionId);
}

export function getSessionDspControl(sessionId: string): AiDspControl | undefined {
  return sessionDspControls.get(sessionId);
}

// ---------------------------------------------------------------------------
// AI response schema
// ---------------------------------------------------------------------------

/** JSON schema we ask the model to conform to for structured intents. */
const INTENT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "intents"],
  properties: {
    reply: { type: "string", description: "Natural-language reply to show the user." },
    intents: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: ["kind"],
        properties: {
          kind: { type: "string", enum: ["transport", "search", "dsp", "lighting", "answer"] },
        },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Intent validation / allowlisting
// ---------------------------------------------------------------------------

const ALLOWED_TRANSPORT_ACTIONS: Set<string> = new Set<AiTransportAction>([
  "play", "pause", "next", "previous", "seek", "setVolume",
  "enqueue", "playNow", "setRepeat", "setShuffle",
]);

type ParsedIntent = { intent: AiIntent; rejected: boolean; reason?: string };

/**
 * Validate and allowlist a raw intent object from the AI.
 * Returns { intent, rejected: false } if valid, or { rejected: true, reason } if not.
 */
function validateIntent(raw: unknown): ParsedIntent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      intent: { kind: "answer", text: "invalid intent shape" } as AiIntent,
      rejected: true,
      reason: "Intent must be a non-null object",
    };
  }

  const obj = raw as Record<string, unknown>;

  switch (obj["kind"]) {
    case "transport": {
      const action = obj["action"] as string;
      if (!ALLOWED_TRANSPORT_ACTIONS.has(action)) {
        return {
          intent: obj as unknown as AiIntent,
          rejected: true,
          reason: `Transport action "${action}" not in allowlist`,
        };
      }
      return {
        intent: {
          kind: "transport",
          action: action as AiTransportAction,
          arg: obj["arg"] as number | string | boolean | undefined,
        },
        rejected: false,
      };
    }

    case "dsp": {
      // Patches will be validated+clamped by AiDspControl; just typecheck the shape
      if (!Array.isArray(obj["patches"])) {
        return {
          intent: obj as unknown as AiIntent,
          rejected: true,
          reason: "DSP intent must have patches array",
        };
      }
      return {
        intent: {
          kind: "dsp",
          patches: (obj["patches"] as Array<{ nodeId: string; values: Record<string, unknown> }>).filter(
            (p) => typeof p?.nodeId === "string" && p?.values && typeof p?.values === "object",
          ) as AiIntent & { kind: "dsp" } extends { patches: infer P } ? P : never,
        } as AiIntent,
        rejected: false,
      };
    }

    case "search": {
      const q = obj["query"];
      if (!q || typeof q !== "object" || Array.isArray(q)) {
        return {
          intent: obj as unknown as AiIntent,
          rejected: true,
          reason: "Search intent must have query object",
        };
      }
      return { intent: { kind: "search", query: q as AiIntent & { kind: "search" } extends { query: infer Q } ? Q : never } as AiIntent, rejected: false };
    }

    case "lighting": {
      return {
        intent: { kind: "lighting", note: String(obj["note"] ?? "") },
        rejected: false,
      };
    }

    case "answer": {
      return {
        intent: { kind: "answer", text: String(obj["text"] ?? "") },
        rejected: false,
      };
    }

    default:
      return {
        intent: obj as unknown as AiIntent,
        rejected: true,
        reason: `Unknown intent kind: "${String(obj["kind"])}"`,
      };
  }
}

// ---------------------------------------------------------------------------
// AiControllerImpl
// ---------------------------------------------------------------------------

export class AiControllerImpl implements AiController {
  private readonly _sm: SessionManager;
  private readonly _aiConfig: AiConfig;

  constructor(sm: SessionManager, aiConfig: AiConfig) {
    this._sm = sm;
    this._aiConfig = aiConfig;
  }

  // ── describeSurface ────────────────────────────────────────────────────────

  describeSurface(sessionId: string): AiControlSurface {
    const dspControl = sessionDspControls.get(sessionId);

    // DSP section — empty if no chain attached yet
    const dsp: AiControlSurface["dsp"] = dspControl
      ? dspControl.allDescriptors()
      : [];

    return {
      sessionId,
      dsp,
      transportActions: [
        "play", "pause", "next", "previous", "seek",
        "setVolume", "enqueue", "playNow", "setRepeat", "setShuffle",
      ],
      safety: DSP_SAFETY_RULES,
    };
  }

  // ── handle ─────────────────────────────────────────────────────────────────

  async handle(request: AiChatRequest): Promise<AiChatResponse> {
    const { sessionId, userId, text, provider: providerOverride } = request;
    const surface = this.describeSurface(sessionId);
    const nowPlaying = this._sm.getNowPlaying(sessionId);

    // Build system prompt
    const systemPrompt = [
      "You are the intelligent music assistant for YouTopia, a multi-room music server.",
      "You help users control playback, adjust DSP (equalizer, compressor, etc.), and discover music.",
      "You respond with a natural-language reply and a structured list of intents.",
      "",
      "SAFETY RULES (you must obey these — they are enforced server-side):",
      "- No strobe, no blinking effects.",
      "- DSP values will be clamped to descriptor bounds; request reasonable values.",
      "- Only use transport actions from the transportActions list.",
      "- Only use nodeIds and param keys from the dsp descriptors list.",
      "",
      "Return JSON matching this exact schema:",
      JSON.stringify(INTENT_RESPONSE_SCHEMA, null, 2),
    ].join("\n");

    // Build user prompt
    const userPrompt = JSON.stringify({
      request: text,
      userId,
      sessionId,
      controlSurface: surface,
      nowPlaying,
    });

    let providerResult: { text: string; provider: AiProvider; model: string };
    let providerUnavailable = false;
    let rawReply = "";
    let rawIntents: unknown[] = [];

    try {
      providerResult = await callProvider(
        this._aiConfig,
        {
          systemPrompt,
          userPrompt,
          schema: INTENT_RESPONSE_SCHEMA as unknown as import("./providers.js").ProviderRequest["schema"],
          schemaName: "ai_music_response",
        },
        providerOverride,
      );

      // Parse structured response
      let parsed: { reply?: string; intents?: unknown[] } = {};
      try {
        parsed = JSON.parse(extractJsonObject(providerResult.text)) as typeof parsed;
      } catch {
        // Model returned unstructured text — wrap it as an answer intent
        parsed = {
          reply: providerResult.text.trim().slice(0, 500),
          intents: [],
        };
      }
      rawReply = parsed.reply ?? "";
      rawIntents = Array.isArray(parsed.intents) ? parsed.intents : [];
    } catch (err) {
      logger.warn({ err, sessionId, provider: providerOverride ?? this._aiConfig.defaultProvider }, "AI provider call failed — degrading gracefully");
      providerUnavailable = true;
      providerResult = {
        text: "",
        provider: providerOverride ?? this._aiConfig.defaultProvider,
        model: this._aiConfig.ollama.defaultModel,
      };
    }

    // Validate + allowlist intents
    const accepted: AiIntent[] = [];
    const rejected: AiChatResponse["rejected"] = [];

    for (const raw of rawIntents) {
      const result = validateIntent(raw);
      if (result.rejected) {
        rejected.push({ intent: result.intent, reason: result.reason ?? "rejected" });
      } else {
        accepted.push(result.intent);
      }
    }

    // Apply validated intents to the session
    const dspControl = sessionDspControls.get(sessionId);

    for (const intent of accepted) {
      try {
        if (intent.kind === "dsp" && dspControl) {
          // SAFETY: applyPatches clamps every value to descriptor bounds
          const newState = dspControl.applyPatches(
            intent.patches as import("../contracts/index.js").DspParamPatch[],
          );
          // Sync snapshot back to session
          this._sm.updateDspSnapshot(sessionId, newState);
          logger.debug({ sessionId, nodeCount: newState.length }, "AI DSP patch applied");
        } else if (intent.kind === "transport") {
          this._sm.applyTransportCommand(sessionId, {
            op: intent.action,
            ...(intent.arg !== undefined ? buildTransportArg(intent.action, intent.arg) : {}),
          } as import("../contracts/index.js").TransportCommand);
        }
        // "lighting" intents: delegated to lightss pipeline in a future pass (note for PM)
        // "search" intents: handled by client; server returns them in intents array
        // "answer" intents: reply text carries the answer
      } catch (err) {
        logger.warn({ err, intent }, "Failed to apply AI intent");
      }
    }

    const reply = providerUnavailable
      ? `AI provider (${providerResult.provider}) is currently unavailable. Please check your connection to ${this._aiConfig.ollama.baseUrl} or configure an alternative provider.`
      : rawReply || "Done.";

    return {
      sessionId,
      reply,
      intents: accepted,
      provider: providerResult.provider,
      model: providerResult.model,
      ...(rejected.length > 0 ? { rejected } : {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Helper: map transport action to body arg key
// ---------------------------------------------------------------------------

function buildTransportArg(
  action: AiTransportAction,
  arg: number | string | boolean,
): Record<string, unknown> {
  switch (action) {
    case "seek": return { positionSeconds: Number(arg) };
    case "setVolume": return { volume: Number(arg) };
    case "setRepeat": return { repeat: String(arg) };
    case "setShuffle": return { shuffle: Boolean(arg) };
    default: return {};
  }
}

export { validateIntent };
