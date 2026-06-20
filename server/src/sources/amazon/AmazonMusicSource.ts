/**
 * YouTopia Server — Amazon Music Source (control + capture fallback).
 *
 * ADR-0002 / PM DECISION #2: Amazon Music is "Should / degraded".
 *
 * Reality check (2026):
 *  - Amazon's Web Playback API is closed-beta, requires device certification
 *    and Widevine DRM — not viable for an uncertified headless appliance.
 *  - Community clients (amazon-music PyPI package) support library/search/
 *    metadata browsing but stream URLs are DRM-protected (Widevine DASH) with
 *    only ~30 s of clear lead.
 *  - The only robust headless audio path is system-audio capture: let the
 *    Amazon Music web player or Electron app play in a hidden window while we
 *    capture the PipeWire/PulseAudio monitor sink via ffmpeg.
 *
 * What this implementation provides:
 *  1. health() — honestly reports degraded/capture-only and whether a capture
 *     sink is available.
 *  2. search() / getTrack/Album/Artist/Playlist() — stub returning empty
 *     results with a clear log; wired up if/when a viable metadata client
 *     becomes available.  Metadata can be populated via an external injector
 *     (e.g. the companion app sends now-playing events).
 *  3. getStreamHandle() — returns a StreamDeliveryKind.Capture handle pointing
 *     to the configured PipeWire/PulseAudio monitor sink. The DSP pipeline
 *     captures via:
 *       ffmpeg -f pulse -i <sink>.monitor -ac 2 -ar 48000 -f s16le pipe:1
 *     This is the same pattern as tv-audio-stream.ts in the companion server.
 *  4. Advertises capabilities WITHOUT PullableStream to signal to the engine
 *     that seek/gapless are unavailable.
 *
 * LIMITATIONS (clearly documented per ADR-0002):
 *  - No seek, no gapless, no per-track duration.
 *  - Capture quality = whatever Amazon outputs (128/256/HD — we can't control
 *    it headlessly, so no HD guarantee).
 *  - The capture handle is a live monitor; only one stream at a time.
 *  - No library sync (would need a working metadata client).
 *  - Track metadata in the StreamHandle trackId is best-effort.
 */

import * as fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

export interface AmazonSourceConfig {
  /**
   * PulseAudio / PipeWire monitor sink source name for capture.
   * Typically something like "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor"
   * or a virtual sink. Check `pactl list sources short` on the appliance.
   * Defaults to "default.monitor" which usually works for PipeWire.
   */
  captureSink?: string;
  /** Sample rate for capture output (default: 48000) */
  captureSampleRate?: number;
  /** Channel count for capture (default: 2) */
  captureChannels?: number;
  /**
   * ffmpeg binary path.  Default: "ffmpeg" from PATH.
   * The DSP chain will use this command descriptor to start capture.
   */
  ffmpegPath?: string;
  /**
   * EXPERIMENTAL: Path to amazon-music community client config/cookie.
   * If provided, search/metadata will be attempted.
   * Currently stubbed — wire in when a stable client exists.
   */
  metadataClientConfig?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(kind: "track" | "album" | "artist" | "playlist", nativeId: string): MediaId {
  return `${SourceId.AmazonMusic}:${kind}:${nativeId}`;
}

function parseNativeId(id: MediaId): string {
  return id.split(":").slice(2).join(":");
}

// ---------------------------------------------------------------------------
// AmazonMusicSource
// ---------------------------------------------------------------------------

export class AmazonMusicSource implements AudioSource {
  readonly id = SourceId.AmazonMusic;

  private readonly cfg: Required<AmazonSourceConfig>;
  private initialized = false;
  private captureAvailable = false;

  constructor(config: AmazonSourceConfig = {}) {
    this.cfg = {
      captureSink: config.captureSink ?? process.env["AMAZON_CAPTURE_SINK"] ?? "default.monitor",
      captureSampleRate: config.captureSampleRate ?? 48_000,
      captureChannels: config.captureChannels ?? 2,
      ffmpegPath: config.ffmpegPath ?? process.env["FFMPEG_PATH"] ?? "ffmpeg",
      metadataClientConfig: config.metadataClientConfig ?? "",
    };
  }

