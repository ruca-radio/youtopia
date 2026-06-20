/**
 * YouTopia Intelligent Music Server — unified media metadata models.
 *
 * Source-agnostic Track / Album / Artist / Playlist shapes. Every AudioSource
 * normalizes its native objects into these. IDs are namespaced so the engine
 * can route a resolve() call back to the owning source.
 *
 * Conventions match src/shared/player.ts (RendererThumbnail, durationSeconds).
 */

import type { SourceId, StreamDeliveryKind, SourceCapability } from "./enums";

/** Thumbnail/artwork reference. Mirrors RendererThumbnail. */
export type Artwork = {
  url: string;
  width: number;
  height: number;
};

/**
 * A globally unique, source-namespaced media identifier.
 * Format: `${source}:${kind}:${nativeId}` e.g. "ytmusic:track:abc123".
 * Use {@link parseMediaId} helpers in implementations; type stays a string for
 * cheap transport.
 */
export type MediaId = string;

/** Common fields shared by all catalog entities. */
export type MediaEntityBase = {
  /** Source-namespaced unique id. */
  id: MediaId;
  /** Owning source backend. */
  source: SourceId;
  /** Native id within the source (un-namespaced). */
  nativeId: string;
  /** Human title/name. */
  title: string;
  /** Artwork sorted largest-first when available. */
  artwork: Artwork[];
};

export type Artist = MediaEntityBase & {
  kind: "artist";
  /** Free-text biography/description when the source provides one. */
  description?: string;
  /** Genres/tags as advertised by the source. */
  genres?: string[];
};

export type Album = MediaEntityBase & {
  kind: "album";
  /** Primary artist display name (denormalized for quick render). */
  artistName: string;
  /** Linked artist ids when resolvable. */
  artistIds: MediaId[];
  /** Release year if known. */
  year?: number;
  trackCount?: number;
};

/** A single playable track in unified form. */
export type Track = MediaEntityBase & {
  kind: "track";
  /** Primary artist display name (denormalized). */
  artistName: string;
  artistIds: MediaId[];
  /** Album display name; null for singles/uploads (matches player.ts). */
  albumName: string | null;
  albumId: MediaId | null;
  /** Length in seconds (matches RendererVideoDetails.durationSeconds). */
  durationSeconds: number;
  /** Track number within its album, 1-based. */
  trackNumber?: number;
  /** True for explicit content per source. */
  explicit?: boolean;
  /** True if the source flags this as a music-video item. */
  hasVideo?: boolean;
  /** ISRC when known — used to cross-match the same song across sources. */
  isrc?: string;
};

export type Playlist = MediaEntityBase & {
  kind: "playlist";
  description?: string;
  ownerName?: string;
  trackCount?: number;
};

/** Discriminated union of any catalog entity. */
export type MediaEntity = Artist | Album | Track | Playlist;

/** Search request passed to an AudioSource. */
export type SearchQuery = {
  text: string;
  /** Restrict to entity kinds; omit for all. */
  kinds?: Array<MediaEntity["kind"]>;
  limit?: number;
};

/** Search results grouped by kind. */
export type SearchResult = {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
  playlists: Playlist[];
};

/**
 * A concrete, time-limited handle for pulling a track's audio.
 * Returned by AudioSource.getStreamHandle(); the engine feeds `uri` (and any
 * `headers`) to ffmpeg, or captures a monitor when delivery === Capture.
 */
export type StreamHandle = {
  trackId: MediaId;
  delivery: StreamDeliveryKind;
  /** URL, manifest URL, or local path depending on delivery. */
  uri: string;
  /** Container/codec hint, e.g. "webm/opus", "m4a/aac", "flac". */
  containerHint?: string;
  /** Approximate bitrate in kbps when known. */
  bitrateKbps?: number;
  /** Sample rate in Hz when known. */
  sampleRate?: number;
  /** Extra HTTP headers (cookies, auth) ffmpeg must send. */
  headers?: Record<string, string>;
  /** Epoch ms after which `uri` is invalid and must be re-resolved. */
  expiresAt?: number;
  /** True if seeking via byte/time range is supported. */
  seekable: boolean;
};

/** Capability descriptor an AudioSource advertises at registration. */
export type SourceDescriptor = {
  id: SourceId;
  displayName: string;
  capabilities: SourceCapability[];
  /** True once credentials/auth are present and the source is usable. */
  ready: boolean;
};
