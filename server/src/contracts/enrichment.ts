/**
 * YouTopia Intelligent Music Server — enrichment provider contracts.
 *
 * Pluggable providers that decorate a Track with lyrics, extended metadata,
 * artist context, and (optional) music-video references. Implemented by Pod C
 * (often delegating to the same source adapters, e.g. ytmusicapi lyrics).
 */

import type { EnrichmentKind } from "./enums";
import type { Artwork, MediaId, Track } from "./media";

/** A single timed lyric line for karaoke-style sync. */
export type LyricLine = {
  /** Start time in ms relative to track start. */
  timeMs: number;
  text: string;
};

export type Lyrics = {
  trackId: MediaId;
  /** True if line timings are present (synced) vs. plain text only. */
  synced: boolean;
  lines: LyricLine[];
  /** Attribution/source string for UI. */
  provider: string;
};

/** Extended, source-agnostic context about the currently playing item. */
export type TrackContext = {
  trackId: MediaId;
  /** Free-text "about this song" blurb. */
  about?: string;
  /** Genre/mood tags. */
  tags?: string[];
  /** Release/credits info as key/value pairs. */
  credits?: Record<string, string>;
};

export type ArtistContext = {
  artistId: MediaId;
  bio?: string;
  /** Related artist display names. */
  related?: string[];
  artwork?: Artwork[];
};

/** Optional music-video reference for a track. */
export type MusicVideoRef = {
  trackId: MediaId;
  /** Stream/manifest URL or namespaced media id resolvable to video. */
  uri: string;
  durationSeconds?: number;
  artwork?: Artwork[];
};

/** Aggregated enrichment bundle attached to now-playing. */
export type Enrichment = {
  track: Track;
  lyrics?: Lyrics;
  trackContext?: TrackContext;
  artistContext?: ArtistContext;
  musicVideo?: MusicVideoRef;
};

/**
 * A provider for one or more enrichment kinds. The engine queries all
 * registered providers and merges results (first non-empty wins per field).
 */
export interface EnrichmentProvider {
  readonly name: string;
  /** Which kinds this provider can supply. */
  readonly kinds: EnrichmentKind[];

  getLyrics?(track: Track): Promise<Lyrics | null>;
  getTrackContext?(track: Track): Promise<TrackContext | null>;
  getArtistContext?(artistId: MediaId): Promise<ArtistContext | null>;
  getMusicVideo?(track: Track): Promise<MusicVideoRef | null>;
}