  // --------------------------------------------------------------------------
  // AudioSource interface
  // --------------------------------------------------------------------------

  describe(): SourceDescriptor {
    return {
      id: SourceId.AmazonMusic,
      displayName: "Amazon Music (Capture Mode)",
      // NOTE: No PullableStream — capture-only path per ADR-0002.
      // No Seekable — capture is a live stream with no seek capability.
      // No Library — library sync not implemented (DRM barrier).
      capabilities: [
        SourceCapability.Search, // stub — metadata-only if client available
        SourceCapability.Browse,
      ],
      ready: this.initialized && this.captureAvailable,
    };
  }

  supports(capability: SourceCapability): boolean {
    return this.describe().capabilities.includes(capability);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    logger.info("[amazon] Initializing Amazon Music source (capture mode)");

    // Check capture availability (PulseAudio/PipeWire)
    this.captureAvailable = await this.probeCaptureAvailable();
    this.initialized = true;

    logger.info(
      { captureAvailable: this.captureAvailable, sink: this.cfg.captureSink },
      "[amazon] Amazon Music source initialized (degraded/capture-only)"
    );
  }

  async health(): Promise<SourceHealth> {
    const captureOk = await this.probeCaptureAvailable();
    this.captureAvailable = captureOk;

    if (!captureOk) {
      return {
        ready: false,
        // Clearly communicate the capture-only degraded mode to the UI
        message:
          "Amazon Music: capture-only mode — PulseAudio/PipeWire monitor sink " +
          `'${this.cfg.captureSink}' not available. ` +
          "Ensure Amazon Music is playing on the system audio output and a monitor sink exists. " +
          "No PullableStream, no seek, no gapless. See ADR-0002.",
        needsAuth: false, // No auth mechanism; capture is system-level
      };
    }

    return {
      ready: true,
      message:
        `Amazon Music: DEGRADED/capture-only. Sink: ${this.cfg.captureSink}. ` +
        "Audio quality depends on Amazon output. No HD guarantee. No seek/gapless.",
      needsAuth: false,
    };
  }

  /**
   * Search is STUBBED.
   *
   * A future metadata client integration point. Currently returns empty results
   * with a logged warning. If/when a community Amazon Music metadata client
   * (e.g. amazon-music PyPI) becomes stable, wire it here.
   */
  async search(_query: SearchQuery): Promise<SearchResult> {
    logger.debug(
      "[amazon] search() called — Amazon Music metadata client not implemented (capture-only mode)"
    );
    return { tracks: [], albums: [], artists: [], playlists: [] };
  }

  /**
   * getTrack/Album/Artist/Playlist are STUBBED.
   *
   * These would normally call an Amazon Music API. Currently only the
   * capture path (getStreamHandle) is functional.
   *
   * NOTE for future integration: Amazon's public API has search/metadata
   * endpoints but stream URLs require DRM decryption. Metadata can be populated
   * if a community client or screen-scraper approach is wired in.
   */
  async getTrack(id: MediaId): Promise<Track> {
    const nativeId = parseNativeId(id);
    logger.debug({ id }, "[amazon] getTrack() — returning stub track (metadata not available)");
    // Return a minimal stub so the engine can at least reference the ID
    return {
      id,
      source: SourceId.AmazonMusic,
      nativeId,
      kind: "track",
      title: `Amazon Track (${nativeId})`,
      artwork: [],
      artistName: "Unknown Artist",
      artistIds: [],
      albumName: null,
      albumId: null,
      durationSeconds: 0,
    };
  }

  async getAlbum(id: MediaId): Promise<Album> {
    const nativeId = parseNativeId(id);
    logger.debug({ id }, "[amazon] getAlbum() — stub");
    return {
      id,
      source: SourceId.AmazonMusic,
      nativeId,
      kind: "album",
      title: `Amazon Album (${nativeId})`,
      artwork: [],
      artistName: "Unknown Artist",
      artistIds: [],
    };
  }

