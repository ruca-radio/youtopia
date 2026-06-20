/**
 * YouTopia Server — Unified Library Service.
 *
 * Aggregates catalog data across all registered AudioSources. This is the
 * layer that future REST handlers (search, browse, get track/album/artist/
 * playlist) call — they never talk to individual sources directly.
 *
 * Features:
 *  - searchAll()        — fan-out search + ISRC de-dup via registry
 *  - getTrack/Album/Artist/Playlist() — route by MediaId to owning source
 *  - getTrackIds()      — route to owning source
 *  - recentlyAdded()    — tracks from local source sorted by file mtime
 *  - browseByArtist()   — artists from local + future sources
 *  - browseByAlbum()    — albums from local + future sources
 *  - listSources()      — SourceDescriptor[] for all registered sources
 *  - In-memory catalog cache (TTL-based) to avoid re-scanning on every HTTP request
 *
 * Cache strategy:
 *  - search results are NOT cached (always fresh from registry)
 *  - browseByArtist/Album are cached from local source (rebuilt on cache miss)
 *  - TTL defaults to 5 minutes; set YOUTOPIA_CATALOG_CACHE_TTL_MS env to override
 */

import type { SourceRegistry } from "../registry.js";
import type {
  Track,
  Album,
  Artist,
  Playlist,
  MediaId,
  SearchQuery,
  SearchResult,
  SourceDescriptor,
} from "../../contracts/index.js";
import { SourceId } from "../../contracts/index.js";
import { LocalFileSource } from "../local/LocalFileSource.js";
import { logger } from "../../logger.js";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class TtlCache<T> {
  private entry: CacheEntry<T> | null = null;
  constructor(private readonly ttlMs: number) {}

  get(): T | null {
    if (!this.entry) return null;
    if (Date.now() > this.entry.expiresAt) {
      this.entry = null;
      return null;
    }
    return this.entry.data;
  }

  set(data: T): void {
    this.entry = { data, expiresAt: Date.now() + this.ttlMs };
  }

  invalidate(): void {
    this.entry = null;
  }
}

const CACHE_TTL_MS = parseInt(process.env["YOUTOPIA_CATALOG_CACHE_TTL_MS"] ?? "300000", 10);

// ---------------------------------------------------------------------------
// LibraryService
// ---------------------------------------------------------------------------

export class LibraryService {
  private readonly artistCache = new TtlCache<Artist[]>(CACHE_TTL_MS);
  private readonly albumCache = new TtlCache<Album[]>(CACHE_TTL_MS);
  private readonly trackCache = new TtlCache<Track[]>(CACHE_TTL_MS);

  constructor(private readonly registry: SourceRegistry) {}

  // --------------------------------------------------------------------------
  // Source list
  // --------------------------------------------------------------------------

  listSources(): SourceDescriptor[] {
    return this.registry.list().map((s) => s.describe());
  }

  // --------------------------------------------------------------------------
  // Fan-out search
  // --------------------------------------------------------------------------

  async searchAll(query: SearchQuery): Promise<SearchResult> {
    try {
      return await this.registry.searchAll(query);
    } catch (err) {
      logger.error({ err, query }, "[library] searchAll error");
      return { tracks: [], albums: [], artists: [], playlists: [] };
    }
  }

  // --------------------------------------------------------------------------
  // Routed getters — route to owning source via MediaId prefix
  // --------------------------------------------------------------------------

  async getTrack(id: MediaId): Promise<Track> {
    const source = this.registry.resolveOwner(id);
    if (!source) throw new Error(`[library] No source for id: ${id}`);
    return source.getTrack(id);
  }

  async getAlbum(id: MediaId): Promise<Album> {
    const source = this.registry.resolveOwner(id);
    if (!source) throw new Error(`[library] No source for id: ${id}`);
    return source.getAlbum(id);
  }

  async getArtist(id: MediaId): Promise<Artist> {
    const source = this.registry.resolveOwner(id);
    if (!source) throw new Error(`[library] No source for id: ${id}`);
    return source.getArtist(id);
  }

  async getPlaylist(id: MediaId): Promise<Playlist> {
    const source = this.registry.resolveOwner(id);
    if (!source) throw new Error(`[library] No source for id: ${id}`);
    return source.getPlaylist(id);
  }

