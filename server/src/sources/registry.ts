/**
 * YouTopia Server — AudioSourceRegistry implementation.
 *
 * Concrete implementation of the AudioSourceRegistry contract (source.ts).
 * Pod B registers real AudioSource adapters (YTM, Amazon, Local) via
 * `registry.register(source)` at boot time.  The engine always talks to the
 * registry interface; it never holds direct references to adapters.
 *
 * ISRC de-duplication: when fan-out searchAll() collects results from all
 * sources, tracks that share the same ISRC are merged.  The first result
 * (highest-priority source order: YTM → Local → Amazon) wins; duplicates from
 * lower-priority sources are dropped.
 */

import {
  type AudioSource,
  type AudioSourceRegistry,
  type SearchQuery,
  type SearchResult,
  type MediaId,
  SourceId,
} from "../contracts/index.js";
import { logger } from "../logger.js";

// Source priority for ISRC de-dup: first registered = highest priority.
// Pod B should register in order: YTM, Local, Amazon.
const DEFAULT_PRIORITY: SourceId[] = [
  SourceId.YouTubeMusic,
  SourceId.Local,
  SourceId.AmazonMusic,
];

export class SourceRegistry implements AudioSourceRegistry {
  private readonly sources = new Map<SourceId, AudioSource>();

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  register(source: AudioSource): void {
    if (this.sources.has(source.id)) {
      logger.warn({ sourceId: source.id }, "Source already registered; replacing");
    }
    this.sources.set(source.id, source);
    logger.info({ sourceId: source.id }, "Audio source registered");
  }

  // -------------------------------------------------------------------------
  // Lookup
  // -------------------------------------------------------------------------

  get(id: SourceId): AudioSource | undefined {
    return this.sources.get(id);
  }

  list(): AudioSource[] {
    return [...this.sources.values()];
  }

  /**
   * Route a namespaced media id (`"${source}:${kind}:${nativeId}"`) to the
   * owning source.  Returns undefined if the source is not registered.
   */
  resolveOwner(id: MediaId): AudioSource | undefined {
    const [sourceId] = id.split(":") as [string, ...string[]];
    return this.sources.get(sourceId as SourceId);
  }

  // -------------------------------------------------------------------------
  // Fan-out search with ISRC de-duplication
  // -------------------------------------------------------------------------

  async searchAll(query: SearchQuery): Promise<SearchResult> {
    const readySources = [...this.sources.values()].filter((s) => {
      try {
        return s.describe().ready;
      } catch {
        return false;
      }
    });

    if (readySources.length === 0) {
      return emptyResult();
    }

    // Fan out in parallel; individual source failures are logged and skipped.
    const outcomes = await Promise.allSettled(
      readySources.map((s) => s.search(query))
    );

    // Sort results by source priority order
    const priorityIndex = (sourceId: string) => {
      const idx = DEFAULT_PRIORITY.indexOf(sourceId as SourceId);
      return idx === -1 ? DEFAULT_PRIORITY.length : idx;
    };

    const paired = readySources.map((s, i) => ({
      source: s.id,
      result: outcomes[i] as PromiseSettledResult<SearchResult>,
    }));
    paired.sort((a, b) => priorityIndex(a.source) - priorityIndex(b.source));

    const ranked: SearchResult[] = paired.flatMap(({ source, result }) => {
      if (result.status === "rejected") {
        logger.error(
          { sourceId: source, err: (result as PromiseRejectedResult).reason },
          "Search failed for source"
        );
        return [];
      }
      return [(result as PromiseFulfilledResult<SearchResult>).value];
    });

    return mergeResults(ranked);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyResult(): SearchResult {
  return { tracks: [], albums: [], artists: [], playlists: [] };
}

function mergeResults(results: SearchResult[]): SearchResult {
  const seenIsrc = new Set<string>();
  const seenTrackId = new Set<string>();
  const seenAlbumId = new Set<string>();
  const seenArtistId = new Set<string>();
  const seenPlaylistId = new Set<string>();

  const merged: SearchResult = emptyResult();

  for (const r of results) {
    for (const track of r.tracks) {
      // ISRC de-dup: skip if we already have this song from a higher-priority source
      if (track.isrc) {
        if (seenIsrc.has(track.isrc)) continue;
        seenIsrc.add(track.isrc);
      }
      if (seenTrackId.has(track.id)) continue;
      seenTrackId.add(track.id);
      merged.tracks.push(track);
    }

    for (const album of r.albums) {
      if (seenAlbumId.has(album.id)) continue;
      seenAlbumId.add(album.id);
      merged.albums.push(album);
    }

    for (const artist of r.artists) {
      if (seenArtistId.has(artist.id)) continue;
      seenArtistId.add(artist.id);
      merged.artists.push(artist);
    }

    for (const playlist of r.playlists) {
      if (seenPlaylistId.has(playlist.id)) continue;
      seenPlaylistId.add(playlist.id);
      merged.playlists.push(playlist);
    }
  }

  return merged;
}
