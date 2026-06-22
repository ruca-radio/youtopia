/**
 * YouTopia Server — Local File Source.
 *
 * Scans a configurable music library directory for audio files (MP3, FLAC,
 * WAV, OGG, M4A), extracts tags with the `music-metadata` npm package, and
 * builds unified Track/Album/Artist/Playlist models with source-namespaced
 * MediaIds.
 *
 * Capabilities:
 *   - Full metadata extraction via music-metadata
 *   - In-memory fuzzy search (fuse.js) over title/artist/album
 *   - getStreamHandle → LocalFile delivery (ffmpeg-ready path)
 *   - Seekable, PullableStream
 *
 * music-metadata is ESM-only (v11+); we import it via dynamic import() so
 * the CJS build works correctly.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import Fuse from "fuse.js";

import type {
  AudioSource,
  Track,
  Album,
  Artist,
  Playlist,
  MediaId,
  SearchQuery,
  SearchResult,
  SourceDescriptor,
  SourceHealth,
  StreamHandle,
} from "../../contracts/index.js";
import {
  SourceId,
  SourceCapability,
  StreamDeliveryKind,
} from "../../contracts/index.js";
import { logger } from "../../logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Config consumed by LocalFileSource */
export interface LocalSourceConfig {
  /** Absolute path to the root music library directory. */
  libraryDir: string;
  /** Extensions to scan (lower-case, with dot). Default covers common lossless + lossy. */
  extensions?: string[];
  /** Maximum files to index (safety cap). Default 50 000. */
  maxFiles?: number;
}

interface MusicMetadataModule {
  parseFile: (filePath: string, options?: { skipCovers?: boolean }) => Promise<IAudioMetadata>;
}

// Partial shape of IAudioMetadata we actually use (avoids full type import)
interface ICommonTags {
  title?: string;
  artist?: string;
  albumartist?: string;
  album?: string;
  track?: { no: number | null; of: number | null };
  year?: number;
  genre?: string[];
  isrc?: string;
  explicit?: boolean;
  picture?: Array<{ format: string; data: Uint8Array }>;
}

interface IAudioMetadata {
  common: ICommonTags;
  format: {
    duration?: number;
    sampleRate?: number;
    bitrate?: number;
    container?: string;
  };
}

// ---------------------------------------------------------------------------
// MediaId helpers
// ---------------------------------------------------------------------------

/**
 * Build a source-namespaced MediaId.
 * Format: `${source}:${kind}:${nativeId}`
 */
function makeId(kind: "track" | "album" | "artist" | "playlist", nativeId: string): MediaId {
  return `${SourceId.Local}:${kind}:${nativeId}`;
}

function parseNativeId(id: MediaId): string {
  const parts = id.split(":");
  // parts[0] = source, parts[1] = kind, parts[2..] = nativeId (may contain colons)
  return parts.slice(2).join(":");
}

// ---------------------------------------------------------------------------
// Slugify helper — stable alphanumeric key from a string
// ---------------------------------------------------------------------------
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

// ---------------------------------------------------------------------------
// Internal catalog types
// ---------------------------------------------------------------------------

interface InternalTrack extends Track {
  filePath: string; // absolute local path
}

interface InternalArtist extends Artist {
  trackIds: MediaId[];
  albumIds: MediaId[];
}

interface InternalAlbum extends Album {
  trackIds: MediaId[];
}

// ---------------------------------------------------------------------------
// SUPPORTED_EXTENSIONS
// ---------------------------------------------------------------------------

const DEFAULT_EXTENSIONS = [".mp3", ".flac", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".wma"];

// ---------------------------------------------------------------------------
// LocalFileSource implementation
// ---------------------------------------------------------------------------

export class LocalFileSource extends EventEmitter implements AudioSource {
  readonly id = SourceId.Local;

  private readonly config: Required<LocalSourceConfig>;
  private initialized = false;

  // Catalog
  private tracks = new Map<string, InternalTrack>();      // nativeId → Track
  private albums = new Map<string, InternalAlbum>();      // nativeId → Album
  private artists = new Map<string, InternalArtist>();    // nativeId → Artist
  private playlists = new Map<string, Playlist>();        // nativeId → Playlist

  // Fuse indexes (built after scan)
  private fuseTrack!: Fuse<InternalTrack>;
  private fuseAlbum!: Fuse<InternalAlbum>;
  private fuseArtist!: Fuse<InternalArtist>;

