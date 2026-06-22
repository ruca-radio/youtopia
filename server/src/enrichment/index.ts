/**
 * YouTopia Enrichment — plugin registration entry point.
 *
 * Registers both enrichment providers (Lyrics + Metadata) with the plugin
 * loader so they are available at boot time.  The providers are attached to
 * the PluginContext for other subsystems to resolve.
 *
 * Also exports an EnrichmentEngine that fans out to all registered providers
 * and merges results (first non-null wins per field), matching the contract's
 * "first non-empty wins per field" merge strategy.
 */

import { registerPlugin } from "../plugins/loader.js";
import type { EnrichmentProvider, Enrichment, Track } from "../contracts/index.js";
import { LyricsProvider } from "./LyricsProvider.js";
import { MetadataProvider } from "./MetadataProvider.js";

// ── Provider registry (module-level singleton) ────────────────────────────────

const _providers: EnrichmentProvider[] = [];

export function registerEnrichmentProvider(provider: EnrichmentProvider): void {
  if (_providers.some((p) => p.name === provider.name)) return;
  _providers.push(provider);
}

export function getEnrichmentProviders(): readonly EnrichmentProvider[] {
  return _providers;
}

// ── EnrichmentEngine ──────────────────────────────────────────────────────────

/**
 * Fan out to all registered enrichment providers and merge results.
 * First non-null result wins per field.
 */
export class EnrichmentEngine {
  private readonly _providers: EnrichmentProvider[];

  constructor(providers: readonly EnrichmentProvider[]) {
    this._providers = [...providers];
  }

  async enrich(track: Track): Promise<Enrichment> {
    const result: Enrichment = { track };

    await Promise.all(
      this._providers.map(async (provider) => {
        try {
          if (!result.lyrics && provider.getLyrics) {
            const lyrics = await provider.getLyrics(track);
            if (lyrics) result.lyrics = lyrics;
          }
          if (!result.trackContext && provider.getTrackContext) {
            const ctx = await provider.getTrackContext(track);
            if (ctx) result.trackContext = ctx;
          }
          if (!result.artistContext && track.artistIds.length > 0 && provider.getArtistContext) {
            const actx = await provider.getArtistContext(track.artistIds[0]!);
            if (actx) result.artistContext = actx;
          }
          if (!result.musicVideo && provider.getMusicVideo) {
            const mv = await provider.getMusicVideo(track);
            if (mv) result.musicVideo = mv;
          }
        } catch {
          // Non-fatal: one provider failure doesn't block others
        }
      }),
    );

    return result;
  }
}

// ── Plugin registration ───────────────────────────────────────────────────────

registerPlugin({
  name: "enrichment",
  async setup(ctx) {
    const lyricsProvider = new LyricsProvider();
    const metadataProvider = new MetadataProvider();

    registerEnrichmentProvider(lyricsProvider);
    registerEnrichmentProvider(metadataProvider);

    ctx.logger.info(
      { providers: [lyricsProvider.name, metadataProvider.name] },
      "Enrichment providers registered",
    );
  },
});
