/**
 * YouTopia Server — Pod D: SyncClock implementation.
 *
 * Server-authoritative monotonic sync clock for multi-room playback.
 * Implements the snapcast-style NTP-offset + global buffer + scheduled start
 * model from ADR-0004:
 *
 *  1. Server maintains a monotonic epoch anchor (serverEpochMs).
 *  2. Clients run a periodic NTP-style 4-timestamp exchange:
 *       T0: client sends timestamp (clientSendMs)
 *       T1: server records receive time
 *       T2: server sends reply (serverSendMs, included in reply)
 *       T3: client records receive time
 *     offset = ((T1-T0) + (T2-T3)) / 2
 *     rtt    = (T3-T0) - (T2-T1)
 *  3. Server ingests ClientClockReports, tracks per-room offset/latency.
 *  4. When scheduling a new segment start, the server picks a wall-clock time
 *     (scheduledStartMs) at least bufferMs in the future, accounting for the
 *     worst-case client offset so all rooms arrive with non-negative wait time.
 *  5. ClockAnchor is re-broadcast periodically or on transport changes.
 *
 * Per-zone SyncClock is stored on the Zone contract and re-exported to clients
 * via the "clock" socket.io event (SERVER_EVENTS.clock).
 */

import { EventEmitter } from "node:events";
import type { SyncClock, ClientClockReport } from "../contracts/index.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Local types (not in public contracts)
// ---------------------------------------------------------------------------

/**
 * Server-side record of a client's measured clock characteristics.
 * Maintained per room-id; updated on each ClientClockReport.
 */
export interface ClientClockState {
  roomId: string;
  /** Estimated (clientClock - serverClock) in ms. */
  offsetMs: number;
  /** Round-trip time in ms. */
  rttMs: number;
  /** One-way latency estimate (rtt/2). */
  oneWayLatencyMs: number;
  /** Epoch ms of the most recent report. */
  reportedAt: number;
  /** How many samples we have accumulated (for averaging). */
  sampleCount: number;
  /** Rolling exponential-moving-average coefficient (α). */
  readonly alpha: number;
}

/**
 * Internal NTP exchange record — server side.
 * The client sends T0; server stamps T1 on receipt. When we send back the
 * response we include T2 (= Date.now() at send time); client closes the loop
 * with T3.
 *
 * For our purposes, the server ingest path receives all four values pre-computed:
 *  offsetMs = ((T1 - T0) + (T2 - T3)) / 2
 *  rttMs    = (T3 - T0) - (T2 - T1)
 * This matches RFC 5905 section 8 (SNTP) / snapcast convention.
 */
export interface NtpExchange {
  t0: number; // client send
  t1: number; // server receive
  t2: number; // server send (reply)
  t3: number; // client receive
}

// ---------------------------------------------------------------------------
// SyncClockEngine
// ---------------------------------------------------------------------------

export class SyncClockEngine extends EventEmitter {
  /** Per-room clock state; zoneId → roomId → ClientClockState */
  private readonly zoneClocks = new Map<string, Map<string, ClientClockState>>();

  /** Default global playout buffer — all rooms honor this before starting. */
  readonly defaultBufferMs: number;

  /** EMA smoothing coefficient for offset/rtt (0 < α ≤ 1). */
  private readonly alpha: number;

  constructor(opts: { defaultBufferMs?: number; alpha?: number } = {}) {
    super();
    this.defaultBufferMs = opts.defaultBufferMs ?? 300;
    this.alpha = opts.alpha ?? 0.125; // same weight as Linux TCP RTT smoother
  }

  // ── NTP offset math (static utility) ─────────────────────────────────────

  /**
   * Compute the client's clock offset and round-trip time from an NTP-style
   * 4-timestamp exchange.
   *
   * Per RFC 5905 / snapcast convention:
   *   offset = ((T1 - T0) + (T2 - T3)) / 2
   *   rtt    = (T3 - T0) - (T2 - T1)
   *
   * A positive offset means the client clock is ahead of the server.
   * A negative offset means the client clock is behind the server.
   */
  static computeOffset(ex: NtpExchange): { offsetMs: number; rttMs: number } {
    const offsetMs = ((ex.t1 - ex.t0) + (ex.t2 - ex.t3)) / 2;
    const rttMs = (ex.t3 - ex.t0) - (ex.t2 - ex.t1);
    return { offsetMs, rttMs };
  }

  // ── ClientClockReport ingest ──────────────────────────────────────────────

