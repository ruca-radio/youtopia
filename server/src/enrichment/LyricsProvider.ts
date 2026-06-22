/**
 * YouTopia Enrichment — Lyrics Provider.
 *
 * Primary source: lrclib.net — a public, no-auth-required API for synced
 * (LRC) and plain lyrics.  No API key needed.
 *
 * API:
 *   GET https://lrclib.net/api/get?artist_name=...&track_name=...&album_name=...&duration=...
 *   Returns JSON { syncedLyrics?: string, plainLyrics?: string, ... }
 *
 * LRC format example:
 *   [00:12.50] First line of the verse
 *   [00:15.00] Second line
 *
 * Fallback: plain text from the same endpoint.
 * Caching: in-memory LRU by trackId (max 200 entries, 30-min TTL) to avoid
 * repeated network calls for the same track during a session.
 *
 * Graceful degradation: any network or parse error returns null (not thrown).
 */

import type {
  EnrichmentProvider,
  Lyrics,
  LyricLine,
  MediaId,
  Track,
  TrackContext,
  ArtistContext,
  MusicVideoRef,
} from "../contracts/index.js";
import { EnrichmentKind } from "../contracts/index.js";

// ── Simple TTL cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX = 200;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class TtlCache<T> {
  private readonly _store = new Map<string, CacheEntry<T>>();

  get(key: string): T | undefined {
    const entry = this._store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this._store.size >= CACHE_MAX) {
      // Evict oldest
      const firstKey = this._store.keys().next().value;
      if (firstKey !== undefined) this._store.delete(firstKey);
    }
    this._store.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  }
}

// ── LRC parser ────────────────────────────────────────────────────────────────

/** Parse an LRC string into timed LyricLine[]. */
function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split("\n")) {
    const match = raw.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d+))?\]\s*(.*)$/);
    if (!match) continue;
    const minutes = parseInt(match[1]!, 10);
    const seconds = parseInt(match[2]!, 10);
    const centis = match[3] ? parseInt(match[3].padEnd(2, "0").slice(0, 2), 10) : 0;
    const timeMs = (minutes * 60 + seconds) * 1000 + centis * 10;
    const text = (match[4] ?? "").trim();
    if (text.length > 0 || lines.length > 0) {
      lines.push({ timeMs, text });
    }
  }
  return lines;
}

/** Parse plain text lyrics into LyricLine[] with estimated timings. */
function parsePlain(plain: string): LyricLine[] {
  return plain
    .split("\n")
    .map((text, i) => ({ timeMs: i * 3000, text: text.trim() }))
    .filter((l) => l.text.length > 0);
}

// ── lrclib API shape ──────────────────────────────────────────────────────────

interface LrclibResponse {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const LRCLIB_BASE = "https://lrclib.net/api";
const PROVIDER_NAME = "lrclib.net";
const USER_AGENT = "YouTopia-MusicServer/0.1 (https://github.com/your-org/youtopia)";

// ── LyricsProvider ────────────────────────────────────────────────────────────

export class LyricsProvider implements EnrichmentProvider {
  readonly name = "lrclib-lyrics";
  readonly kinds: EnrichmentKind[] = [EnrichmentKind.Lyrics];

  private readonly _cache = new TtlCache<Lyrics | null>();

  async getLyrics(track: Track): Promise<Lyrics | null> {
    const cacheKey = track.id;
    const cached = this._cache.get(cacheKey);
    if (cached !== undefined) return cached;

    try {
      const result = await this._fetchLyrics(track);
      this._cache.set(cacheKey, result);
      return result;
    } catch {
      // Graceful failure: cache null to avoid hammering on errors
      this._cache.set(cacheKey, null);
      return null;
    }
  }

  // Satisfy the full interface (no-op for unused kinds)
  getTrackContext?: (_track: Track) => Promise<TrackContext | null>;
  getArtistContext?: (_artistId: MediaId) => Promise<ArtistContext | null>;
  getMusicVideo?: (_track: Track) => Promise<MusicVideoRef | null>;

  private async _fetchLyrics(track: Track): Promise<Lyrics | null> {
    const params = new URLSearchParams({
      artist_name: track.artistName,
      track_name: track.title,
    });
    if (track.albumName) params.set("album_name", track.albumName);
    if (track.durationSeconds > 0) {
      params.set("duration", String(Math.round(track.durationSeconds)));
    }

    const url = `${LRCLIB_BASE}/get?${params.toString()}`;

    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      if (res.status === 404) return null; // no lyrics available
      throw new Error(`lrclib HTTP ${res.status}`);
    }

    const data = (await res.json()) as LrclibResponse;

    if (data.instrumental) {
      return {
        trackId: track.id,
        synced: false,
        lines: [{ timeMs: 0, text: "[Instrumental]" }],
        provider: PROVIDER_NAME,
      };
    }

    if (data.syncedLyrics) {
      const lines = parseLrc(data.syncedLyrics);
      if (lines.length > 0) {
        return {
          trackId: track.id,
          synced: true,
          lines,
          provider: PROVIDER_NAME,
        };
      }
    }

    if (data.plainLyrics) {
      return {
        trackId: track.id,
        synced: false,
        lines: parsePlain(data.plainLyrics),
        provider: `${PROVIDER_NAME} (plain)`,
      };
    }

    return null;
  }
}
