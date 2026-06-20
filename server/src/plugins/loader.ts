/**
 * YouTopia Server — Plugin loader.
 *
 * A lightweight registration system that lets AudioSources, DSP processors,
 * and Enrichment providers self-register at boot time.  Each plugin receives
 * the server context (registry, logger) and can attach routes, start
 * background tasks, or register sources.
 *
 * Usage (in a source or DSP module):
 *   import { registerPlugin } from "../plugins/loader.js";
 *   registerPlugin({ name: "ytmusic-source", setup: async (ctx) => {
 *     ctx.registry.register(new YtMusicSource(ctx.config));
 *   }});
 *
 * Pod B, C, D call registerPlugin() in their own entry files; the server
 * calls loadAllPlugins() at boot before opening the HTTP port.
 */

import type { FastifyInstance } from "fastify";
import type { YouTopiaConfig } from "../config/index.js";
import type { SourceRegistry } from "../sources/registry.js";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Context passed to each plugin's setup function
// ---------------------------------------------------------------------------

export interface PluginContext {
  fastify: FastifyInstance;
  registry: SourceRegistry;
  config: YouTopiaConfig;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// Plugin descriptor
// ---------------------------------------------------------------------------

export interface YouTopiaPlugin {
  /** Unique plugin name (for logging / duplicate detection). */
  name: string;
  /**
   * Async setup function.  May register sources, attach routes, start
   * background tasks.  Called in registration order.
   */
  setup(ctx: PluginContext): Promise<void>;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const plugins: YouTopiaPlugin[] = [];

/**
 * Register a plugin.  Call this at module load time (top-level) or in an
 * import side-effect.  Order matters: plugins are set up in registration order.
 */
export function registerPlugin(plugin: YouTopiaPlugin): void {
  if (plugins.some((p) => p.name === plugin.name)) {
    console.warn(`[plugin-loader] Duplicate plugin "${plugin.name}" — skipping`);
    return;
  }
  plugins.push(plugin);
}

/**
 * Run all registered plugins' setup() functions in order.
 * Call once at server boot, after the Fastify app is created but before listen().
 */
export async function loadAllPlugins(ctx: PluginContext): Promise<void> {
  ctx.logger.info({ count: plugins.length }, "Loading plugins");

  for (const plugin of plugins) {
    ctx.logger.debug({ plugin: plugin.name }, "Setting up plugin");
    try {
      await plugin.setup(ctx);
      ctx.logger.info({ plugin: plugin.name }, "Plugin loaded");
    } catch (err) {
      ctx.logger.error({ plugin: plugin.name, err }, "Plugin setup failed");
      // Non-fatal: log and continue so other plugins still load
    }
  }
}