  // Lazy-loaded ESM module
  private mmModule?: MusicMetadataModule;

  constructor(config: LocalSourceConfig) {
    super();
    this.config = {
      libraryDir: config.libraryDir,
      extensions: config.extensions ?? DEFAULT_EXTENSIONS,
      maxFiles: config.maxFiles ?? 50_000,
    };
  }

  // --------------------------------------------------------------------------
  // AudioSource interface
  // --------------------------------------------------------------------------

  describe(): SourceDescriptor {
    return {
      id: SourceId.Local,
      displayName: "Local Library",
      capabilities: [
        SourceCapability.Search,
        SourceCapability.Browse,
        SourceCapability.Library,
        SourceCapability.PullableStream,
        SourceCapability.Seekable,
      ],
      ready: this.initialized,
    };
  }

  supports(capability: SourceCapability): boolean {
    return this.describe().capabilities.includes(capability);
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    logger.info({ libraryDir: this.config.libraryDir }, "[local] Initializing local source");

    // Resolve ESM music-metadata
    try {
      this.mmModule = (await import("music-metadata")) as unknown as MusicMetadataModule;
    } catch (err) {
      logger.error({ err }, "[local] Failed to load music-metadata — library scanning disabled");
    }

    // Scan library
    if (!fs.existsSync(this.config.libraryDir)) {
      logger.warn({ libraryDir: this.config.libraryDir }, "[local] Library dir not found — empty catalog");
      this.buildIndexes();
      this.initialized = true;
      return;
    }

    await this.scanLibrary();
    this.buildIndexes();
    this.initialized = true;

    logger.info(
      { tracks: this.tracks.size, albums: this.albums.size, artists: this.artists.size },
      "[local] Library scan complete"
    );
  }

  async health(): Promise<SourceHealth> {
    const exists = fs.existsSync(this.config.libraryDir);
    if (!this.initialized) {
      return { ready: false, message: "Not initialized — call init() first", needsAuth: false };
    }
    if (!exists) {
      return {
        ready: false,
        message: `Library dir not found: ${this.config.libraryDir}`,
        needsAuth: false,
      };
    }
    return {
      ready: true,
      message: `${this.tracks.size} tracks, ${this.albums.size} albums, ${this.artists.size} artists`,
      needsAuth: false,
    };
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    if (!this.initialized) await this.init();

    const text = query.text.trim();
    if (!text) return { tracks: [], albums: [], artists: [], playlists: [] };

    const limit = query.limit ?? 25;
    const kinds = query.kinds ?? ["track", "album", "artist", "playlist"];

    const result: SearchResult = { tracks: [], albums: [], artists: [], playlists: [] };

    if (kinds.includes("track")) {
      result.tracks = this.fuseTrack.search(text, { limit }).map((r) => r.item);
    }
    if (kinds.includes("album")) {
      result.albums = this.fuseAlbum.search(text, { limit }).map((r) => r.item);
    }
    if (kinds.includes("artist")) {
      result.artists = this.fuseArtist.search(text, { limit }).map((r) => r.item);
    }

    return result;
  }

  async getTrack(id: MediaId): Promise<Track> {
    const nativeId = parseNativeId(id);
    const track = this.tracks.get(nativeId);
    if (!track) throw new Error(`[local] Track not found: ${id}`);
    return track;
  }

  async getAlbum(id: MediaId): Promise<Album> {
    const nativeId = parseNativeId(id);
    const album = this.albums.get(nativeId);
    if (!album) throw new Error(`[local] Album not found: ${id}`);
    return album;
  }

  async getArtist(id: MediaId): Promise<Artist> {
    const nativeId = parseNativeId(id);
    const artist = this.artists.get(nativeId);
    if (!artist) throw new Error(`[local] Artist not found: ${id}`);
    return artist;
  }

  async getPlaylist(id: MediaId): Promise<Playlist> {
    const nativeId = parseNativeId(id);
    const playlist = this.playlists.get(nativeId);
    if (!playlist) throw new Error(`[local] Playlist not found: ${id}`);
    return playlist;
  }