  async getTrackIds(containerId: MediaId): Promise<MediaId[]> {
    const source = this.registry.resolveOwner(containerId);
    if (!source) throw new Error(`[library] No source for container: ${containerId}`);
    return source.getTrackIds(containerId);
  }

  async getStreamHandle(id: MediaId) {
    const source = this.registry.resolveOwner(id);
    if (!source) throw new Error(`[library] No source for id: ${id}`);
    return source.getStreamHandle(id);
  }

  // --------------------------------------------------------------------------
  // Browse — local source (cached)
  // --------------------------------------------------------------------------

  /** All artists from the local library, sorted by name. */
  browseArtists(): Artist[] {
    const cached = this.artistCache.get();
    if (cached) return cached;

    const local = this.getLocalSource();
    const artists = local ? sortByTitle(local.getAllArtists()) : [];
    this.artistCache.set(artists);
    return artists;
  }

  /** All albums from the local library, sorted by artist then album title. */
  browseAlbums(): Album[] {
    const cached = this.albumCache.get();
    if (cached) return cached;

    const local = this.getLocalSource();
    const albums = local
      ? local.getAllAlbums().sort((a, b) => {
          const ac = a.artistName.localeCompare(b.artistName);
          return ac !== 0 ? ac : a.title.localeCompare(b.title);
        })
      : [];
    this.albumCache.set(albums);
    return albums;
  }

  /** All tracks from the local library, sorted by artist → album → trackNumber. */
  browseLocalTracks(): Track[] {
    const cached = this.trackCache.get();
    if (cached) return cached;

    const local = this.getLocalSource();
    const tracks = local
      ? local.getAllTracks().sort((a, b) => {
          const ac = a.artistName.localeCompare(b.artistName);
          if (ac !== 0) return ac;
          const bc = (a.albumName ?? "").localeCompare(b.albumName ?? "");
          if (bc !== 0) return bc;
          return (a.trackNumber ?? 0) - (b.trackNumber ?? 0);
        })
      : [];
    this.trackCache.set(tracks);
    return tracks;
  }

  /** Tracks in a specific album (local). */
  browseAlbumTracks(albumId: MediaId): Track[] {
    const local = this.getLocalSource();
    if (!local) return [];
    // Filter all tracks by albumId, sort by track number
    return local.getAllTracks()
      .filter((t) => t.albumId === albumId)
      .sort((a, b) => (a.trackNumber ?? 0) - (b.trackNumber ?? 0));
  }

  /** Albums by a specific artist (local). */
  browseArtistAlbums(artistId: MediaId): Album[] {
    const local = this.getLocalSource();
    if (!local) return [];
    return sortByTitle(local.getAlbumsByArtist(artistId));
  }

  /** Tracks by a specific artist (local). */
  browseArtistTracks(artistId: MediaId): Track[] {
    const local = this.getLocalSource();
    if (!local) return [];
    return local.getTracksByArtist(artistId);
  }

  /**
   * Recently added tracks — from local library, sorted by nativeId
   * (nativeId is slugified file path; filesystem scan order approximates
   * add-time since we don't persist mtimes yet).
   *
   * For a proper recently-added, a future pass should persist scan timestamps
   * in SQLite. This is a best-effort implementation.
   */
  recentlyAdded(limit = 50): Track[] {
    const local = this.getLocalSource();
    if (!local) return [];
    // Reverse of browse order approximates recently-scanned (last files walked)
    return local
      .getAllTracks()
      .slice()
      .reverse()
      .slice(0, limit);
  }

  /** Invalidate catalog caches (e.g. after a rescan). */
  invalidateCaches(): void {
    this.artistCache.invalidate();
    this.albumCache.invalidate();
    this.trackCache.invalidate();
    logger.info("[library] Catalog caches invalidated");
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private getLocalSource(): LocalFileSource | undefined {
    const s = this.registry.get(SourceId.Local);
    if (s instanceof LocalFileSource) return s;
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

let _instance: LibraryService | null = null;

export function getLibraryService(registry?: SourceRegistry): LibraryService {
  if (!_instance) {
    if (!registry) throw new Error("[library] getLibraryService() called before init");
    _instance = new LibraryService(registry);
  }
  return _instance;
}

export function initLibraryService(registry: SourceRegistry): LibraryService {
  _instance = new LibraryService(registry);
  return _instance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortByTitle<T extends { title: string }>(arr: T[]): T[] {
  return arr.slice().sort((a, b) => a.title.localeCompare(b.title));
}
