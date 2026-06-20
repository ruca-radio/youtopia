/**
 * YouTopia Server — Pod D: StreamScheduler.
 *
 * Given a Session's audio program and a sync group (Zone + SyncClock), produces
 * per-client scheduled chunk timing for PCM-over-TCP delivery (ADR-0004/0005).
 *
 * Architecture:
 *  - The session produces a continuous decoded PCM stream (Pod C / ffmpeg output).
 *  - StreamScheduler divides that stream into fixed-size time-chunks.
 *  - Each chunk carries a scheduledPlayAt timestamp (server epoch ms) telling
 *    the client exactly when to begin rendering.
 *  - All rooms in the zone receive the same chunk with the same scheduledPlayAt,
 *    so they render the same samples in lock-step.
 *  - The SyncClock provides the initial scheduledStartMs; subsequent chunks are
 *    timed relative to that anchor at multiples of chunkDurationMs.
 *
 * PCM chunk format:
 *   header: 4 bytes magic | 8 bytes scheduledPlayAt (epoch ms, BigInt LE) |
 *            4 bytes sequenceNumber | 4 bytes chunkDurationMs | 4 bytes sampleRate |
 *            1 byte channels | payload (PCM samples, 16-bit LE interleaved)
 *   Total header: 25 bytes
 *
 * This module is unit-testable without an actual audio stream — the timing and
 * framing logic is pure computation over the SyncClock.
 */

import { EventEmitter } from "node:events";
import type { Zone, SyncClock } from "../contracts/index.js";
import type { SyncClockEngine } from "./SyncClock.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Chunk format constants
// ---------------------------------------------------------------------------

/** 4-byte magic: "YPCM" (0x59 0x50 0x43 0x4D) */
export const PCM_CHUNK_MAGIC = Buffer.from("YPCM");

/** Size of the PCM chunk header in bytes. */
export const PCM_HEADER_SIZE = 25; // 4 + 8 + 4 + 4 + 4 + 1

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata for one scheduled PCM chunk. */
export interface PcmChunkMeta {
  /** Monotonically increasing, per-zone sequence number. */
  sequenceNumber: number;
  /** Server epoch ms at which clients must begin playback of this chunk. */
  scheduledPlayAt: number;
  /** Duration of the audio in this chunk in ms. */
  chunkDurationMs: number;
  /** PCM sample rate in Hz (e.g. 48000). */
  sampleRate: number;
  /** Number of audio channels (1 = mono, 2 = stereo). */
  channels: number;
  /** Byte size of the payload (PCM samples). */
  payloadBytes: number;
}

/** A complete framed PCM chunk ready for TCP delivery. */
export interface PcmChunk {
  meta: PcmChunkMeta;
  /** Full framed buffer (header + PCM payload). */
  frame: Buffer;
}

/**
 * A writable sink that receives framed PCM chunks for delivery.
 * Implementations write to TCP connections (one per room), a pipe, or a
 * test buffer. Unit tests inject a capturing sink.
 */
export interface PcmChunkSink {
  /**
   * Called for each chunk destined for a specific zone.
   * @param zoneId  Target zone
   * @param chunk   Framed chunk
   */
  write(zoneId: string, chunk: PcmChunk): void | Promise<void>;
}

/** Scheduler configuration. */
export interface StreamSchedulerOptions {
  /** Nominal chunk size in ms (default: 40 ms → 25 fps). */
  chunkDurationMs?: number;
  /** PCM sample rate (default: 48000 Hz). */
  sampleRate?: number;
  /** Channel count (default: 2 stereo). */
  channels?: number;
  /** Bytes per sample (default: 2 for 16-bit PCM). */
  bytesPerSample?: number;
}

// ---------------------------------------------------------------------------
// Helper: build a framed PCM chunk header
// ---------------------------------------------------------------------------

/**
 * Encode the PCM chunk header into a Buffer.
 *
 * Layout (25 bytes):
 *  [0..3]   magic       "YPCM"
 *  [4..11]  scheduledPlayAt (epoch ms) as BigInt64LE
 *  [12..15] sequenceNumber (UInt32LE)
 *  [16..19] chunkDurationMs (UInt32LE)
 *  [20..23] sampleRate (UInt32LE)
 *  [24]     channels (UInt8)
 */
export function encodePcmHeader(meta: PcmChunkMeta): Buffer {
  const buf = Buffer.alloc(PCM_HEADER_SIZE);
  PCM_CHUNK_MAGIC.copy(buf, 0);
  buf.writeBigInt64LE(BigInt(meta.scheduledPlayAt), 4);
  buf.writeUInt32LE(meta.sequenceNumber, 12);
  buf.writeUInt32LE(meta.chunkDurationMs, 16);
  buf.writeUInt32LE(meta.sampleRate, 20);
  buf.writeUInt8(meta.channels, 24);
  return buf;
}

