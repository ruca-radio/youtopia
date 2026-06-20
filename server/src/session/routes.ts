/**
 * YouTopia Server — Pod D: Session/Room REST route handlers.
 *
 * Wires the REST_ROUTES from contracts/api.ts that are in Pod D's domain:
 *
 * Sessions:
 *   GET    /api/v1/sessions              listSessions
 *   POST   /api/v1/sessions              createSession
 *   GET    /api/v1/sessions/:sid         getSession
 *   DELETE /api/v1/sessions/:sid         deleteSession
 *   GET    /api/v1/sessions/:sid/now-playing  nowPlaying
 *
 * Transport:
 *   POST   /api/v1/sessions/:sid/transport    applyTransportCommand
 *   POST   /api/v1/sessions/:sid/queue        queueAdd
 *   PUT    /api/v1/sessions/:sid/queue        queueReorder
 *
 * DSP snapshot (Pod D stores the state; Pod C fills it):
 *   GET    /api/v1/sessions/:sid/dsp     dspSnapshot (returns stored state)
 *
 * Rooms / Zones:
 *   GET    /api/v1/rooms                 listRooms
 *   GET    /api/v1/zones                 listZones
 *   POST   /api/v1/zones                 createZone
 *   PUT    /api/v1/zones/:zid/rooms      setZoneRooms
 *   PUT    /api/v1/zones/:zid/session    bindZoneSession
 *   POST   /api/v1/rooms/:rid/clock      clockReport (ingest ClientClockReport)
 *
 * All mutating routes require requireAuth. The server.ts stub registrations
 * are replaced by these real handlers — see server.ts edit notes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SessionManager } from "./SessionManager.js";
import type { RoomManager } from "./RoomManager.js";
import type { SyncClockEngine } from "../sync/SyncClock.js";
import { requireAuth } from "../auth/hooks.js";
import type {
  TransportCommand,
  QueueAddCommand,
  ClientClockReport,
  ClockEvent,
} from "../contracts/index.js";
import { SERVER_EVENTS } from "../contracts/index.js";
import { logger } from "../logger.js";

// Helper: get authUserId from request (Pod A convention)
function getAuthUserId(request: FastifyRequest): string {
  return (request as FastifyRequest & { authUserId: string }).authUserId;
}

export function registerSessionRoutes(
  fastify: FastifyInstance,
  sm: SessionManager,
  rm: RoomManager,
  clockEngine: SyncClockEngine
): void {

  // ── Sessions ──────────────────────────────────────────────────────────────

  // GET /api/v1/sessions
  fastify.get(
    "/api/v1/sessions",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getAuthUserId(request);
      const sessions = sm.getSessionsForUser(userId);
      return reply.send(sessions);
    }
  );

  // POST /api/v1/sessions
  fastify.post(
    "/api/v1/sessions",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = getAuthUserId(request);
      const session = sm.createSession(userId);
      return reply.code(201).send(session);
    }
  );

  // GET /api/v1/sessions/:sid
  fastify.get(
    "/api/v1/sessions/:sid",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const session = sm.getSession(sid);
      if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      // Auth: only the owning user may view their session
      if (session.userId !== getAuthUserId(request)) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
      return reply.send(session);
    }
  );

  // DELETE /api/v1/sessions/:sid
  fastify.delete(
    "/api/v1/sessions/:sid",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const session = sm.getSession(sid);
      if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      if (session.userId !== getAuthUserId(request)) {
        return reply.code(403).send({ error: "FORBIDDEN" });
      }
      sm.destroySession(sid);
      return reply.code(204).send();
    }
  );

  // GET /api/v1/sessions/:sid/now-playing
  fastify.get(
    "/api/v1/sessions/:sid/now-playing",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const np = sm.getNowPlaying(sid);
      if (!np) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return reply.send(np);
    }
  );

  // ── Transport ─────────────────────────────────────────────────────────────

  // POST /api/v1/sessions/:sid/transport
  fastify.post(
    "/api/v1/sessions/:sid/transport",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const body = request.body as TransportCommand;
      if (!body?.op) {
        return reply.code(400).send({ error: "MISSING_OP" });
      }
      const transport = sm.applyTransportCommand(sid, body);
      if (!transport) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return reply.send({ transport });
    }
  );

  // POST /api/v1/sessions/:sid/queue
  fastify.post(
    "/api/v1/sessions/:sid/queue",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const body = request.body as QueueAddCommand;
      if (!body?.trackIds || !body?.mode) {
        return reply.code(400).send({ error: "INVALID_QUEUE_COMMAND" });
      }
      // trackResolver stub — Pod B will wire the real resolver
      const session = sm.applyQueueAdd(sid, body, (_trackId) => undefined);
      if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return reply.send(session);
    }
  );

  // PUT /api/v1/sessions/:sid/queue
  fastify.put(
    "/api/v1/sessions/:sid/queue",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const body = request.body as { itemIds: string[] };
      if (!Array.isArray(body?.itemIds)) {
        return reply.code(400).send({ error: "MISSING_ITEM_IDS" });
      }
      const session = sm.reorderQueue(sid, body.itemIds);
      if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return reply.send(session);
    }
  );

  // GET /api/v1/sessions/:sid/dsp
  fastify.get(
    "/api/v1/sessions/:sid/dsp",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { sid } = request.params as { sid: string };
      const session = sm.getSession(sid);
      if (!session) return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
      return reply.send(session.dsp);
    }
  );

  // ── Rooms ─────────────────────────────────────────────────────────────────

  // GET /api/v1/rooms
  fastify.get(
    "/api/v1/rooms",
    { preHandler: requireAuth },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send(rm.listRooms());
    }
  );

  // ── Zones ─────────────────────────────────────────────────────────────────

  // GET /api/v1/zones
  fastify.get(
    "/api/v1/zones",
    { preHandler: requireAuth },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send(rm.listZones());
    }
  );

  // POST /api/v1/zones
  fastify.post(
    "/api/v1/zones",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { displayName?: string; bufferMs?: number };
      const displayName = body?.displayName ?? "New Zone";
      const zone = rm.createZone({ displayName, bufferMs: body?.bufferMs });
      return reply.code(201).send(zone);
    }
  );

  // PUT /api/v1/zones/:zid/rooms — set zone room membership
  fastify.put(
    "/api/v1/zones/:zid/rooms",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { zid } = request.params as { zid: string };
      const body = request.body as { roomIds: string[] };
      if (!Array.isArray(body?.roomIds)) {
        return reply.code(400).send({ error: "MISSING_ROOM_IDS" });
      }
      const zone = rm.setZoneRooms(zid, body.roomIds);
      if (!zone) return reply.code(404).send({ error: "ZONE_NOT_FOUND" });
      return reply.send(zone);
    }
  );

  // PUT /api/v1/zones/:zid/session — bind zone to session
  fastify.put(
    "/api/v1/zones/:zid/session",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { zid } = request.params as { zid: string };
      const body = request.body as { sessionId: string };
      if (!body?.sessionId) {
        return reply.code(400).send({ error: "MISSING_SESSION_ID" });
      }
      const zone = rm.bindZoneToSession(zid, body.sessionId);
      if (!zone) return reply.code(404).send({ error: "ZONE_OR_SESSION_NOT_FOUND" });

      // Re-anchor the sync clock for this zone
      const clock = clockEngine.reanchor(zid);
      zone.clock = clock;

      // Broadcast the new clock via socket.io (server-side instance via fastify)
      const io = (fastify as unknown as { io: { emit: (ev: string, data: unknown) => void } }).io;
      if (io) {
        const event: ClockEvent = { zoneId: zid, clock };
        io.emit(SERVER_EVENTS.clock, event);
      }

      return reply.send(zone);
    }
  );

  // POST /api/v1/rooms/:rid/clock — ingest ClientClockReport
  fastify.post(
    "/api/v1/rooms/:rid/clock",
    { preHandler: requireAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { rid } = request.params as { rid: string };
      const body = request.body as ClientClockReport;

      if (
        typeof body?.offsetMs !== "number" ||
        typeof body?.rttMs !== "number" ||
        typeof body?.reportedAt !== "number"
      ) {
        return reply.code(400).send({ error: "INVALID_CLOCK_REPORT" });
      }

      const report: ClientClockReport = { ...body, roomId: rid };

      // Find the zone for this room
      const room = rm.getRoom(rid);
      if (!room) return reply.code(404).send({ error: "ROOM_NOT_FOUND" });

      const zoneId = room.zoneId;
      if (!zoneId) {
        // Standalone room — accept the report but no clock sync needed
        return reply.send({ ok: true, message: "Room is not in a zone" });
      }

      const state = clockEngine.ingestReport(zoneId, report);

      // Check for drift — if this room has drifted beyond bufferMs, resync
      const zone = rm.getZone(zoneId);
      if (zone && clockEngine.isDrifted(zoneId, rid, zone.clock.bufferMs)) {
        logger.warn({ zoneId, roomId: rid }, "Room drifted beyond bufferMs — reanchoring");
        const clock = clockEngine.reanchor(zoneId, zone.clock.bufferMs);
        zone.clock = clock;

        const io = (fastify as unknown as { io: { emit: (ev: string, data: unknown) => void } }).io;
        if (io) {
          const event: ClockEvent = { zoneId, clock };
          io.emit(SERVER_EVENTS.clock, event);
        }
      }

      return reply.send({
        ok: true,
        offsetMs: state.offsetMs,
        rttMs: state.rttMs,
        sampleCount: state.sampleCount,
      });
    }
  );

  logger.info("Pod D REST routes registered");
}
