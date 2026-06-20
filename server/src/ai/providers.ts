/**
 * YouTopia Server — AI provider client.
 *
 * Mirrors the lightss multi-provider pattern (Ollama/OpenAI/Gemini/OpenRouter)
 * from src/main/integrations/lightss/index.ts, adapted for the server-side
 * context where config comes from YouTopiaConfig rather than an Electron Conf store.
 *
 * All HTTP is done via Node.js core http/https — no external fetch dependency.
 *
 * Safety rule: this module handles communication only. Validation/clamping of
 * AI-emitted intent values is done by AiDspControl.applyPatches() and the
 * AiController before any values reach a DSP node or session.
 */

import http from "node:http";
import https from "node:https";
import { AiProvider } from "../contracts/index.js";
import type { AiConfig } from "../config/index.js";

// ---------------------------------------------------------------------------
// Timeouts (mirror lightss values)
// ---------------------------------------------------------------------------

const OLLAMA_TIMEOUT_MS = 45_000;
const OPENAI_TIMEOUT_MS = 20_000;
const GEMINI_TIMEOUT_MS = 25_000;
const OPENROUTER_TIMEOUT_MS = 20_000;

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [k: string]: JsonValue };

function postJson<T>(
  url: URL,
  payload: JsonValue,
  timeoutMs: number,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const body = JSON.stringify(payload);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: "POST",
        timeout: timeoutMs,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...extraHeaders,
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { data += chunk; });
        res.on("end", () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode ?? "unknown"}: ${data.slice(0, 200)}`));
            return;
          }
          if (!data.trim()) { resolve(null as T); return; }
          try { resolve(JSON.parse(data) as T); } catch { resolve(data as T); }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${timeoutMs}ms`)));
    req.on("error", reject);
    req.end(body);
  });
}

function extractJsonObject(text: string): string {
  const t = text.trim();
  if (t.startsWith("{") && t.endsWith("}")) return t;
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return extractJsonObject(fenced[1]);
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}

// ---------------------------------------------------------------------------
// Provider request shape
// ---------------------------------------------------------------------------

export type ProviderRequest = {
  /** System-level instructions. */
  systemPrompt: string;
  /** User-facing prompt text. */
  userPrompt: string;
  /** Optional JSON schema for structured output. */
  schema?: JsonValue;
  schemaName?: string;
};

export type ProviderResult = {
  text: string;
  provider: AiProvider;
  model: string;
};

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function callOllama(
  config: AiConfig,
  req: ProviderRequest,
): Promise<ProviderResult> {
  const baseUrl = config.ollama.baseUrl.replace(/\/+$/, "");
  const model = config.ollama.defaultModel;
  const url = new URL("/api/generate", baseUrl);

  const prompt = `${req.systemPrompt}\n\n${req.userPrompt}`;

  const body: JsonValue = {
    model,
    stream: false,
    prompt,
    ...(req.schema ? { format: req.schema } : {}),
  };

  type OllamaResp = { response?: string };
  const raw = await postJson<OllamaResp>(url, body, OLLAMA_TIMEOUT_MS);
  const text = typeof raw?.response === "string" ? raw.response : "";
  if (!text) throw new Error("Ollama: empty response field");
  return { text, provider: AiProvider.Ollama, model };
}

// ---------------------------------------------------------------------------
// OpenAI (chat completions)
// ---------------------------------------------------------------------------

async function callOpenAI(
  config: AiConfig,
  req: ProviderRequest,
  model = "gpt-4o",
): Promise<ProviderResult> {
  const apiKey = config.openaiApiKey;
  if (!apiKey) throw new Error("OpenAI API key not configured");

  const messages = [
    { role: "system", content: req.systemPrompt },
    { role: "user", content: req.userPrompt },
  ];

  const body: JsonValue = {
    model,
    messages: messages as JsonValue,
    ...(req.schema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: req.schemaName ?? "response",
              strict: true,
              schema: req.schema,
            },
          },
        }
      : {}),
    max_tokens: 1200,
    temperature: 0.5,
  };

  type OpenAIResp = { choices?: Array<{ message?: { content?: string } }> };
  const raw = await postJson<OpenAIResp>(
    new URL(OPENAI_CHAT_URL),
    body,
    OPENAI_TIMEOUT_MS,
    { Authorization: `Bearer ${apiKey}` },
  );

  const text = raw?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenAI: empty choices[0].message.content");
  return { text, provider: AiProvider.OpenAI, model };
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

