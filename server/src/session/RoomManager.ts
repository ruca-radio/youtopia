/**
 * YouTopia Server — Pod D: RoomManager.
 *
 * Manages Rooms and Zones (sync groups):
 *  - CRUD for Rooms and Zones
 *  - Assign/unassign rooms to zones (group/ungroup)
 *  - Bind a Zone to a Session for synchronized playback
 *  - Track which socket clients are bound to which room
 *  - Emit RoomEvent / ZoneEvent for socket broadcast
 *
 * Zone membership rules:
 *  - A Room belongs to at most one Zone.
 *  - An ungrouped room has zoneId = null and its own independent session.
 *  - Grouped rooms share the Zone's bound session.
 *
 * Design for N zones, initial milestone: 2 zones (Patrick + spouse rooms).
 */

import { EventEmitter } from "node:events";
import type {
  Room,
  Zone,
  Session,
} from "../contracts/index.js";
import {
  ClientKind,
  TransportKind,
  OutputCodec,
} from "../contracts/index.js";
import { makeRoom, makeZone, makeDefaultSyncClock } from "./models.js";
import type { SessionManager } from "./SessionManager.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface CreateRoomOptions {
  displayName: string;
  client?: ClientKind;
  transport?: TransportKind;
  codec?: OutputCodec;
}

export interface CreateZoneOptions {
  displayName: string;
  bufferMs?: number;
}

// ---------------------------------------------------------------------------
// RoomManager events
// ---------------------------------------------------------------------------

export interface RoomManagerEvents {
  "room:updated": [room: Room];
  "room:created": [room: Room];
  "room:removed": [roomId: string];
  "zone:updated": [zone: Zone];
  "zone:created": [zone: Zone];
  "zone:removed": [zoneId: string];
}

// ---------------------------------------------------------------------------
// RoomManager class
// ---------------------------------------------------------------------------

export class RoomManager extends EventEmitter {
  private readonly rooms = new Map<string, Room>();
  private readonly zones = new Map<string, Zone>();

  /**
   * socketId → roomId: which client socket is bound to which room.
   * Populated by the socket connection handler.
   */
  private readonly socketToRoom = new Map<string, string>();
  /** roomId → Set<socketId>: reverse index */
  private readonly roomToSockets = new Map<string, Set<string>>();

  constructor(private readonly sessionManager: SessionManager) {
    super();
  }

  // ── Room CRUD ─────────────────────────────────────────────────────────────

  createRoom(opts: CreateRoomOptions): Room {
    const room = makeRoom(
      opts.displayName,
      opts.client ?? ClientKind.Web,
      opts.transport ?? TransportKind.HttpProgressive,
      opts.codec ?? OutputCodec.Opus
    );
    this.rooms.set(room.roomId, room);
    logger.debug({ roomId: room.roomId, displayName: room.displayName }, "Room created");
    this.emit("room:created", room);
    return room;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  listRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  removeRoom(roomId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    // Remove from zone if member
    if (room.zoneId) {
      this._removeRoomFromZone(roomId, room.zoneId);
    }

    // Unbind all sockets
    const sockets = this.roomToSockets.get(roomId);
    if (sockets) {
      for (const socketId of sockets) {
        this.socketToRoom.delete(socketId);
      }
      this.roomToSockets.delete(roomId);
    }

    this.rooms.delete(roomId);
    logger.debug({ roomId }, "Room removed");
    this.emit("room:removed", roomId);
    return true;
  }

  /** Mark a room as online/offline when its client connects/disconnects. */
  setRoomOnline(roomId: string, online: boolean): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.online = online;
    this.emit("room:updated", room);
    return true;
  }

  // ── Zone CRUD ─────────────────────────────────────────────────────────────

  createZone(opts: CreateZoneOptions): Zone {
    const zone = makeZone(opts.displayName, opts.bufferMs ?? 300);
    this.zones.set(zone.zoneId, zone);
    logger.debug({ zoneId: zone.zoneId, displayName: zone.displayName }, "Zone created");
    this.emit("zone:created", zone);
    return zone;
  }

  getZone(zoneId: string): Zone | undefined {
    return this.zones.get(zoneId);
  }

  listZones(): Zone[] {
    return Array.from(this.zones.values());
  }

  removeZone(zoneId: string): boolean {
    const zone = this.zones.get(zoneId);
    if (!zone) return false;

    // Remove zone membership from all member rooms
    for (const roomId of [...zone.roomIds]) {
      this._removeRoomFromZone(roomId, zoneId);
    }

    // Unbind session
    if (zone.sessionId) {
      this.sessionManager.setZoneBinding(zone.sessionId, null);
    }

    this.zones.delete(zoneId);
    logger.debug({ zoneId }, "Zone removed");
    this.emit("zone:removed", zoneId);
    return true;
  }

  // ── Zone membership management (group/ungroup) ────────────────────────────

  /**
   * Add one or more rooms to a zone (grouping).
   * Rooms are removed from their existing zone first.
   * Zone transport switches to SyncPcm/Pcm automatically.
   * Returns the updated Zone or null on error.
   */
  groupRooms(zoneId: string, roomIds: string[]): Zone | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    for (const roomId of roomIds) {
      const room = this.rooms.get(roomId);
      if (!room) {
        logger.warn({ roomId }, "groupRooms: room not found, skipping");
        continue;
      }

      // If already in another zone, remove it first
      if (room.zoneId && room.zoneId !== zoneId) {
        this._removeRoomFromZone(roomId, room.zoneId);
      }

      if (!zone.roomIds.includes(roomId)) {
        zone.roomIds.push(roomId);
      }
      room.zoneId = zoneId;
      // Sync grouped rooms to PCM transport (ADR-0005)
      room.transport = TransportKind.SyncPcm;
      room.codec = OutputCodec.Pcm;
      this.emit("room:updated", room);
    }

