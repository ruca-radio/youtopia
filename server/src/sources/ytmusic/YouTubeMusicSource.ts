/**
 * YouTopia Server — YouTube Music Source.
 *
 * Implements AudioSource using:
 *  - ytmusicapi Python sidecar (server/sidecars/ytmusic/sidecar.py) for
 *    catalog: search, track/album/artist/playlist metadata, library.
 *  - yt-dlp for getStreamHandle() — resolves a time-limited direct audio URL
 *    from a YouTube video id.
 *
 * ADR-0002 decision: YTM is the PRIMARY source.
 *
 * Capabilities: Search, Browse, Playlists, Library, Lyrics, Radio,
 *               PullableStream, Seekable.
 *
 * Auth / readiness:
 *  - Sidecar health endpoint is polled; if it returns ready=false, health()
 *    reports needsAuth=true.
 *  - yt-dlp must be on PATH (or configured via YTDLP_PATH env).
 *  - If sidecar is not running, getStreamHandle still attempts yt-dlp directly.
 *
 * Sidecar process management:
 *  - If config.sidecarPath is set, the TS source spawns and supervises the
 *    Python sidecar automatically.
 *  - If not set, assumes sidecar is already running externally on sidecarUrl.
 */

import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as http from "node:http";
import * as https from "node:https";
import * as path from "node:path";
import * as fs from "node:fs";

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

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface YtMusicSourceConfig {
  /** Base URL of the running sidecar, e.g. "http://127.0.0.1:9871" */
  sidecarUrl?: string;
  /** Absolute path to sidecar.py — if set, the TS server manages the process */
  sidecarPath?: string;
  /** Absolute path to auth JSON file (ytmusicapi headers.json or oauth.json) */
  authFile?: string;
  /** Cookies file (Netscape format) for yt-dlp Premium quality */
  cookiesFile?: string;
  /** Override yt-dlp binary path (default: "yt-dlp" from PATH) */
  ytdlpPath?: string;
  /** Override Python binary (default: "python3") */
  pythonPath?: string;
  /** Sidecar port (default: 9871) */
  sidecarPort?: number;
}

// ---------------------------------------------------------------------------
// Sidecar response shapes
// ---------------------------------------------------------------------------

interface SidecarResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

interface SidecarHealth {
  ready: boolean;
  ytmusicapiAvailable: boolean;
  authenticated: boolean;
  message: string;
}

interface SidecarSearchResult {
  tracks: SidecarTrack[];
  albums: SidecarAlbum[];
  artists: SidecarArtist[];
  playlists: SidecarPlaylist[];
  error?: string;
}

interface SidecarArtwork {
  url: string;
  width: number;
  height: number;
}

interface SidecarTrack {
  kind: "track";
  nativeId: string;
  id: string;
  source: string;
  title: string;
  artwork: SidecarArtwork[];
  artistName: string;
  artistIds: string[];
  albumName: string | null;
  albumId: string | null;
  durationSeconds: number;
  explicit?: boolean;
  hasVideo?: boolean;
  isrc?: string;
}

interface SidecarAlbum {
  kind: "album";
  nativeId: string;
  id: string;
  source: string;
  title: string;
  artwork: SidecarArtwork[];
  artistName: string;
  artistIds: string[];
  year?: number;
  trackCount?: number;
}

interface SidecarArtist {
  kind: "artist";
  nativeId: string;
  id: string;
  source: string;
  title: string;
  artwork: SidecarArtwork[];
  description?: string;
  genres?: string[];
}

interface SidecarPlaylist {
  kind: "playlist";
  nativeId: string;
  id: string;
  source: string;
  title: string;
  artwork: SidecarArtwork[];
  description?: string;
  ownerName?: string;
  trackCount?: number;
}

// ---------------------------------------------------------------------------
// yt-dlp output shape (JSON from --print-json)
// ---------------------------------------------------------------------------

