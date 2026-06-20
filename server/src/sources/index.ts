/**
 * YouTopia Server — Sources plugin.
 *
 * Registers all three AudioSource implementations into the AudioSourceRegistry
 * via Pod A's registerPlugin() mechanism. Sources are only registered when
 * enabled/configured (gated by config).
 *
 * Registration order follows ISRC de-dup priority in registry.ts:
 *   1. YouTubeMusic (primary per PM DECISION #2)
 *   2. Local
 *   3. AmazonMusic
 *
 * Config keys (all optional — sources default to enabled):
 *   sources.ytmusic.enabled  (default: true)
 *   sources.local.enabled    (default: true if libraryDir set)
 *   sources.amazon.enabled   (default: false — capture-only, opt-in)
 *
 * These config keys extend YouTopiaConfig via a locally-declared augmentation
 * (not modifying the contract file). The server resolves them from env:
 *   YOUTOPIA_LIBRARY_DIR     → local library directory
 *   YOUTOPIA_YTMUSIC_ENABLED → "false" to disable YTM
 *   YOUTOPIA_AMAZON_ENABLED  → "true" to enable Amazon capture
 */

import { registerPlugin } from "../plugins/loader.js";
import { LocalFileSource } from "./local/LocalFileSource.js";
import { YouTubeMusicSource } from "./ytmusic/YouTubeMusicSource.js";
import { AmazonMusicSource } from "./amazon/AmazonMusicSource.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Env-based source config resolution
// (avoids modifying YouTopiaConfig contract; read directly from env here)
// ---------------------------------------------------------------------------

function getEnvBool(key: string, defaultVal: boolean): boolean {
  const v = process.env[key];
  if (v === undefined) return defaultVal;
  return v.toLowerCase() !== "false" && v !== "0";
}

// ---------------------------------------------------------------------------
// YouTube Music plugin
// ---------------------------------------------------------------------------

registerPlugin({
  name: "source:ytmusic",
  async setup(ctx) {
    const enabled = getEnvBool("YOUTOPIA_YTMUSIC_ENABLED", true);
    if (!enabled) {
      ctx.logger.info("[sources/ytmusic] Disabled via YOUTOPIA_YTMUSIC_ENABLED=false");
      return;
    }

    const source = new YouTubeMusicSource({
      sidecarUrl: process.env["YTMUSIC_SIDECAR_URL"] ?? `http://127.0.0.1:${process.env["YTMUSIC_PORT"] ?? "9871"}`,
      sidecarPath: process.env["YTMUSIC_SIDECAR_PATH"],
      authFile: process.env["YTMUSIC_AUTH_FILE"],
      cookiesFile: process.env["YTMUSIC_COOKIES_FILE"],
      ytdlpPath: process.env["YTDLP_PATH"] ?? "yt-dlp",
      pythonPath: process.env["PYTHON_PATH"] ?? "python3",
    });

    await source.init();
    ctx.registry.register(source);

    const h = await source.health();
    logger.info({ ready: h.ready, message: h.message }, "[sources/ytmusic] Registered");
  },
});

// ---------------------------------------------------------------------------
// Local files plugin
// ---------------------------------------------------------------------------

registerPlugin({
  name: "source:local",
  async setup(ctx) {
    const libraryDir =
      process.env["YOUTOPIA_LIBRARY_DIR"] ?? ctx.config.dataDir + "/library";

    const enabled = getEnvBool("YOUTOPIA_LOCAL_ENABLED", true);
    if (!enabled) {
      ctx.logger.info("[sources/local] Disabled via YOUTOPIA_LOCAL_ENABLED=false");
      return;
    }

    const source = new LocalFileSource({
      libraryDir,
      extensions: process.env["YOUTOPIA_LIBRARY_EXTS"]
        ? process.env["YOUTOPIA_LIBRARY_EXTS"].split(",").map((e) => e.trim())
        : undefined,
    });

    await source.init();
    ctx.registry.register(source);

    const h = await source.health();
    logger.info({ ready: h.ready, message: h.message, libraryDir }, "[sources/local] Registered");
  },
});

// ---------------------------------------------------------------------------
// Amazon Music plugin (opt-in: must set YOUTOPIA_AMAZON_ENABLED=true)
// ---------------------------------------------------------------------------

registerPlugin({
  name: "source:amazon",
  async setup(ctx) {
    const enabled = getEnvBool("YOUTOPIA_AMAZON_ENABLED", false);
    if (!enabled) {
      ctx.logger.info(
        "[sources/amazon] Disabled by default. Set YOUTOPIA_AMAZON_ENABLED=true to enable (capture mode)."
      );
      return;
    }

    const source = new AmazonMusicSource({
      captureSink: process.env["AMAZON_CAPTURE_SINK"] ?? "default.monitor",
      ffmpegPath: process.env["FFMPEG_PATH"] ?? "ffmpeg",
    });

    await source.init();
    ctx.registry.register(source);

    const h = await source.health();
    logger.info({ ready: h.ready, message: h.message }, "[sources/amazon] Registered");
  },
});
