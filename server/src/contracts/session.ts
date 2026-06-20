/**
 * YouTopia Intelligent Music Server — Player / Session / Room / Zone models.
 *
 * Core multi-room + multi-user model (Pod D designs, Pod A hosts the runtime):
 *
 *   User      — a login (e.g. Patrick, spouse). Owns Sessions.
 *   Session   — an independent playback program: queue + transport + DSP chain.
 *               Belongs to exactly one User. Patrick and spouse run separate
 *               Sessions simultaneously (independent streams).
 *   Room      — a physical output endpoint (a client device / speaker zone).
 *   Zone      — a sync group of one-or-more Rooms playing ONE Session in
 *               lock-step (Sonos-like). A Room belongs to at most one Zone.
 *
 * A Session can be bound to a Zone; every Room in that Zone renders the same
 * synchronized audio. Different Zones can host different Sessions at once.
 */

import type {
  PlaybackState,
  RepeatMode,
  ClientKind,
  TransportKind,
  OutputCodec
} from "./enums";
import type { MediaId, Track } from "./media";
import type { DspNodeState, BeatTelemetry } from "./dsp";
import type { Enrichment } from "./enrichment";

/** A user login. Auth handled by Pod A (token/PIN per existing convention). */
export type User = {
  userId: string;
  displayName: string;
};

/** One entry in a Session's play queue. */
export type QueueItem = {
  /** Stable per-queue uuid (lets the same track appear twice). */
  itemId: string;
  trackId: MediaId;
  /** Denormalized for fast now-playing render. */
  track: Track;
};

/** Transport snapshot for a Session. Superset of RendererPlayerState. */
export type Transport = {
  state: PlaybackState;
  /** Index into the queue of the current item, -1 if empty. */
  currentIndex: number;
  /** Playback position of current item in seconds. */
  positionSeconds: number;
  /** Volume 0..1 (matches RendererPlayerState.volume). */
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
};

/** Now-playing payload broadcast to clients and the AI/lightss layer. */
export type NowPlaying = {
  sessionId: string;
  transport: Transport;
  current: QueueItem | null;
  enrichment: Enrichment | null;
  beat: BeatTelemetry | null;
};

/** An independent playback program owned by one user. */
export type Session = {
  sessionId: string;
  /** Owning user login. */
  userId: string;
  transport: Transport;
  queue: QueueItem[];
  /** DSP chain state for this session (per-session enrichment). */
  dsp: DspNodeState[];
  /** Zone currently rendering this session, if bound. */
  zoneId: string | null;
};

/** A physical output endpoint / client device. */
export type Room = {
  roomId: string;
  displayName: string;
  client: ClientKind;
  /** Negotiated output transport + codec for this room. */
  transport: TransportKind;
  codec: OutputCodec;
  /** Per-room trim 0..1 applied after the session mix. */
  outputVolume: number;
  /** Zone membership, or null if standalone. */
  zoneId: string | null;
  online: boolean;
};

/**
 * A sync group of Rooms that play one Session in lock-step. The clock/buffer
 * model (snapcast-style NTP offset + global buffer + scheduled start time) is
 * carried in {@link SyncClock}. See ADR-0004.
 */
export type Zone = {
  zoneId: string;
  displayName: string;
  roomIds: string[];
  /** The session this zone is rendering, or null when idle. */
  sessionId: string | null;
  clock: SyncClock;
};

/**
 * Shared timing reference for synchronized multi-room playback.
 * Clients align local playout to `serverEpochMs` using their measured
 * `offsetMs`, then begin a chunk at `scheduledStartMs` after buffering
 * `bufferMs`. Mirrors snapcast/NTP-offset approach (ADR-0004).
 */
export type SyncClock = {
  /** Authoritative server time anchor in epoch ms. */
  serverEpochMs: number;
  /** Global playout buffer all rooms honor before starting (e.g. 300 ms). */
  bufferMs: number;
  /** Scheduled wall-clock (server epoch ms) to begin the current segment. */
  scheduledStartMs: number;
};

/**
 * Per-client measured clock offset, reported back to the server so it can
 * verify all rooms in a zone are within bufferMs of each other.
 */
export type ClientClockReport = {
  roomId: string;
  /** Estimated (clientClock - serverClock) in ms from NTP-style exchange. */
  offsetMs: number;
  /** Round-trip time in ms. */
  rttMs: number;
  reportedAt: number;
};