interface YtDlpInfo {
  id: string;
  url?: string;
  webpage_url?: string;
  ext?: string;
  acodec?: string;
  abr?: number;
  asr?: number;
  container?: string;
  http_headers?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// MediaId helpers
// ---------------------------------------------------------------------------

function makeId(kind: "track" | "album" | "artist" | "playlist", nativeId: string): MediaId {
  return `${SourceId.YouTubeMusic}:${kind}:${nativeId}`;
}

function parseNativeId(id: MediaId): string {
  return id.split(":").slice(2).join(":");
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class YouTubeMusicSource implements AudioSource {
  readonly id = SourceId.YouTubeMusic;

  private readonly cfg: Required<YtMusicSourceConfig>;
  private sidecarProcess: ChildProcess | null = null;
  private sidecarReady = false;
  private initCalled = false;

  constructor(config: YtMusicSourceConfig = {}) {
    const port = config.sidecarPort ?? 9871;
    this.cfg = {
      sidecarUrl: config.sidecarUrl ?? `http://127.0.0.1:${port}`,
      sidecarPath: config.sidecarPath ?? path.resolve(__dirname, "../../../sidecars/ytmusic/sidecar.py"),
      authFile: config.authFile ?? process.env["YTMUSIC_AUTH_FILE"] ?? "",
      cookiesFile: config.cookiesFile ?? process.env["YTMUSIC_COOKIES_FILE"] ?? "",
      ytdlpPath: config.ytdlpPath ?? process.env["YTDLP_PATH"] ?? "yt-dlp",
      pythonPath: config.pythonPath ?? process.env["PYTHON_PATH"] ?? "python3",
      sidecarPort: port,
    };
  }

  // --------------------------------------------------------------------------
  // AudioSource
  // --------------------------------------------------------------------------

  describe(): SourceDescriptor {
    return {
      id: SourceId.YouTubeMusic,
      displayName: "YouTube Music",
      capabilities: [
        SourceCapability.Search,
        SourceCapability.Browse,
        SourceCapability.Playlists,
        SourceCapability.Library,
        SourceCapability.Lyrics,
        SourceCapability.Radio,
        SourceCapability.PullableStream,
        SourceCapability.Seekable,
      ],
      ready: this.sidecarReady,
    };
  }

  supports(capability: SourceCapability): boolean {
    return this.describe().capabilities.includes(capability);
  }

  async init(): Promise<void> {
    if (this.initCalled) return;
    this.initCalled = true;

    logger.info("[ytmusic] Initializing YouTube Music source");

    // Try to start sidecar if path is configured and sidecar is not running
    if (this.cfg.sidecarPath && fs.existsSync(this.cfg.sidecarPath)) {
      await this.startSidecar();
    }

    // Poll health
    await this.pollHealth(3, 1500);
  }

  async health(): Promise<SourceHealth> {
    try {
      const raw = await this.sidecarGet<SidecarHealth>("/health");
      if (!raw.ok || !raw.data) {
        return { ready: false, message: "Sidecar error", needsAuth: false };
      }
      const h = raw.data;
      this.sidecarReady = h.ready;
      return {
        ready: h.ready,
        message: h.message,
        needsAuth: !h.authenticated,
      };
    } catch (err) {
      this.sidecarReady = false;
      return {
        ready: false,
        message: `Sidecar not reachable at ${this.cfg.sidecarUrl}: ${String(err)}`,
        needsAuth: false,
      };
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const params = new URLSearchParams({ q: query.text, limit: String(query.limit ?? 25) });
    const raw = await this.sidecarGet<SidecarSearchResult>(`/search?${params}`);
    if (!raw.ok || !raw.data) return empty();

    const d = raw.data;
    return {
      tracks: (d.tracks ?? []).map(trackFromSidecar),
      albums: (d.albums ?? []).map(albumFromSidecar),
      artists: (d.artists ?? []).map(artistFromSidecar),
      playlists: (d.playlists ?? []).map(playlistFromSidecar),
    };
  }

  async getTrack(id: MediaId): Promise<Track> {
    const nativeId = parseNativeId(id);
    const raw = await this.sidecarGet<SidecarTrack>(`/track/${nativeId}`);
    if (!raw.ok || !raw.data) throw new Error(`[ytmusic] Track not found: ${id}`);
    return trackFromSidecar(raw.data);
  }

  async getAlbum(id: MediaId): Promise<Album> {
    const nativeId = parseNativeId(id);
    const raw = await this.sidecarGet<{ album: SidecarAlbum; tracks: SidecarTrack[] }>(`/album/${nativeId}`);
    if (!raw.ok || !raw.data) throw new Error(`[ytmusic] Album not found: ${id}`);
    return albumFromSidecar(raw.data.album);
  }

  async getArtist(id: MediaId): Promise<Artist> {
    const nativeId = parseNativeId(id);
    const raw = await this.sidecarGet<{ artist: SidecarArtist; albums: SidecarAlbum[] }>(`/artist/${nativeId}`);
    if (!raw.ok || !raw.data) throw new Error(`[ytmusic] Artist not found: ${id}`);
    return artistFromSidecar(raw.data.artist);
  }

  async getPlaylist(id: MediaId): Promise<Playlist> {
    const nativeId = parseNativeId(id);
    const raw = await this.sidecarGet<{ playlist: SidecarPlaylist; tracks: SidecarTrack[] }>(`/playlist/${nativeId}`);
    if (!raw.ok || !raw.data) throw new Error(`[ytmusic] Playlist not found: ${id}`);
    return playlistFromSidecar(raw.data.playlist);
  }

  async getTrackIds(containerId: MediaId): Promise<MediaId[]> {
    const [, kind] = containerId.split(":");
    const nativeId = parseNativeId(containerId);

    if (kind === "album") {
      const raw = await this.sidecarGet<{ album: SidecarAlbum; tracks: SidecarTrack[] }>(`/album/${nativeId}`);
      if (!raw.ok || !raw.data) return [];
      return raw.data.tracks.map((t) => makeId("track", t.nativeId));
    }
    if (kind === "playlist") {
      const raw = await this.sidecarGet<{ playlist: SidecarPlaylist; tracks: SidecarTrack[] }>(`/playlist/${nativeId}`);
      if (!raw.ok || !raw.data) return [];
      return raw.data.tracks.map((t) => makeId("track", t.nativeId));
    }
    return [];
  }

  /**
   * Resolve a time-limited stream handle via yt-dlp.
   *
   * yt-dlp command:
   *   yt-dlp -f bestaudio --get-url --print-json [--cookies <file>] <url>
   *
   * Stream URLs returned by yt-dlp expire (typically 6 hours). The engine
   * should re-call getStreamHandle when expiresAt is reached.
   */
  async getStreamHandle(id: MediaId): Promise<StreamHandle> {
    const nativeId = parseNativeId(id);
    const videoUrl = `https://music.youtube.com/watch?v=${nativeId}`;

    const args = buildYtDlpArgs(videoUrl, this.cfg.cookiesFile);

    logger.debug({ id, args }, "[ytmusic] Resolving stream via yt-dlp");

    let stdout: string;
    try {
      const result = await execFileAsync(this.cfg.ytdlpPath, args, {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      });
      stdout = result.stdout;
    } catch (err) {
      throw new Error(`[ytmusic] yt-dlp failed for ${id}: ${String(err)}`);
    }

    // yt-dlp --print-json emits one JSON line
    let info: YtDlpInfo;
    try {
      // The last non-empty line is the JSON; --get-url lines come before
      const lines = stdout.trim().split("\n").filter(Boolean);
      const jsonLine = lines.find((l) => l.startsWith("{")) ?? lines[lines.length - 1] ?? "{}";
      info = JSON.parse(jsonLine) as YtDlpInfo;
    } catch {
      throw new Error(`[ytmusic] Could not parse yt-dlp JSON for ${id}`);
    }

    const streamUrl = info.url ?? info.webpage_url;
    if (!streamUrl) {
      throw new Error(`[ytmusic] No stream URL from yt-dlp for ${id}`);
    }

    const containerHint = info.acodec
      ? `${info.container ?? "webm"}/${info.acodec}`
      : "webm/opus";

    // yt-dlp stream URLs typically expire in ~6 hours
    const expiresAt = Date.now() + 6 * 60 * 60 * 1000;

    return {
      trackId: id,
      delivery: StreamDeliveryKind.DirectUrl,
      uri: streamUrl,
      containerHint,
      bitrateKbps: info.abr,
      sampleRate: info.asr,
      headers: info.http_headers,
      expiresAt,
      seekable: true,
    };
  }

  async getRadio(seedTrackId: MediaId, limit = 25): Promise<Track[]> {
    // YTM watch playlist = autoplay / radio
    const nativeId = parseNativeId(seedTrackId);
    const radioPlaylistId = `RDAMVM${nativeId}`;
    try {
      const raw = await this.sidecarGet<{ playlist: SidecarPlaylist; tracks: SidecarTrack[] }>(
        `/playlist/${radioPlaylistId}`
      );
      if (!raw.ok || !raw.data) return [];
      return raw.data.tracks.slice(0, limit).map(trackFromSidecar);
    } catch {
      return [];
    }
  }

  async dispose(): Promise<void> {
    if (this.sidecarProcess) {
      logger.info("[ytmusic] Stopping sidecar process");
      this.sidecarProcess.kill("SIGTERM");
      this.sidecarProcess = null;
    }
    this.sidecarReady = false;
    logger.info("[ytmusic] Disposed");
  }

  // --------------------------------------------------------------------------
  // Sidecar management
  // --------------------------------------------------------------------------

  private async startSidecar(): Promise<void> {
    // Check if something already listening on the sidecar URL
    const alreadyUp = await this.pingHealth();
    if (alreadyUp) {
      logger.info("[ytmusic] Sidecar already running — skipping spawn");
      return;
    }

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      YTMUSIC_PORT: String(this.cfg.sidecarPort),
      YTMUSIC_HOST: "127.0.0.1",
    };
    if (this.cfg.authFile) env["YTMUSIC_AUTH_FILE"] = this.cfg.authFile;

    logger.info({ sidecarPath: this.cfg.sidecarPath }, "[ytmusic] Spawning sidecar");

    this.sidecarProcess = spawn(this.cfg.pythonPath, [this.cfg.sidecarPath], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    this.sidecarProcess.stdout?.on("data", (d: Buffer) => {
      logger.debug({ msg: d.toString().trim() }, "[ytmusic-sidecar] stdout");
    });
    this.sidecarProcess.stderr?.on("data", (d: Buffer) => {
      logger.debug({ msg: d.toString().trim() }, "[ytmusic-sidecar] stderr");
    });
    this.sidecarProcess.on("exit", (code) => {
      logger.warn({ code }, "[ytmusic] Sidecar process exited");
      this.sidecarProcess = null;
      this.sidecarReady = false;
    });
  }

  private async pingHealth(): Promise<boolean> {
    try {
      await this.sidecarGet<SidecarHealth>("/health");
      return true;
    } catch {
      return false;
    }
  }

  private async pollHealth(retries: number, delayMs: number): Promise<void> {
    for (let i = 0; i < retries; i++) {
      const h = await this.health();
      if (h.ready) return;
      if (i < retries - 1) await sleep(delayMs);
    }
    // Not fatal — health() accurately reports not-ready
    logger.warn("[ytmusic] Sidecar not ready after init — source will report not-ready");
  }

  // --------------------------------------------------------------------------
  // HTTP client (no axios dep — plain Node http/https)
  // --------------------------------------------------------------------------

  private sidecarGet<T>(urlPath: string): Promise<SidecarResponse<T>> {
    return new Promise((resolve, reject) => {
      const fullUrl = this.cfg.sidecarUrl + urlPath;
      const mod = fullUrl.startsWith("https://") ? https : http;

      const req = mod.get(fullUrl, { timeout: 10_000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (d: Buffer) => chunks.push(d));
        res.on("end", () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString()) as SidecarResponse<T>;
            resolve(body);
          } catch (err) {
            reject(new Error(`[ytmusic] JSON parse error: ${String(err)}`));
          }
        });
      });

      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("[ytmusic] Sidecar request timed out"));
      });
    });
  }
}

