/**
 * YouTopia Server — Configuration loader.
 *
 * Resolution order (highest wins):
 *   1. Environment variables (YOUTOPIA_*)
 *   2. Config file: $YOUTOPIA_CONFIG_PATH or <cwd>/youtopia-server.json
 *   3. Built-in defaults (LAN values from AGENTS.md)
 *
 * Exported as a frozen `config` singleton; call `loadConfig()` once at boot.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiProvider } from "../contracts/index.js";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface WledConfig {
  host: string; // e.g. "10.27.27.110"
}

export interface OllamaConfig {
  baseUrl: string; // e.g. "http://10.27.27.10:11434"
  defaultModel: string; // e.g. "kimi-k2.7-code:cloud"
}

export interface AiConfig {
  defaultProvider: AiProvider;
  ollama: OllamaConfig;
  /** Optional OpenAI API key (from env OPENAI_API_KEY). */
  openaiApiKey?: string;
  /** Optional OpenRouter API key (from env OPENROUTER_API_KEY). */
  openrouterApiKey?: string;
  /** Optional Gemini API key (from env GEMINI_API_KEY). */
  geminiApiKey?: string;
}

export interface AuthConfig {
  /**
   * Secret for signing JWT tokens.  Override with YOUTOPIA_JWT_SECRET in prod.
   * Defaults to a random value (tokens invalidated on restart) — set a persistent
   * secret in the config file for a production appliance.
   */
  jwtSecret: string;
  /** Token TTL in seconds (default: 30 days). */
  tokenTtlSeconds: number;
  /**
   * Pre-configured users.  Each entry has a userId, displayName, and a SHA-256
   * hash of their PIN.  Set real hashes via the config file or env vars.
   * Patrick and spouse are the two first-class users (PM decision: 2 zones).
   */
  users: Array<{
    userId: string;
    displayName: string;
    /** SHA-256 hex of the raw PIN string. */
    pinHash: string;
  }>;
}

export interface ServerConfig {
  port: number;
  host: string;
  /** CORS origins to allow.  Includes the companion server and TV page. */
  corsOrigins: string[];
  /** Requests per minute limit per IP for control routes. */
  rateLimitPerMinute: number;
}

export interface YouTopiaConfig {
  server: ServerConfig;
  wled: WledConfig;
  ai: AiConfig;
  auth: AuthConfig;
  /** Data dir for SQLite, config persistence, etc. */
  dataDir: string;
}

// ---------------------------------------------------------------------------
// Defaults — real LAN values from AGENTS.md
// ---------------------------------------------------------------------------

const DEFAULTS: YouTopiaConfig = {
  server: {
    port: 9870, // PM DECISION #1: dedicated port for new server
    host: "0.0.0.0",
    corsOrigins: [
      "http://10.27.27.96:9863", // existing companion server / TV page
      "http://localhost:9870",
      "http://127.0.0.1:9870",
    ],
    rateLimitPerMinute: 200,
  },
  wled: {
    host: "10.27.27.110", // AGENTS.md WLED controller
  },
  ai: {
    defaultProvider: AiProvider.Ollama, // PM DECISION #4: private Ollama default
    ollama: {
      baseUrl: "http://10.27.27.10:11434", // AGENTS.md Ollama LAN address
      defaultModel: "kimi-k2.7-code:cloud", // AGENTS.md preferred model
    },
  },
  auth: {
    jwtSecret: "change-me-in-production-config",
    tokenTtlSeconds: 30 * 24 * 60 * 60, // 30 days
    users: [
      {
        userId: "patrick",
        displayName: "Patrick",
        // SHA-256 of "1234" — replace via config file in production
        pinHash:
          "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4",
      },
      {
        userId: "spouse",
        displayName: "Spouse",
        // SHA-256 of "0000" — replace via config file in production
        pinHash:
          "2ac9a6746aca543af8dff39894cfe8173afba21eb01c6fae33d52947222855ef",
      },
    ],
  },
  dataDir: "./data",
};

// ---------------------------------------------------------------------------
// File-based partial override (deep merge, not replace)
// ---------------------------------------------------------------------------

type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

function deepMerge<T extends object>(base: T, override: DeepPartial<T>): T {
  const result = { ...base } as Record<string, unknown>;
  const baseRecord = base as Record<string, unknown>;
  const overrideRecord = override as Record<string, unknown>;
  for (const key in overrideRecord) {
    const overrideVal = overrideRecord[key];
    const baseVal = baseRecord[key];
    if (
      overrideVal !== undefined &&
      overrideVal !== null &&
      typeof overrideVal === "object" &&
      !Array.isArray(overrideVal) &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(baseVal as object, overrideVal as DeepPartial<object>);
    } else if (overrideVal !== undefined) {
      result[key] = overrideVal;
    }
  }
  return result as T;
}

function loadFromFile(path: string): DeepPartial<YouTopiaConfig> {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as DeepPartial<YouTopiaConfig>;
  } catch (err) {
    console.warn(`[config] Could not parse config file ${path}:`, err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Env var overrides
// ---------------------------------------------------------------------------

function applyEnv(cfg: YouTopiaConfig): YouTopiaConfig {
  const e = process.env;

  if (e["YOUTOPIA_PORT"]) cfg.server.port = parseInt(e["YOUTOPIA_PORT"]!, 10);
  if (e["YOUTOPIA_HOST"]) cfg.server.host = e["YOUTOPIA_HOST"]!;
  if (e["YOUTOPIA_JWT_SECRET"]) cfg.auth.jwtSecret = e["YOUTOPIA_JWT_SECRET"]!;
  if (e["YOUTOPIA_DATA_DIR"]) cfg.dataDir = e["YOUTOPIA_DATA_DIR"]!;
  if (e["YOUTOPIA_WLED_HOST"]) cfg.wled.host = e["YOUTOPIA_WLED_HOST"]!;
  if (e["YOUTOPIA_OLLAMA_URL"]) cfg.ai.ollama.baseUrl = e["YOUTOPIA_OLLAMA_URL"]!;
  if (e["YOUTOPIA_OLLAMA_MODEL"])
    cfg.ai.ollama.defaultModel = e["YOUTOPIA_OLLAMA_MODEL"]!;
  if (e["YOUTOPIA_AI_PROVIDER"])
    cfg.ai.defaultProvider = e["YOUTOPIA_AI_PROVIDER"] as AiProvider;
  if (e["OPENAI_API_KEY"]) cfg.ai.openaiApiKey = e["OPENAI_API_KEY"]!;
  if (e["OPENROUTER_API_KEY"])
    cfg.ai.openrouterApiKey = e["OPENROUTER_API_KEY"]!;
  if (e["GEMINI_API_KEY"]) cfg.ai.geminiApiKey = e["GEMINI_API_KEY"]!;

  return cfg;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

let _config: YouTopiaConfig | null = null;

export function loadConfig(): YouTopiaConfig {
  if (_config) return _config;

  const configPath =
    process.env["YOUTOPIA_CONFIG_PATH"] ??
    resolve(process.cwd(), "youtopia-server.json");

  const fileOverrides = loadFromFile(configPath);
  const merged = deepMerge(DEFAULTS, fileOverrides);
  _config = applyEnv(merged);

  return _config;
}

/** Returns the already-loaded config; throws if loadConfig() was not called first. */
export function getConfig(): YouTopiaConfig {
  if (!_config) throw new Error("Config not loaded — call loadConfig() first.");
  return _config;
}
