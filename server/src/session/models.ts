/**
 * YouTopia Server — Pod D: Session / Room / Zone concrete models.
 *
 * Provides factories and concrete classes/factories for User, Session, Room,
 * and Zone, implementing the contract shapes from session.ts.
 *
 * Design decisions (Pod D):
 *  - Session: owns queue + Transport + DSP chain handle (contract DspChain ref).
 *    Two users → two Sessions, independent transport state.
 *  - Room: physical output endpoint; negotiates TransportKind + OutputCodec on
 *    connect. Belongs to at most one Zone.
 *  - Zone: sync group of Rooms sharing one Session; carries a SyncClock.
 *  - All IDs are crypto.randomUUID() for global uniqueness.
 */

import crypto from "node:crypto";
import type {
  User,
  Session,
  Room,
  Zone,
  SyncClock,
  QueueItem,
  Transport,
} from "../contracts/index.js";
import {
  PlaybackState,
  RepeatMode,
  ClientKind,
  TransportKind,
  OutputCodec,
} from "../contracts/index.js";

// ---------------------------------------------------------------------------
// Default transport state
// ---------------------------------------------------------------------------

/**
 * Returns a fresh, idle Transport snapshot. Used when creating a new Session.
 */
export function makeDefaultTransport(): Transport {
  return {
    state: PlaybackState.Idle,
    currentIndex: -1,
    positionSeconds: 0,
    volume: 1.0,
    muted: false,
    repeat: RepeatMode.Off,
    shuffle: false,
  };
}

// ---------------------------------------------------------------------------
// Default SyncClock
// ---------------------------------------------------------------------------

/** Returns a zero-state SyncClock anchored to the current server time. */
export function makeDefaultSyncClock(bufferMs = 300): SyncClock {
  const now = Date.now();
  return {
    serverEpochMs: now,
    bufferMs,
    scheduledStartMs: now + bufferMs,
  };
}

// ---------------------------------------------------------------------------
// User factory
// ---------------------------------------------------------------------------

/**
 * Creates a User object from the configured user data.
 * Pod A stores the canonical user list in config; this just shapes the
 * contract type from those values.
 */
export function makeUser(userId: string, displayName: string): User {
  return { userId, displayName };
}

// ---------------------------------------------------------------------------
// Session factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Session owned by `userId`.
 * Starts idle with an empty queue and no Zone binding.
 * The dsp[] array starts empty — Pod C will attach a DspChain later;
 * we store the snapshot form (DspNodeState[]) from the contract.
 */
export function makeSession(userId: string): Session {
  return {
    sessionId: crypto.randomUUID(),
    userId,
    transport: makeDefaultTransport(),
    queue: [] as QueueItem[],
    dsp: [],
    zoneId: null,
  };
}

/**
 * Clones a Session's transport state (immutable snapshot helper).
 */
export function cloneTransport(t: Transport): Transport {
  return { ...t };
}

// ---------------------------------------------------------------------------
// Room factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Room (physical output endpoint).
 * Default transport: HTTP progressive (low-delay Opus) per ADR-0005.
 */
export function makeRoom(
  displayName: string,
  client: ClientKind = ClientKind.Web,
  transport: TransportKind = TransportKind.HttpProgressive,
  codec: OutputCodec = OutputCodec.Opus
): Room {
  return {
    roomId: crypto.randomUUID(),
    displayName,
    client,
    transport,
    codec,
    outputVolume: 1.0,
    zoneId: null,
    online: false,
  };
}

// ---------------------------------------------------------------------------
// Zone factory
// ---------------------------------------------------------------------------

/**
 * Creates a new Zone (sync group).
 * Starts with an empty roomIds list, no bound session, and a fresh SyncClock.
 */
export function makeZone(displayName: string, bufferMs = 300): Zone {
  return {
    zoneId: crypto.randomUUID(),
    displayName,
    roomIds: [],
    sessionId: null,
    clock: makeDefaultSyncClock(bufferMs),
  };
}