  /**
   * Ingest a ClientClockReport for a room within a zone.
   * Applies exponential moving average to smooth noisy measurements.
   * Emits "clock:report" for downstream consumers (e.g. StreamScheduler).
   */
  ingestReport(zoneId: string, report: ClientClockReport): ClientClockState {
    let zoneMap = this.zoneClocks.get(zoneId);
    if (!zoneMap) {
      zoneMap = new Map<string, ClientClockState>();
      this.zoneClocks.set(zoneId, zoneMap);
    }

    const existing = zoneMap.get(report.roomId);
    let state: ClientClockState;

    if (!existing) {
      // First sample — seed directly
      state = {
        roomId: report.roomId,
        offsetMs: report.offsetMs,
        rttMs: report.rttMs,
        oneWayLatencyMs: report.rttMs / 2,
        reportedAt: report.reportedAt,
        sampleCount: 1,
        alpha: this.alpha,
      };
    } else {
      // EMA update:
      //   smoothed = alpha * sample + (1 - alpha) * smoothed
      const α = this.alpha;
      state = {
        ...existing,
        offsetMs: α * report.offsetMs + (1 - α) * existing.offsetMs,
        rttMs: α * report.rttMs + (1 - α) * existing.rttMs,
        oneWayLatencyMs:
          α * (report.rttMs / 2) + (1 - α) * existing.oneWayLatencyMs,
        reportedAt: report.reportedAt,
        sampleCount: existing.sampleCount + 1,
      };
    }

    zoneMap.set(report.roomId, state);

    logger.debug(
      {
        zoneId,
        roomId: report.roomId,
        offsetMs: state.offsetMs.toFixed(2),
        rttMs: state.rttMs.toFixed(2),
        sampleCount: state.sampleCount,
      },
      "Clock report ingested"
    );

    this.emit("clock:report", zoneId, state);
    return state;
  }

  /**
   * Returns all per-room clock states for a zone.
   */
  getZoneClockStates(zoneId: string): ClientClockState[] {
    const zoneMap = this.zoneClocks.get(zoneId);
    if (!zoneMap) return [];
    return Array.from(zoneMap.values());
  }

  /**
   * Returns the worst-case (maximum) offset magnitude across all rooms in a
   * zone, used to pad the scheduled start time.
   */
  getWorstCaseOffsetMs(zoneId: string): number {
    const states = this.getZoneClockStates(zoneId);
    if (states.length === 0) return 0;
    return Math.max(...states.map((s) => Math.abs(s.offsetMs)));
  }

  /**
   * Returns the worst-case one-way latency across all rooms in a zone.
   */
  getWorstCaseLatencyMs(zoneId: string): number {
    const states = this.getZoneClockStates(zoneId);
    if (states.length === 0) return 0;
    return Math.max(...states.map((s) => s.oneWayLatencyMs));
  }

  // ── SyncClock production ──────────────────────────────────────────────────

  /**
   * Produce a SyncClock for a zone.
   *
   * The scheduled start time is:
   *   scheduledStartMs = serverEpochMs + bufferMs + worstCaseLatency + safetyMs
   *
   * This guarantees that even the slowest room (highest latency / furthest
   * offset) will receive the audio chunk before it must start playing, as long
   * as jitter doesn't exceed bufferMs (the same constraint as snapcast).
   *
   * @param zoneId  The zone to schedule for.
   * @param bufferMs  Override the default buffer (e.g. on seek/resync).
   * @param safetyMs  Additional padding on top of buffer+latency (default 20ms).
   */
  makeSyncClock(
    zoneId: string,
    bufferMs?: number,
    safetyMs = 20
  ): SyncClock {
    const now = Date.now();
    const buf = bufferMs ?? this.defaultBufferMs;
    const worstLatency = this.getWorstCaseLatencyMs(zoneId);

    const scheduledStartMs = now + buf + worstLatency + safetyMs;

    return {
      serverEpochMs: now,
      bufferMs: buf,
      scheduledStartMs,
    };
  }

  /**
   * Re-anchor a zone's SyncClock (e.g. after seek, track change, or resync).
   * Returns the new SyncClock for broadcast via the "clock" socket event.
   */
  reanchor(zoneId: string, bufferMs?: number): SyncClock {
    const clock = this.makeSyncClock(zoneId, bufferMs);
    logger.debug(
      {
        zoneId,
        scheduledStartMs: clock.scheduledStartMs,
        bufferMs: clock.bufferMs,
        worstLatency: this.getWorstCaseLatencyMs(zoneId).toFixed(1),
      },
      "SyncClock reanchored"
    );
    this.emit("clock:anchor", zoneId, clock);
    return clock;
  }

  /**
   * Check if a room is within the bufferMs tolerance of the zone clock.
   * A room is considered drifted if its measured offset exceeds bufferMs.
   */
  isDrifted(zoneId: string, roomId: string, bufferMs?: number): boolean {
    const zoneMap = this.zoneClocks.get(zoneId);
    if (!zoneMap) return false;
    const state = zoneMap.get(roomId);
    if (!state) return false;
    const buf = bufferMs ?? this.defaultBufferMs;
    return Math.abs(state.offsetMs) > buf;
  }

  /**
   * Remove clock state for a zone (e.g. when zone is deleted).
   */
  clearZone(zoneId: string): void {
    this.zoneClocks.delete(zoneId);
  }

  /**
   * Remove a single room's clock state from a zone.
   */
  clearRoom(zoneId: string, roomId: string): void {
    this.zoneClocks.get(zoneId)?.delete(roomId);
  }
}