  async getTrackIds(containerId: MediaId): Promise<MediaId[]> {
    const [, kind] = containerId.split(":");
    const nativeId = parseNativeId(containerId);

    if (kind === "album") {
      const album = this.albums.get(nativeId);
      return album?.trackIds ?? [];
    }
    if (kind === "playlist") {
      const playlist = this.playlists.get(nativeId);
      if (!playlist) return [];
      // Built-in playlists are virtual — return all tracks sorted by artist+title
      return [...this.tracks.values()]
        .sort((a, b) => a.artistName.localeCompare(b.artistName) || a.title.localeCompare(b.title))
        .map((t) => t.id);
    }

    return [];
  }

  async getStreamHandle(id: MediaId): Promise<StreamHandle> {
    const track = await this.getTrack(id);
    const internal = track as InternalTrack;

    if (!internal.filePath) {
      throw new Error(`[local] No file path for track ${id}`);
    }
    if (!fs.existsSync(internal.filePath)) {
      throw new Error(`[local] File not found on disk: ${internal.filePath}`);
    }

    const ext = path.extname(internal.filePath).toLowerCase();
    const containerHint = extToContainerHint(ext);

    return {
      trackId: id,
      delivery: StreamDeliveryKind.LocalFile,
      uri: internal.filePath,
      containerHint,
      bitrateKbps: undefined, // ffmpeg can re-probe
      sampleRate: track.durationSeconds > 0 ? undefined : undefined,
      headers: undefined,
      expiresAt: undefined, // local files don't expire
      seekable: true,
    };
  }

  async getRadio(seedTrackId: MediaId, limit = 20): Promise<Track[]> {
    const seed = await this.getTrack(seedTrackId);
    // Simple radio: same artist, shuffled
    const sameArtist = [...this.tracks.values()].filter(
      (t) => t.id !== seedTrackId && t.artistName === seed.artistName
    );
    shuffle(sameArtist);
    return sameArtist.slice(0, limit);
  }

  async dispose(): Promise<void> {
    this.tracks.clear();
    this.albums.clear();
    this.artists.clear();
    this.playlists.clear();
    this.initialized = false;
    logger.info("[local] Disposed");
  }

  // --------------------------------------------------------------------------
  // Public helpers for library service
  // --------------------------------------------------------------------------

  getAllTracks(): Track[] {
    return [...this.tracks.values()];
  }

  getAllAlbums(): Album[] {
    return [...this.albums.values()];
  }

  getAllArtists(): Artist[] {
    return [...this.artists.values()];
  }

  getTracksByArtist(artistId: MediaId): Track[] {
    const nativeId = parseNativeId(artistId);
    const artist = this.artists.get(nativeId);
    if (!artist) return [];
    return artist.trackIds
      .map((id) => this.tracks.get(parseNativeId(id)))
      .filter((t): t is InternalTrack => t !== undefined);
  }

  getAlbumsByArtist(artistId: MediaId): Album[] {
    const nativeId = parseNativeId(artistId);
    const artist = this.artists.get(nativeId);
    if (!artist) return [];
    return artist.albumIds
      .map((id) => this.albums.get(parseNativeId(id)))
      .filter((a): a is InternalAlbum => a !== undefined);
  }

  // --------------------------------------------------------------------------
  // Private — scanning & indexing
  // --------------------------------------------------------------------------

  private async scanLibrary(): Promise<void> {
    const files = collectAudioFiles(
      this.config.libraryDir,
      this.config.extensions,
      this.config.maxFiles
    );

    logger.info({ count: files.length }, "[local] Scanning audio files");

    for (const filePath of files) {
      try {
        await this.indexFile(filePath);
      } catch (err) {
        logger.debug({ filePath, err }, "[local] Skipped file (parse error)");
      }
    }

    // Build "All Tracks" built-in playlist
    this.playlists.set("all", {
      id: makeId("playlist", "all"),
      source: SourceId.Local,
      nativeId: "all",
      kind: "playlist",
      title: "All Tracks",
      artwork: [],
      description: "All local tracks",
      trackCount: this.tracks.size,
    });
  }

