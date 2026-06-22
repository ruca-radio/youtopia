/**
 * YouTopia Enrichment — Metadata Provider.
 *
 * Primary sources:
 *   1. MusicBrainz API  — artist/release/recording metadata (no auth).
 *      Base URL: https://musicbrainz.org/ws/2/
 *      Docs: https://musicbrainz.org/doc/MusicBrainz_API
 *
 *   2. Cover Art Archive — cover art for releases.
 *      Base URL: https://coverartarchive.org/release/<mbid>/
 *      No auth; returns a JSON index with image URLs.
 *
 * Rate limiting: MusicBrainz allows 1 req/s without auth; we respect this
 * via a simple per-instance token bucket (1 req/s).  The cache greatly
 * reduces actual requests in practice.
 *
 * Graceful degradation: any network or parse error returns null.
 *
 * Caching: in-memory TTL cache keyed by MusicBrainz ID or search term.
 *   Track context: 2h TTL.
 *   Artist context: 6h TTL (slower-changing).
 */

import type {
  EnrichmentProvider,
  Track,
  TrackContext,
  ArtistContext,
  Artwork,
  MediaId,
  Lyrics,
  MusicVideoRef,
} from "../contracts/index.js";
import { EnrichmentKind } from "../contracts/index.js";

// ── TTL cache (same pattern as LyricsProvider) ────────────────────────────────

const TRACK_CACHE_TTL_MS = 2 * 60 * 60 * 1000;   // 2h
const ARTIST_CACHE_TTL_MS = 6 * 60 * 60 * 1000;  // 6h
const CACHE_MAX = 500;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private readonly _store = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) { this._store.delete(key); return undefined; }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this._store.size >= CACHE_MAX) {
      const firstKey = this._store.keys().next().value;
      if (firstKey !== undefined) this._store.delete(firstKey);
    }
    this._store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

// ── Rate limiter — 1 req/s for MusicBrainz ────────────────────────────────────

