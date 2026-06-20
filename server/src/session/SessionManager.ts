/**
 * YouTopia Server — Pod D: SessionManager.
 *
 * Manages the lifecycle of per-user Sessions. Two users → two independent
 * Sessions, each with its own Transport, queue, and DSP chain handle.
 *
 * Responsibilities:
 *  - create/get/destroy sessions per userId
 *  - apply TransportCommand to a session's Transport
 *  - queue mutations (add / reorder)
 *  - DSP chain snapshot store (Pod C fills in the real chain)
 *  - emit change events so RoomManager / socket handlers can broadcast
 *
 * Thread safety: Node.js is single-threaded; no locking needed.
 */

import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  Session,
  QueueItem,
  Transport,
  NowPlaying,
} from "../contracts/index.js";
import type { TransportCommand, QueueAddCommand } from "../contracts/index.js";
import {
  PlaybackState,
  RepeatMode,
} from "../contracts/index.js";
import { makeSession, cloneTransport } from "./models.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Local event types (not in contracts — Pod D private bus)
// ---------------------------------------------------------------------------

/**
 * Events emitted by SessionManager for downstream subscribers
 * (RoomManager, socket handlers).
 */
export interface SessionManagerEvents {
  /** Fired whenever a session's transport or queue changes. */
  "session:updated": [session: Session];
  /** Fired when a new session is created. */
  "session:created": [session: Session];
  /** Fired when a session is destroyed. */
  "session:destroyed": [sessionId: string];
}

// ---------------------------------------------------------------------------
// SessionManager class
// ---------------------------------------------------------------------------

export class SessionManager extends EventEmitter {
  /** sessionId → mutable Session record */
  private readonly sessions = new Map<string, Session>();

  /** userId → Set<sessionId>: one user may have multiple sessions */
  private readonly userSessions = new Map<string, Set<string>>();

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Create a new Session for the given user.
   * A user can own multiple sessions (e.g. different rooms with different
   * programs), but the primary use-case is one session per user login.
   */
  createSession(userId: string): Session {
    const session = makeSession(userId);
    this.sessions.set(session.sessionId, session);

    let userSet = this.userSessions.get(userId);
    if (!userSet) {
      userSet = new Set<string>();
      this.userSessions.set(userId, userSet);
    }
    userSet.add(session.sessionId);

    logger.debug({ sessionId: session.sessionId, userId }, "Session created");
    this.emit("session:created", session);
    return session;
  }

  /** Returns the session or undefined if it does not exist. */
  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  /** Returns all sessions owned by a userId. */
  getSessionsForUser(userId: string): Session[] {
    const ids = this.userSessions.get(userId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.sessions.get(id))
      .filter((s): s is Session => s !== undefined);
  }

  /** Returns all active sessions. */
  listSessions(): Session[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Destroy a session and remove all references.
   * If the session is bound to a Zone, callers should unbind it first via
   * RoomManager to avoid orphaned zone references.
   */
  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.sessions.delete(sessionId);
    const userSet = this.userSessions.get(session.userId);
    if (userSet) {
      userSet.delete(sessionId);
      if (userSet.size === 0) this.userSessions.delete(session.userId);
    }

    logger.debug({ sessionId, userId: session.userId }, "Session destroyed");
    this.emit("session:destroyed", sessionId);
    return true;
  }

  // ── Transport commands ────────────────────────────────────────────────────

  /**
   * Apply a TransportCommand to the session identified by sessionId.
   * Returns the updated Transport snapshot, or null if session not found.
   *
   * Commands:
   *   play / pause / next / previous / seek / setVolume / setMuted /
   *   setRepeat / setShuffle
   */
  applyTransportCommand(
    sessionId: string,
    cmd: TransportCommand
  ): Transport | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const t = session.transport;

    switch (cmd.op) {
      case "play": {
        if (session.queue.length > 0) {
          if (t.currentIndex < 0) t.currentIndex = 0;
          t.state = PlaybackState.Playing;
        }
        break;
      }
      case "pause": {
        if (t.state === PlaybackState.Playing) {
          t.state = PlaybackState.Paused;
        }
        break;
      }
      case "next": {
        const nextIdx = this._advanceIndex(session, 1);
        if (nextIdx !== null) {
          t.currentIndex = nextIdx;
          t.positionSeconds = 0;
          t.state = PlaybackState.Playing;
        }
        break;
      }
      case "previous": {
        // If more than 3 s in, seek to start; otherwise go to previous track
        if (t.positionSeconds > 3) {
          t.positionSeconds = 0;
        } else {
          const prevIdx = this._advanceIndex(session, -1);
          if (prevIdx !== null) {
            t.currentIndex = prevIdx;
            t.positionSeconds = 0;
            t.state = PlaybackState.Playing;
          }
        }
        break;
      }
      case "seek": {
        const pos = Math.max(0, cmd.positionSeconds);
        t.positionSeconds = pos;
        break;
      }
      case "setVolume": {
        t.volume = Math.min(1, Math.max(0, cmd.volume));
        break;
      }
      case "setMuted": {
        t.muted = cmd.muted;
        break;
      }
      case "setRepeat": {
        t.repeat = cmd.repeat;
        break;
      }
      case "setShuffle": {
        t.shuffle = cmd.shuffle;
        break;
      }
    }

