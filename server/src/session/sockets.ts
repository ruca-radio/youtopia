/**
 * YouTopia Server — Pod D: Socket.io event handlers.
 *
 * Wires CLIENT_EVENTS from contracts/api.ts that are in Pod D's domain:
 *
 *   subscribe        → join socket.io room(s) for session/zone updates
 *   transport        → apply TransportCommand to a session
 *   queue-add        → add tracks to a session's queue
 *   clock-report     → ingest ClientClockReport for NTP sync
 *
 * Server events emitted:
 *   now-playing      → on session:updated
 *   transport        → on transport change
 *   zone             → on zone:updated
 *   room             → on room:updated
 *   clock            → on clock reanchor
 *
 * Socket.io room naming:
 *   session:<sessionId>  → clients interested in a specific session
 *   zone:<zoneId>        → clients in a synced zone
 */

import type { FastifyInstance } from "fastify";
import type { Server as SocketIOServer, Socket } from "socket.io";
import type { SessionManager } from "./SessionManager.js";
import type { RoomManager } from "./RoomManager.js";
import type { SyncClockEngine } from "../sync/SyncClock.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  TransportCommand,
  QueueAddCommand,
  ClientClockReport,
  NowPlayingEvent,
  TransportEvent,
  ZoneEvent,
  RoomEvent,
  ClockEvent,
  Session,
  Room,
  Zone,
} from "../contracts/index.js";
import { SERVER_EVENTS } from "../contracts/index.js";
import { logger } from "../logger.js";

// Helper to extract the io instance attached by server.ts
function getIo(
  fastify: FastifyInstance
): SocketIOServer<ClientToServerEvents, ServerToClientEvents> | undefined {
  return (
    fastify as unknown as {
      io?: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
    }
  ).io;
}

export function registerSessionSockets(
  fastify: FastifyInstance,
  sm: SessionManager,
  rm: RoomManager,
  clockEngine: SyncClockEngine
): void {
  const io = getIo(fastify);
  if (!io) {
    logger.warn("registerSessionSockets: no io instance found on fastify — skipping socket wiring");
    return;
  }

  // ── Broadcast helpers ─────────────────────────────────────────────────────

  function broadcastNowPlaying(session: Session): void {
    const np = sm.getNowPlaying(session.sessionId);
    if (!np) return;
    const event: NowPlayingEvent = np;
    io!.to(`session:${session.sessionId}`).emit(SERVER_EVENTS.nowPlaying, event);
  }

  function broadcastTransport(session: Session): void {
    const event: TransportEvent = {
      sessionId: session.sessionId,
      transport: session.transport,
    };
    io!.to(`session:${session.sessionId}`).emit(SERVER_EVENTS.transport, event);
  }

  function broadcastZone(zone: Zone): void {
    const event: ZoneEvent = { zone };
    io!.to(`zone:${zone.zoneId}`).emit(SERVER_EVENTS.zone, event);
    // Also broadcast to the zone's session room
    if (zone.sessionId) {
      io!.to(`session:${zone.sessionId}`).emit(SERVER_EVENTS.zone, event);
    }
  }

  function broadcastRoom(room: Room): void {
    const event: RoomEvent = { room };
    io!.emit(SERVER_EVENTS.room, event);
  }

  // ── SessionManager event wiring ───────────────────────────────────────────

  sm.on("session:updated", (session: Session) => {
    broadcastNowPlaying(session);
    broadcastTransport(session);
  });

  // ── RoomManager event wiring ──────────────────────────────────────────────

  rm.on("zone:updated", (zone: Zone) => {
    broadcastZone(zone);
  });

  rm.on("room:updated", (room: Room) => {
    broadcastRoom(room);
  });

  // ── SyncClockEngine reanchor → broadcast ──────────────────────────────────

  clockEngine.on("clock:anchor", (zoneId: string, clock: Zone["clock"]) => {
    const event: ClockEvent = { zoneId, clock };
    io!.to(`zone:${zoneId}`).emit(SERVER_EVENTS.clock, event);
    logger.debug({ zoneId }, "Clock anchor broadcast");
  });

  // ── Per-connection handlers ────────────────────────────────────────────────

  io.on("connection", (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    logger.debug({ socketId: socket.id }, "Pod D: socket connected");

    // subscribe: join session or zone rooms
    socket.on("subscribe", (payload) => {
      if (payload.sessionId) {
        void socket.join(`session:${payload.sessionId}`);
        logger.debug(
          { socketId: socket.id, sessionId: payload.sessionId },
          "Socket subscribed to session"
        );
      }
      if (payload.zoneId) {
        void socket.join(`zone:${payload.zoneId}`);
        logger.debug(
          { socketId: socket.id, zoneId: payload.zoneId },
          "Socket subscribed to zone"
        );
      }
    });

    // transport: apply TransportCommand
    socket.on("transport", (cmd: TransportCommand) => {
      // The client must be subscribed to a session — find which session
      // they are authorized for. For socket transport, we use a best-effort
      // approach: look up the room bound to this socket.
      const roomId = rm.getRoomForSocket(socket.id);
      if (!roomId) {
        logger.warn({ socketId: socket.id }, "transport: socket not bound to a room");
        return;
      }
      const session = rm.getSessionForRoom(roomId);
      if (!session) {
        logger.warn({ socketId: socket.id, roomId }, "transport: no session for room");
        return;
      }
      sm.applyTransportCommand(session.sessionId, cmd);
    });

    // queue-add: add to session queue
    socket.on("queue-add", (cmd: QueueAddCommand) => {
      const roomId = rm.getRoomForSocket(socket.id);
      if (!roomId) return;
      const session = rm.getSessionForRoom(roomId);
      if (!session) return;
      sm.applyQueueAdd(session.sessionId, cmd, () => undefined);
    });

    // clock-report: ingest NTP-style offset/rtt for a room
    socket.on("clock-report", (report: ClientClockReport) => {
      const room = rm.getRoom(report.roomId);
      if (!room) return;
      const zoneId = room.zoneId;
      if (!zoneId) return;

      clockEngine.ingestReport(zoneId, report);

      // Check drift
      const zone = rm.getZone(zoneId);
      if (zone && clockEngine.isDrifted(zoneId, report.roomId, zone.clock.bufferMs)) {
        logger.warn(
          { zoneId, roomId: report.roomId },
          "Socket clock-report: drift detected, reanchoring"
        );
        const clock = clockEngine.reanchor(zoneId, zone.clock.bufferMs);
        zone.clock = clock;
        const event: ClockEvent = { zoneId, clock };
        io!.to(`zone:${zoneId}`).emit(SERVER_EVENTS.clock, event);
      }
    });

    // On disconnect: clean up room binding
    socket.on("disconnect", () => {
      rm.unbindSocket(socket.id);
      logger.debug({ socketId: socket.id }, "Pod D: socket disconnected, room unbound");
    });
  });

  logger.info("Pod D socket handlers registered");
}