  private async indexFile(filePath: string): Promise<void> {
    let meta: IAudioMetadata | undefined;

    if (this.mmModule) {
      try {
        meta = await this.mmModule.parseFile(filePath, { skipCovers: false });
      } catch {
        // Fall back to filename-only metadata
      }
    }

    const common = meta?.common ?? {};
    const format = meta?.format ?? {};

    // ---------- Artist ----------
    const rawArtist = common.albumartist ?? common.artist ?? "Unknown Artist";
    const artistNativeId = slugify(rawArtist);
    const artistId = makeId("artist", artistNativeId);

    if (!this.artists.has(artistNativeId)) {
      this.artists.set(artistNativeId, {
        id: artistId,
        source: SourceId.Local,
        nativeId: artistNativeId,
        kind: "artist",
        title: rawArtist,
        artwork: [],
        genres: common.genre,
        trackIds: [],
        albumIds: [],
      });
    }

    // ---------- Album ----------
    const rawAlbum = common.album ?? "Unknown Album";
    const albumNativeId = slugify(`${artistNativeId}_${rawAlbum}`);
    const albumId = makeId("album", albumNativeId);

    if (!this.albums.has(albumNativeId)) {
      this.albums.set(albumNativeId, {
        id: albumId,
        source: SourceId.Local,
        nativeId: albumNativeId,
        kind: "album",
        title: rawAlbum,
        artwork: buildArtwork(common.picture),
        artistName: rawArtist,
        artistIds: [artistId],
        year: common.year,
        trackIds: [],
        trackCount: 0,
      });
    }

    // ---------- Track ----------
    const rawTitle = common.title ?? path.basename(filePath, path.extname(filePath));
    const trackNativeId = slugify(filePath); // use file path as stable native id
    const trackId = makeId("track", trackNativeId);

    const track: InternalTrack = {
      id: trackId,
      source: SourceId.Local,
      nativeId: trackNativeId,
      kind: "track",
      title: rawTitle,
      artwork: buildArtwork(common.picture),
      artistName: common.artist ?? rawArtist,
      artistIds: [artistId],
      albumName: rawAlbum,
      albumId: albumId,
      durationSeconds: format.duration ?? 0,
      trackNumber: common.track?.no ?? undefined,
      isrc: common.isrc,
      explicit: common.explicit,
      filePath,
    };

    this.tracks.set(trackNativeId, track);

    // Link to album + artist
    const album = this.albums.get(albumNativeId)!;
    if (!album.trackIds.includes(trackId)) {
      album.trackIds.push(trackId);
      album.trackCount = album.trackIds.length;
    }

    const artist = this.artists.get(artistNativeId)!;
    if (!artist.trackIds.includes(trackId)) {
      artist.trackIds.push(trackId);
    }
    if (!artist.albumIds.includes(albumId)) {
      artist.albumIds.push(albumId);
    }
  }

  private buildIndexes(): void {
    const fuseOptions = {
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2,
    };

    this.fuseTrack = new Fuse([...this.tracks.values()], {
      ...fuseOptions,
      keys: [
        { name: "title", weight: 0.6 },
        { name: "artistName", weight: 0.3 },
        { name: "albumName", weight: 0.1 },
      ],
    });

    this.fuseAlbum = new Fuse([...this.albums.values()], {
      ...fuseOptions,
      keys: [
        { name: "title", weight: 0.6 },
        { name: "artistName", weight: 0.4 },
      ],
    });

    this.fuseArtist = new Fuse([...this.artists.values()], {
      ...fuseOptions,
      keys: [{ name: "title", weight: 1.0 }],
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectAudioFiles(dir: string, extensions: string[], maxFiles: number): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    if (results.length >= maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.includes(ext)) {
          results.push(full);
        }
      }
    }
  }

  walk(dir);
  return results;
}

function buildArtwork(
  pictures?: Array<{ format: string; data: Uint8Array }> | undefined
): Array<{ url: string; width: number; height: number }> {
  // We embed artwork as data-URIs for in-process use;
  // a REST endpoint will expose /api/v1/tracks/:id/artwork in a future pass.
  // For now return empty array — the artwork is accessible via getStreamHandle.
  if (!pictures || pictures.length === 0) return [];
  const pic = pictures[0]!;
  const b64 = Buffer.from(pic.data).toString("base64");
  return [
    {
      url: `data:${pic.format};base64,${b64}`,
      width: 0, // dimensions unknown without image decode
      height: 0,
    },
  ];
}

function extToContainerHint(ext: string): string {
  const map: Record<string, string> = {
    ".mp3": "mp3/mp3",
    ".flac": "flac/flac",
    ".wav": "wav/pcm",
    ".ogg": "ogg/vorbis",
    ".m4a": "m4a/aac",
    ".aac": "aac/aac",
    ".opus": "ogg/opus",
    ".wma": "asf/wma",
  };
  return map[ext] ?? "unknown";
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}