class TokenBucket {
  private _tokens: number;
  private _lastRefill = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {
    this._tokens = capacity;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this._lastRefill;
    this._tokens = Math.min(this.capacity, this._tokens + elapsed * this.refillPerMs);
    this._lastRefill = now;

    if (this._tokens >= 1) {
      this._tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = Math.ceil((1 - this._tokens) / this.refillPerMs);
    await new Promise((r) => setTimeout(r, waitMs));
    this._tokens = 0;
  }
}

// ── MusicBrainz response shapes (minimal) ────────────────────────────────────

interface MbRecording {
  id: string;
  title: string;
  length?: number;
  "artist-credit"?: Array<{ artist: { id: string; name: string } }>;
  releases?: Array<{
    id: string;
    title: string;
    date?: string;
    "artist-credit"?: Array<{ artist: { id: string; name: string } }>;
  }>;
  tags?: Array<{ name: string; count: number }>;
  disambiguation?: string;
}

interface MbArtist {
  id: string;
  name: string;
  "sort-name"?: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  "life-span"?: { begin?: string; ended?: boolean };
  tags?: Array<{ name: string; count: number }>;
  relations?: Array<{
    type: string;
    "target-type"?: string;
    artist?: { id: string; name: string };
  }>;
}

interface MbSearchResult<T> {
  count: number;
  recordings?: T[];
  artists?: T[];
}

interface CoverArtArchiveIndex {
  images?: Array<{
    front?: boolean;
    image: string;
    thumbnails?: { small?: string; large?: string; "500"?: string };
  }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MB_BASE = "https://musicbrainz.org/ws/2";
const CAA_BASE = "https://coverartarchive.org";
const USER_AGENT = "YouTopia-MusicServer/0.1 (https://github.com/your-org/youtopia)";
const PROVIDER_NAME = "MusicBrainz";

// 1 token/s, burst 2
const rateLimiter = new TokenBucket(2, 1 / 1000);

async function mbFetch<T>(path: string): Promise<T> {
  await rateLimiter.acquire();
  const url = `${MB_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractArtwork(images: CoverArtArchiveIndex["images"]): Artwork[] {
  if (!images) return [];
  return images
    .filter((img) => img.front)
    .flatMap((img) => {
      const art: Artwork[] = [];
      if (img.thumbnails?.["500"]) {
        art.push({ url: img.thumbnails["500"], width: 500, height: 500 });
      } else if (img.thumbnails?.large) {
        art.push({ url: img.thumbnails.large, width: 500, height: 500 });
      }
      art.push({ url: img.image, width: 1200, height: 1200 });
      return art;
    });
}

async function fetchCoverArt(releaseMbid: string): Promise<Artwork[]> {
  try {
    await rateLimiter.acquire();
    const url = `${CAA_BASE}/release/${releaseMbid}/`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as CoverArtArchiveIndex;
    return extractArtwork(data.images);
  } catch {
    return [];
  }
}

// ── MetadataProvider ──────────────────────────────────────────────────────────

export class MetadataProvider implements EnrichmentProvider {
  readonly name = "musicbrainz-metadata";
  readonly kinds: EnrichmentKind[] = [
    EnrichmentKind.Metadata,
    EnrichmentKind.ArtistContext,
  ];

  private readonly _trackCache = new TtlCache<TrackContext | null>(TRACK_CACHE_TTL_MS);
  private readonly _artistCache = new TtlCache<ArtistContext | null>(ARTIST_CACHE_TTL_MS);

  // Satisfy interface (no-op for unused kinds)
  getLyrics?: (_track: Track) => Promise<Lyrics | null>;
  getMusicVideo?: (_track: Track) => Promise<MusicVideoRef | null>;

  async getTrackContext(track: Track): Promise<TrackContext | null> {
    const cacheKey = `track:${track.id}`;
    const cached = this._trackCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const result = await this._fetchTrackContext(track);
      this._trackCache.set(cacheKey, result);
      return result;
    } catch {
      this._trackCache.set(cacheKey, null);
      return null;
    }
  }

  async getArtistContext(artistId: MediaId): Promise<ArtistContext | null> {
    const cacheKey = `artist:${artistId}`;
    const cached = this._artistCache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const result = await this._fetchArtistContext(artistId);
      this._artistCache.set(cacheKey, result);
      return result;
    } catch {
      this._artistCache.set(cacheKey, null);
      return null;
    }
  }

  private async _fetchTrackContext(track: Track): Promise<TrackContext | null> {
    // Search MusicBrainz for the recording
    const q = encodeURIComponent(
      `recording:"${track.title}" AND artist:"${track.artistName}"`,
    );
    const data = await mbFetch<MbSearchResult<MbRecording>>(
      `/recording/?query=${q}&limit=3&fmt=json&inc=releases+tags+artist-credits`,
    );

    const recordings = data.recordings ?? [];
    if (recordings.length === 0) return null;

    const rec = recordings[0]!;
    const tags = (rec.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map((t) => t.name);

    const release = rec.releases?.[0];
    const credits: Record<string, string> = {
      mbid: rec.id,
    };
    if (release?.date) credits.released = release.date;
    if (rec.disambiguation) credits.note = rec.disambiguation;

    return {
      trackId: track.id,
      about: rec.disambiguation
        ? `"${rec.title}" — ${rec.disambiguation}`
        : undefined,
      tags,
      credits,
    };
  }

  private async _fetchArtistContext(artistId: MediaId): Promise<ArtistContext | null> {
    // The artistId is a namespaced MediaId like "ytmusic:artist:abc123"
    // Try to extract the name or use a MusicBrainz lookup
    // First, try to search by the ID as a name (it may be a display name)
    const parts = artistId.split(":");
    const searchTerm = parts[parts.length - 1] ?? artistId;

    // Try MBID lookup first if it looks like a UUID
    const isMbid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      searchTerm,
    );

    let artist: MbArtist | null = null;

    if (isMbid) {
      try {
        artist = await mbFetch<MbArtist>(
          `/artist/${searchTerm}?fmt=json&inc=tags+relations`,
        );
      } catch {
        /* fall through to search */
      }
    }

    if (!artist) {
      const q = encodeURIComponent(`artist:"${searchTerm}"`);
      const data = await mbFetch<MbSearchResult<MbArtist>>(
        `/artist/?query=${q}&limit=1&fmt=json&inc=tags`,
      );
      artist = data.artists?.[0] ?? null;
    }

    if (!artist) return null;

    const tags = (artist.tags ?? [])
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .map((t) => t.name);

    // Build a bio blurb from available fields
    const bioParts: string[] = [];
    if (artist.type) bioParts.push(artist.type);
    if (artist.country) bioParts.push(`from ${artist.country}`);
    if (artist["life-span"]?.begin) bioParts.push(`active since ${artist["life-span"].begin.slice(0, 4)}`);
    if (artist.disambiguation) bioParts.push(artist.disambiguation);
    const bio = bioParts.length > 0 ? bioParts.join(", ") : undefined;

    // Related artists from relations
    const related = (artist.relations ?? [])
      .filter((r) => r.type === "member of band" || r.type === "collaboration")
      .flatMap((r) => (r.artist ? [r.artist.name] : []))
      .slice(0, 5);

    // Try cover art (search for an artist release)
    let artwork: Artwork[] = [];
    try {
      const relData = await mbFetch<{ releases?: Array<{ id: string }> }>(
        `/release/?artist=${artist.id}&limit=1&fmt=json`,
      );
      const releaseId = relData.releases?.[0]?.id;
      if (releaseId) artwork = await fetchCoverArt(releaseId);
    } catch {
      /* non-fatal */
    }

    return {
      artistId,
      bio,
      related: related.length > 0 ? related : undefined,
      artwork: artwork.length > 0 ? artwork : undefined,
    };
  }
}