    this.emit("session:updated", session);
    return cloneTransport(t);
  }

  // ── Queue mutations ────────────────────────────────────────────────────────

  /**
   * Add tracks to the queue per QueueAddCommand.
   * - "last": append to end
   * - "next": insert after currentIndex
   * - "now": insert after current and immediately play
   */
  applyQueueAdd(
    sessionId: string,
    cmd: QueueAddCommand,
    trackResolver: (trackId: string) => QueueItem["track"] | undefined
  ): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const newItems: QueueItem[] = [];
    for (const trackId of cmd.trackIds) {
      const track = trackResolver(trackId);
      if (!track) continue;
      newItems.push({
        itemId: crypto.randomUUID() as string,
        trackId,
        track,
      });
    }

    if (newItems.length === 0) return session;

    const t = session.transport;

    switch (cmd.mode) {
      case "last": {
        session.queue.push(...newItems);
        break;
      }
      case "next": {
        const insertAt =
          t.currentIndex >= 0 ? t.currentIndex + 1 : session.queue.length;
        session.queue.splice(insertAt, 0, ...newItems);
        break;
      }
      case "now": {
        const insertAt =
          t.currentIndex >= 0 ? t.currentIndex + 1 : 0;
        session.queue.splice(insertAt, 0, ...newItems);
        t.currentIndex = insertAt;
        t.positionSeconds = 0;
        t.state = PlaybackState.Playing;
        break;
      }
    }

    this.emit("session:updated", session);
    return session;
  }

  /**
   * Reorder queue by providing a new ordered array of itemIds.
   * Silently drops any ids not found in the current queue.
   */
  reorderQueue(sessionId: string, orderedItemIds: string[]): Session | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const itemMap = new Map(session.queue.map((item) => [item.itemId, item]));
    const currentItemId =
      session.transport.currentIndex >= 0
        ? (session.queue[session.transport.currentIndex]?.itemId ?? null)
        : null;

    const reordered = orderedItemIds
      .map((id) => itemMap.get(id))
      .filter((item): item is QueueItem => item !== undefined);

    session.queue = reordered;

    // Recompute currentIndex after reorder
    if (currentItemId !== null) {
      const newIdx = reordered.findIndex((i) => i.itemId === currentItemId);
      session.transport.currentIndex = newIdx >= 0 ? newIdx : -1;
    }

    this.emit("session:updated", session);
    return session;
  }

  // ── DSP snapshot ───────────────────────────────────────────────────────────

  /**
   * Update the DSP snapshot on the session (called by Pod C after applying
   * patches). Pod D stores the serializable DspNodeState[] form.
   */
  updateDspSnapshot(
    sessionId: string,
    dsp: Session["dsp"]
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.dsp = dsp;
    this.emit("session:updated", session);
    return true;
  }

  // ── NowPlaying snapshot ────────────────────────────────────────────────────

  /**
   * Build a NowPlaying snapshot for the given session.
   * enrichment + beat are injected from Pod C — callers pass null stubs here
   * until the enrichment pipeline is wired.
   */
  getNowPlaying(sessionId: string): NowPlaying | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const current =
      session.transport.currentIndex >= 0
        ? (session.queue[session.transport.currentIndex] ?? null)
        : null;

    return {
      sessionId: session.sessionId,
      transport: cloneTransport(session.transport),
      current,
      enrichment: null,
      beat: null,
    };
  }

  // ── Zone binding ───────────────────────────────────────────────────────────

  /** Called by RoomManager when it binds a zone to a session. */
  setZoneBinding(sessionId: string, zoneId: string | null): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.zoneId = zoneId;
    this.emit("session:updated", session);
    return true;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Advance the current queue index by `delta` (±1), respecting repeat mode
   * and shuffle. Returns the new index, or null if movement is not possible.
   */
  private _advanceIndex(
    session: Session,
    delta: 1 | -1
  ): number | null {
    const q = session.queue;
    if (q.length === 0) return null;

    const t = session.transport;
    const current = t.currentIndex < 0 ? 0 : t.currentIndex;

    // Shuffle: pick a random track (not the current one)
    if (t.shuffle && delta === 1 && q.length > 1) {
      let idx: number;
      do {
        idx = Math.floor(Math.random() * q.length);
      } while (idx === current);
      return idx;
    }

    const next = current + delta;

    // Repeat modes
    if (t.repeat === RepeatMode.One) {
      return current; // stay on same track
    }
    if (t.repeat === RepeatMode.All) {
      return ((next % q.length) + q.length) % q.length;
    }

    // RepeatMode.Off
    if (next < 0 || next >= q.length) return null;
    return next;
  }
}