  async getArtist(id: MediaId): Promise<Artist> {
    const nativeId = parseNativeId(id);
    logger.debug({ id }, "[amazon] getArtist() — stub");
    return {
      id,
      source: SourceId.AmazonMusic,
      nativeId,
      kind: "artist",
      title: `Amazon Artist (${nativeId})`,
      artwork: [],
    };
  }

  async getPlaylist(id: MediaId): Promise<Playlist> {
    const nativeId = parseNativeId(id);
    logger.debug({ id }, "[amazon] getPlaylist() — stub");
    return {
      id,
      source: SourceId.AmazonMusic,
      nativeId,
      kind: "playlist",
      title: `Amazon Playlist (${nativeId})`,
      artwork: [],
    };
  }

  async getTrackIds(_containerId: MediaId): Promise<MediaId[]> {
    logger.debug("[amazon] getTrackIds() — stub (no track list without metadata client)");
    return [];
  }

  /**
   * Returns a capture-mode StreamHandle.
   *
   * DEGRADED PATH — see ADR-0002:
   *  - StreamDeliveryKind.Capture signals to the engine that it must read
   *    from the monitor sink rather than pull a URL.
   *  - The `uri` field holds the PulseAudio source name. The DSP pipeline
   *    should invoke ffmpeg as:
   *      ffmpeg -f pulse -i <uri> -ac 2 -ar 48000 -f s16le pipe:1
   *    (mirrors tv-audio-stream.ts in companion-server)
   *  - expiresAt is NOT set — the capture handle is valid as long as the sink
   *    is active (no re-resolve needed).
   *  - seekable = false — live capture has no seek.
   *
   * IMPORTANT: The `id` parameter (track id) is informational only for capture
   * mode. The actual audio is whatever Amazon is currently playing on the sink.
   */
  async getStreamHandle(_id: MediaId): Promise<StreamHandle> {
    if (!this.captureAvailable) {
      throw new Error(
        `[amazon] Capture sink '${this.cfg.captureSink}' not available. ` +
          "Check PulseAudio/PipeWire setup. Amazon Music must be playing on the system audio output."
      );
    }

    return {
      trackId: _id,
      delivery: StreamDeliveryKind.Capture,
      // URI = PulseAudio source name; ffmpeg uses "-f pulse -i <uri>"
      uri: this.cfg.captureSink,
      containerHint: "s16le/pcm",
      bitrateKbps: undefined, // unknown (Amazon output quality varies)
      sampleRate: this.cfg.captureSampleRate,
      headers: undefined,
      expiresAt: undefined, // capture doesn't expire; valid while sink is active
      seekable: false, // DEGRADED: live capture, no seek
    };
  }

  // No getRadio — too degraded to support

  async dispose(): Promise<void> {
    this.initialized = false;
    this.captureAvailable = false;
    logger.info("[amazon] Disposed");
  }

  // --------------------------------------------------------------------------
  // Private — capture availability probe
  // --------------------------------------------------------------------------

  /**
   * Probe whether the configured PulseAudio/PipeWire monitor sink is available.
   * Uses `pactl list sources short` to enumerate sinks; tolerates pactl not found.
   */
  private async probeCaptureAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("pactl", ["list", "sources", "short"], {
        timeout: 3_000,
      });
      // Each line: index  name  module  format  state
      const lines = stdout.split("\n");
      const sink = this.cfg.captureSink;
      // Match exact sink name or "default.monitor" as substring
      const found = lines.some((l) => l.includes(sink));
      return found;
    } catch {
      // pactl not found or failed — check if it's likely PipeWire via /proc
      try {
        const isPipeWire = fs.existsSync("/proc/$(pgrep -x pipewire 2>/dev/null | head -1)");
        if (isPipeWire) return true; // assume monitor available if PipeWire is running
      } catch {
        // ignore
      }
      // ffmpeg pulse input may still work; return false conservatively
      logger.debug("[amazon] pactl not available — assuming capture not ready");
      return false;
    }
  }
}