/**
 * Decode a PCM chunk header from a Buffer.
 * Returns null if the magic bytes don't match.
 */
export function decodePcmHeader(buf: Buffer): Omit<PcmChunkMeta, "payloadBytes"> | null {
  if (buf.length < PCM_HEADER_SIZE) return null;
  if (buf.slice(0, 4).toString("ascii") !== "YPCM") return null;

  return {
    scheduledPlayAt: Number(buf.readBigInt64LE(4)),
    sequenceNumber: buf.readUInt32LE(12),
    chunkDurationMs: buf.readUInt32LE(16),
    sampleRate: buf.readUInt32LE(20),
    channels: buf.readUInt8(24),
  };
}

/**
 * Frame a raw PCM payload buffer with a chunk header.
 */
export function framePcmChunk(meta: PcmChunkMeta, payload: Buffer): PcmChunk {
  const header = encodePcmHeader(meta);
  const frame = Buffer.concat([header, payload]);
  return { meta, frame };
}

// ---------------------------------------------------------------------------
// ChunkTimer: pure timing logic
// ---------------------------------------------------------------------------

/**
 * Computes the per-chunk scheduled play times for a sync group.
 *
 * Given a SyncClock (from SyncClockEngine.makeSyncClock), this produces a
 * sequence of wall-clock play timestamps:
 *   chunk[0].scheduledPlayAt = clock.scheduledStartMs
 *   chunk[N].scheduledPlayAt = clock.scheduledStartMs + N * chunkDurationMs
 *
 * This is pure math — no I/O, fully unit-testable.
 */
export class ChunkTimer {
  private sequenceNumber = 0;
  private anchorMs: number;

  constructor(
    private readonly chunkDurationMs: number,
    syncClock: SyncClock
  ) {
    this.anchorMs = syncClock.scheduledStartMs;
  }

  /**
   * Compute the scheduled play time for the next chunk and advance the
   * internal sequence counter.
   */
  nextChunkTime(): { sequenceNumber: number; scheduledPlayAt: number } {
    const seq = this.sequenceNumber++;
    const scheduledPlayAt = this.anchorMs + seq * this.chunkDurationMs;
    return { sequenceNumber: seq, scheduledPlayAt };
  }

  /**
   * Re-anchor the timer (e.g. after seek or sync resync).
   * Resets sequence to 0 from the new anchor.
   */
  reanchor(syncClock: SyncClock): void {
    this.anchorMs = syncClock.scheduledStartMs;
    this.sequenceNumber = 0;
  }

  /**
   * Returns the server wall-clock ms when the Nth chunk should be delivered
   * to a client with the given one-way latency, so it arrives `bufferMs` before
   * its scheduled play time.
   *
   *   deliverBy = scheduledPlayAt - bufferMs - oneWayLatencyMs
   *
   * If deliverBy is in the past, the chunk should be sent immediately.
   */
  static deliverByMs(
    scheduledPlayAt: number,
    bufferMs: number,
    oneWayLatencyMs: number
  ): number {
    return scheduledPlayAt - bufferMs - oneWayLatencyMs;
  }
}

// ---------------------------------------------------------------------------
// StreamScheduler
// ---------------------------------------------------------------------------

/**
 * Manages per-zone chunk scheduling for synchronized PCM delivery.
 *
 * Usage:
 *  1. Call `startZone(zone, syncClock)` when a zone begins synced playback.
 *  2. Feed raw PCM buffers via `scheduleChunk(zoneId, pcmPayload)`.
 *  3. The scheduler frames each chunk with timing metadata and calls sink.write().
 *  4. On seek/resync, call `reanchorZone(zoneId, newClock)`.
 *  5. Call `stopZone(zoneId)` when the zone stops.
 */
export class StreamScheduler extends EventEmitter {
  private readonly timers = new Map<string, ChunkTimer>();

  constructor(
    private readonly clockEngine: SyncClockEngine,
    private readonly sink: PcmChunkSink,
    private readonly opts: Required<StreamSchedulerOptions>
  ) {
    super();
  }

  // ── Factory ───────────────────────────────────────────────────────────────

  static create(
    clockEngine: SyncClockEngine,
    sink: PcmChunkSink,
    opts: StreamSchedulerOptions = {}
  ): StreamScheduler {
    const resolved: Required<StreamSchedulerOptions> = {
      chunkDurationMs: opts.chunkDurationMs ?? 40,
      sampleRate: opts.sampleRate ?? 48000,
      channels: opts.channels ?? 2,
      bytesPerSample: opts.bytesPerSample ?? 2,
    };
    return new StreamScheduler(clockEngine, sink, resolved);
  }