    this.emit("zone:updated", zone);
    logger.debug({ zoneId, roomCount: zone.roomIds.length }, "Rooms grouped into zone");
    return zone;
  }

  /**
   * Remove rooms from a zone (ungrouping).
   * Ungrouped rooms revert to HTTP progressive transport.
   */
  ungroupRooms(zoneId: string, roomIds: string[]): Zone | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    for (const roomId of roomIds) {
      this._removeRoomFromZone(roomId, zoneId);
    }

    this.emit("zone:updated", zone);
    return zone;
  }

  /**
   * Set all rooms in a zone at once (replaces the membership list).
   * Rooms not in the new list are ungrouped; new rooms are added.
   */
  setZoneRooms(zoneId: string, roomIds: string[]): Zone | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    const toRemove = zone.roomIds.filter((id) => !roomIds.includes(id));
    const toAdd = roomIds.filter((id) => !zone.roomIds.includes(id));

    for (const roomId of toRemove) {
      this._removeRoomFromZone(roomId, zoneId);
    }
    if (toAdd.length > 0) {
      this.groupRooms(zoneId, toAdd);
    }

    return zone;
  }

  // ── Zone ↔ Session binding ─────────────────────────────────────────────────

  /**
   * Bind a Zone to a Session, enabling synchronized playback.
   * Returns the updated Zone, or null on error.
   */
  bindZoneToSession(
    zoneId: string,
    sessionId: string
  ): Zone | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;

    const session = this.sessionManager.getSession(sessionId);
    if (!session) return null;

    // Unbind previous session if any
    if (zone.sessionId && zone.sessionId !== sessionId) {
      this.sessionManager.setZoneBinding(zone.sessionId, null);
    }

    zone.sessionId = sessionId;
    // Refresh the sync clock anchor when binding
    zone.clock = makeDefaultSyncClock(zone.clock.bufferMs);
    this.sessionManager.setZoneBinding(sessionId, zoneId);

    this.emit("zone:updated", zone);
    logger.debug({ zoneId, sessionId }, "Zone bound to session");
    return zone;
  }

  /**
   * Unbind a Zone from its current session.
   */
  unbindZoneSession(zoneId: string): Zone | null {
    const zone = this.zones.get(zoneId);
    if (!zone) return null;
    if (zone.sessionId) {
      this.sessionManager.setZoneBinding(zone.sessionId, null);
      zone.sessionId = null;
    }
    this.emit("zone:updated", zone);
    return zone;
  }

  // ── Socket → Room binding ─────────────────────────────────────────────────

  /** Called by the socket connection handler when a client joins a room. */
  bindSocket(socketId: string, roomId: string): void {
    // Remove old binding if any
    const oldRoomId = this.socketToRoom.get(socketId);
    if (oldRoomId) {
      const sockets = this.roomToSockets.get(oldRoomId);
      sockets?.delete(socketId);
    }

    this.socketToRoom.set(socketId, roomId);
    let roomSockets = this.roomToSockets.get(roomId);
    if (!roomSockets) {
      roomSockets = new Set<string>();
      this.roomToSockets.set(roomId, roomSockets);
    }
    roomSockets.add(socketId);
  }

  /** Called when a socket disconnects. */
  unbindSocket(socketId: string): void {
    const roomId = this.socketToRoom.get(socketId);
    if (roomId) {
      const sockets = this.roomToSockets.get(roomId);
      sockets?.delete(socketId);
      if (sockets?.size === 0) {
        this.roomToSockets.delete(roomId);
        // Mark room offline if no sockets remain
        const room = this.rooms.get(roomId);
        if (room) {
          room.online = false;
          this.emit("room:updated", room);
        }
      }
    }
    this.socketToRoom.delete(socketId);
  }

  /** Returns the roomId a socket is bound to, or undefined. */
  getRoomForSocket(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  /** Returns all socket IDs for a room. */
  getSocketsForRoom(roomId: string): string[] {
    const sockets = this.roomToSockets.get(roomId);
    return sockets ? Array.from(sockets) : [];
  }

  /**
   * Returns all socket IDs for all rooms in a zone.
   * Used by the sync broadcast to fan out ClockEvent + audio chunks.
   */
  getSocketsForZone(zoneId: string): string[] {
    const zone = this.zones.get(zoneId);
    if (!zone) return [];
    return zone.roomIds.flatMap((rid) => this.getSocketsForRoom(rid));
  }

  /**
   * Get the Session associated with a room (either via Zone or standalone).
   * Returns null if no session is bound.
   */
  getSessionForRoom(roomId: string): Session | null {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.zoneId) {
      const zone = this.zones.get(room.zoneId);
      if (zone?.sessionId) {
        return this.sessionManager.getSession(zone.sessionId) ?? null;
      }
      return null;
    }

    // Standalone room: look up session by userId convention
    // (not strictly needed for contract — callers can pass sessionId directly)
    return null;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private _removeRoomFromZone(roomId: string, zoneId: string): void {
    const zone = this.zones.get(zoneId);
    if (zone) {
      zone.roomIds = zone.roomIds.filter((id) => id !== roomId);
    }
    const room = this.rooms.get(roomId);
    if (room && room.zoneId === zoneId) {
      room.zoneId = null;
      // Revert to default transport when leaving a sync zone
      room.transport = TransportKind.HttpProgressive;
      room.codec = OutputCodec.Opus;
      this.emit("room:updated", room);
    }
  }
}