// ---------------------------------------------------------------------------
// yt-dlp argument builder
// ---------------------------------------------------------------------------

function buildYtDlpArgs(videoUrl: string, cookiesFile?: string): string[] {
  const args = [
    "--no-warnings",
    "-f", "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
    "--print-json",
    "--get-url",
    "--no-playlist",
  ];

  if (cookiesFile && fs.existsSync(cookiesFile)) {
    args.push("--cookies", cookiesFile);
  }

  args.push(videoUrl);
  return args;
}

// ---------------------------------------------------------------------------
// Normalisation — sidecar shapes → contracts shapes
// ---------------------------------------------------------------------------

function trackFromSidecar(s: SidecarTrack): Track {
  return {
    id: makeId("track", s.nativeId) as MediaId,
    source: SourceId.YouTubeMusic,
    nativeId: s.nativeId,
    kind: "track",
    title: s.title,
    artwork: s.artwork,
    artistName: s.artistName,
    artistIds: s.artistIds as MediaId[],
    albumName: s.albumName,
    albumId: s.albumId as MediaId | null,
    durationSeconds: s.durationSeconds,
    explicit: s.explicit,
    hasVideo: s.hasVideo,
    isrc: s.isrc,
  };
}

function albumFromSidecar(s: SidecarAlbum): Album {
  return {
    id: makeId("album", s.nativeId) as MediaId,
    source: SourceId.YouTubeMusic,
    nativeId: s.nativeId,
    kind: "album",
    title: s.title,
    artwork: s.artwork,
    artistName: s.artistName,
    artistIds: s.artistIds as MediaId[],
    year: s.year,
    trackCount: s.trackCount,
  };
}

function artistFromSidecar(s: SidecarArtist): Artist {
  return {
    id: makeId("artist", s.nativeId) as MediaId,
    source: SourceId.YouTubeMusic,
    nativeId: s.nativeId,
    kind: "artist",
    title: s.title,
    artwork: s.artwork,
    description: s.description,
    genres: s.genres,
  };
}

function playlistFromSidecar(s: SidecarPlaylist): Playlist {
  return {
    id: makeId("playlist", s.nativeId) as MediaId,
    source: SourceId.YouTubeMusic,
    nativeId: s.nativeId,
    kind: "playlist",
    title: s.title,
    artwork: s.artwork,
    description: s.description,
    ownerName: s.ownerName,
    trackCount: s.trackCount,
  };
}

function empty(): SearchResult {
  return { tracks: [], albums: [], artists: [], playlists: [] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