async function callGemini(
  config: AiConfig,
  req: ProviderRequest,
  model = "gemini-2.5-flash",
): Promise<ProviderResult> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) throw new Error("Gemini API key not configured");

  const baseUrl = DEFAULT_GEMINI_BASE_URL;
  const modelPath = model.startsWith("models/") ? model : `models/${model}`;
  const url = new URL(`/v1beta/${modelPath}:generateContent`, baseUrl);
  url.searchParams.set("key", apiKey);

  // Strip additionalProperties which Gemini doesn't support
  function sanitizeSchema(s: JsonValue): JsonValue {
    if (!s || typeof s !== "object" || Array.isArray(s)) return s;
    const out: { [k: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(s)) {
      if (k === "additionalProperties") continue;
      out[k] = sanitizeSchema(v);
    }
    return out;
  }

  const body: JsonValue = {
    contents: [
      {
        role: "user",
        parts: [{ text: `System Instructions:\n${req.systemPrompt}\n\n${req.userPrompt}` }],
      },
    ],
    ...(req.schema
      ? {
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: sanitizeSchema(req.schema),
          },
        }
      : {}),
  };

  type GeminiResp = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = await postJson<GeminiResp>(url, body, GEMINI_TIMEOUT_MS);
  const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini: empty text response");
  return { text, provider: AiProvider.Gemini, model };
}

// ---------------------------------------------------------------------------
// OpenRouter
// ---------------------------------------------------------------------------

async function callOpenRouter(
  config: AiConfig,
  req: ProviderRequest,
  model = "openrouter/free",
): Promise<ProviderResult> {
  const apiKey = config.openrouterApiKey;
  if (!apiKey) throw new Error("OpenRouter API key not configured");

  const messages = [
    { role: "system", content: req.systemPrompt },
    { role: "user", content: req.userPrompt },
  ];

  const body: JsonValue = {
    model,
    messages: messages as JsonValue,
    ...(req.schema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: {
              name: req.schemaName ?? "response",
              strict: true,
              schema: req.schema,
            },
          },
        }
      : {}),
    temperature: 0.55,
    max_tokens: 1200,
  };

  type ORResp = { choices?: Array<{ message?: { content?: string } }> };
  const raw = await postJson<ORResp>(
    new URL(OPENROUTER_CHAT_URL),
    body,
    OPENROUTER_TIMEOUT_MS,
    {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "http://localhost:9870",
      "X-Title": "Youtopia",
    },
  );

  const text = raw?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("OpenRouter: empty choices[0].message.content");
  return { text, provider: AiProvider.OpenRouter, model };
}

// ---------------------------------------------------------------------------
// Unified dispatch
// ---------------------------------------------------------------------------

/**
 * Call the configured AI provider and return the raw text response.
 * Throws if the provider is unreachable or misconfigured.
 */
export async function callProvider(
  config: AiConfig,
  req: ProviderRequest,
  providerOverride?: AiProvider,
): Promise<ProviderResult> {
  const provider = providerOverride ?? config.defaultProvider;

  switch (provider) {
    case AiProvider.Ollama:
      return callOllama(config, req);
    case AiProvider.OpenAI:
      return callOpenAI(config, req);
    case AiProvider.Gemini:
      return callGemini(config, req);
    case AiProvider.OpenRouter:
      return callOpenRouter(config, req);
    default:
      throw new Error(`Unknown AI provider: ${String(provider)}`);
  }
}

// Re-export for tests
export { extractJsonObject };
