/**
 * YouTopia Intelligent Music Server — AudioSource plugin interface.
 *
 * The pluggable contract that YouTube Music, Amazon Music, and Local-files
 * adapters each implement (Pod B). The engine (Pod A) loads sources through a
 * registry and never depends on a concrete source.
 *
 * Implementations contain ALL source-specific logic (auth, native API calls,
 * yt-dlp/ffmpeg invocation). This file is types only.
 */

import type { SourceId, SourceCapability } from "./enums";
import type {
  Album,
  Artist,
  MediaId,
  Playlist,
  SearchQuery,
  SearchResult,
  SourceDescriptor,
  StreamHandle,
  Track
} from "./media";

/** Result of a credential/health probe. */
export type SourceHealth = {
  ready: boolean;
  /** Short human status for the UI/status surface. */
  message: string;
  /** True if interactive (re)authentication is required. */
  needsAuth: boolean;
};

/**
 * Pluggable audio source. One instance per configured backend.
 *
 * Lifecycle: construct -> init() -> (ready) -> dispose().
 * All catalog methods MUST return unified {@link Track}/{@link Album} models;
 * adapters own the mapping from native shapes.
 */
export interface AudioSource {
  /** Stable backend id (e.g. SourceId.YouTubeMusic). */
  readonly id: SourceId;

  /** Static capability + readiness descriptor for UI and routing. */
  describe(): SourceDescriptor;

  /** Returns true if this source supports the given capability. */
  supports(capability: SourceCapability): boolean;

  /** Load config/credentials and prepare the backend. Idempotent. */
  init(): Promise<void>;

  /** Probe credentials/connectivity without mutating state. */
  health(): Promise<SourceHealth>;

  /** Full-text search across the source catalog. */
  search(query: SearchQuery): Promise<SearchResult>;

  /** Fetch full metadata for any namespaced media id owned by this source. */
  getTrack(id: MediaId): Promise<Track>;
  getAlbum(id: MediaId): Promise<Album>;
  getArtist(id: MediaId): Promise<Artist>;
  getPlaylist(id: MediaId): Promise<Playlist>;

  /** Track ids contained by an album or playlist, in order. */
  getTrackIds(containerId: MediaId): Promise<MediaId[]>;

  /**
   * Resolve a time-limited stream handle for a track. May be called again when
   * a prior handle expires. Throws if the source is capture-only and capture
   * is unavailable.
   */
  getStreamHandle(id: MediaId): Promise<StreamHandle>;

  /** Optional: a radio/autoplay continuation seeded by a track. */
  getRadio?(seedTrackId: MediaId, limit?: number): Promise<Track[]>;

  /** Release resources, processes, and sessions. */
  dispose(): Promise<void>;
}

/**
 * Registry the engine uses to discover and route to sources. Pod A owns the
 * implementation; pods reference the type for DI.
 */
export interface AudioSourceRegistry {
  register(source: AudioSource): void;
  get(id: SourceId): AudioSource | undefined;
  /** All registered sources, ready or not. */
  list(): AudioSource[];
  /** Route a namespaced media id to its owning source. */
  resolveOwner(id: MediaId): AudioSource | undefined;
  /** Fan-out search across all ready sources, merged + de-duplicated by ISRC. */
  searchAll(query: SearchQuery): Promise<SearchResult>;
}
