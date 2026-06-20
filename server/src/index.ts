/**
 * YouTopia Server — entrypoint.
 *
 * 1. Loads config (env + file + defaults).
 * 2. Builds the Fastify + Socket.IO app.
 * 3. Loads all registered plugins (sources / DSP / enrichment).
 * 4. Listens on port 9870 (PM DECISION #1).
 * 5. Wires graceful shutdown on SIGTERM / SIGINT.
 */

import { loadConfig } from "./config/index.js";
import { buildApp } from "./server.js";
import { loadAllPlugins } from "./plugins/loader.js";
import { SourceRegistry } from "./sources/registry.js";
import { pruneExpiredTokens } from "./auth/token.js";
import { logger } from "./logger.js";
// Pod D: session/room engine plugin — registers itself via registerPlugin()
import "./session/index.js";
// Pod B: source plugin registration (side-effect import calls registerPlugin for each source)
import "./sources/index.js";
// INTEGRATION (Gap 2): AI controller plugin — must be imported AFTER session/index.js
import "./ai/index.js";
import { initLibraryService } from "./sources/library/index.js";

async function main(): Promise<void> {
  // ── Config ────────────────────────────────────────────────────────────────
  const config = loadConfig();
  logger.info(
    { port: config.server.port, host: config.server.host },
    "YouTopia Server starting"
  );

  // ── Source registry ───────────────────────────────────────────────────────
  const registry = new SourceRegistry();

  // ── Library service (Pod B) ─────────────────────────────────────────────
  // Initialized before buildApp so catalog routes can be registered.
  // Registry is empty here; sources populate it in loadAllPlugins().
  const library = initLibraryService(registry);

  // ── App (Pod B: pass library to wire catalog routes) ──────────────────
  const { fastify, io } = await buildApp(config, library);

  // ── Plugins (sources/DSP/rooms) ─────────────────────────────────────
  await loadAllPlugins({ fastify, registry, config, logger });

  // ── Token pruning (every 5 min) ───────────────────────────────────────────
  const tokenPruneInterval = setInterval(pruneExpiredTokens, 5 * 60 * 1000);

  // ── Listen ────────────────────────────────────────────────────────────────
  await fastify.listen({
    port: config.server.port,
    host: config.server.host,
  });

  logger.info(
    { port: config.server.port, healthz: `http://127.0.0.1:${config.server.port}/healthz` },
    "YouTopia Server ready"
  );

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Shutting down YouTopia Server");

    clearInterval(tokenPruneInterval);

    // Close all socket.io connections first
    await new Promise<void>((resolve) => {
      io.close((err) => {
        if (err) logger.error({ err }, "Socket.IO close error");
        resolve();
      });
    });

    // Gracefully drain registry sources
    const sources = registry.list();
    await Promise.allSettled(
      sources.map((s) =>
        s.dispose().catch((err) =>
          logger.error({ sourceId: s.id, err }, "Source dispose error")
        )
      )
    );

    // Close Fastify (drains in-flight requests)
    await fastify.close();
    logger.info("YouTopia Server stopped cleanly");
    process.exit(0);
  }

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