  // ── Zone lifecycle ────────────────────────────────────────────────────────

  /**
   * Start scheduling for a zone.
   * @param zone       The zone (for zoneId).
   * @param syncClock  The SyncClock produced by SyncClockEngine.makeSyncClock().
   */
  startZone(zone: Zone, syncClock: SyncClock): void {
    const timer = new ChunkTimer(this.opts.chunkDurationMs, syncClock);
    this.timers.set(zone.zoneId, timer);
    logger.debug(
      {
        zoneId: zone.zoneId,
        scheduledStartMs: syncClock.scheduledStartMs,
        bufferMs: syncClock.bufferMs,
      },
      "StreamScheduler: zone started"
    );
    this.emit("zone:started", zone.zoneId, syncClock);
  }

  /** Re-anchor a zone's timer after seek or resync. */
  reanchorZone(zoneId: string, syncClock: SyncClock): void {
    const timer = this.timers.get(zoneId);
    if (timer) {
      timer.reanchor(syncClock);
      logger.debug({ zoneId, scheduledStartMs: syncClock.scheduledStartMs }, "StreamScheduler: zone reanchored");
    }
    this.emit("zone:reanchored", zoneId, syncClock);
  }

  /** Stop scheduling for a zone. */
  stopZone(zoneId: string): void {
    this.timers.delete(zoneId);
    this.clockEngine.clearZone(zoneId);
    logger.debug({ zoneId }, "StreamScheduler: zone stopped");
    this.emit("zone:stopped", zoneId);
  }

  // ── Chunk scheduling ──────────────────────────────────────────────────────

  /**
   * Schedule a PCM payload chunk for delivery to a zone.
   *
   * The scheduler:
   *  1. Gets the next chunk timing from the zone's ChunkTimer.
   *  2. Frames the chunk with header + payload.
   *  3. Computes each room's deliver-by time using per-room latency from
   *     SyncClockEngine.
   *  4. Calls sink.write() with the framed chunk.
   *
   * @param zoneId   Target zone.
   * @param payload  Raw 16-bit LE PCM samples (interleaved if stereo).
   */
  async scheduleChunk(zoneId: string, payload: Buffer): Promise<void> {
    const timer = this.timers.get(zoneId);
    if (!timer) {
      logger.warn({ zoneId }, "scheduleChunk: no timer for zone, ignoring");
      return;
    }

    const timing = timer.nextChunkTime();

    const meta: PcmChunkMeta = {
      sequenceNumber: timing.sequenceNumber,
      scheduledPlayAt: timing.scheduledPlayAt,
      chunkDurationMs: this.opts.chunkDurationMs,
      sampleRate: this.opts.sampleRate,
      channels: this.opts.channels,
      payloadBytes: payload.length,
    };

    const chunk = framePcmChunk(meta, payload);

    try {
      await this.sink.write(zoneId, chunk);
    } catch (err) {
      logger.error({ zoneId, seq: meta.sequenceNumber, err }, "Chunk delivery error");
    }

    this.emit("chunk:scheduled", zoneId, meta);
  }

  /**
   * Compute the PCM payload size for one nominal chunk duration.
   * Useful for sizing read buffers from the ffmpeg output pipe.
   *
   *   bytes = (chunkDurationMs / 1000) * sampleRate * channels * bytesPerSample
   */
  get nominalChunkBytes(): number {
    return Math.floor(
      (this.opts.chunkDurationMs / 1000) *
        this.opts.sampleRate *
        this.opts.channels *
        this.opts.bytesPerSample
    );
  }

  /**
   * Returns per-client deliver-by times for the given chunk's scheduledPlayAt,
   * using the SyncClockEngine's per-room latency measurements.
   *
   * Clients that should receive the chunk immediately (deliverBy in the past)
   * get deliverBy = Date.now() to indicate "send now".
   */
  getDeliverByTimes(
    zoneId: string,
    scheduledPlayAt: number,
    bufferMs: number
  ): Array<{ roomId: string; deliverBy: number }> {
    const now = Date.now();
    const states = this.clockEngine.getZoneClockStates(zoneId);
    return states.map((s) => {
      const deliverBy = ChunkTimer.deliverByMs(
        scheduledPlayAt,
        bufferMs,
        s.oneWayLatencyMs
      );
      return { roomId: s.roomId, deliverBy: Math.max(deliverBy, now) };
    });
  }
}
