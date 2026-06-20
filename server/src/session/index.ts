/**
 * YouTopia Server — Pod D: Session/Room subsystem plugin entry point.
 *
 * Registers the session + room engine via registerPlugin() from Pod A's loader.
 * This module:
 *  1. Instantiates SessionManager, RoomManager, SyncClockEngine, StreamScheduler.
 *  2. Seeds two default rooms (Patrick + spouse) with standalone sessions.
 *  3. Wires the REST routes and socket.io event handlers for all session/room/zone
 *     operations defined in contracts/api.ts.
 *  4. Attaches session/room change events to socket.io broadcasts.
 *
 * Import this file in server/src/index.ts (or anywhere before loadAllPlugins())
 * to activate the Pod D subsystem.
 */

import { registerPlugin } from "../plugins/loader.js";
import { SessionManager } from "./SessionManager.js";
import { RoomManager } from "./RoomManager.js";
import { SyncClockEngine } from "../sync/SyncClock.js";
import { StreamScheduler } from "../sync/StreamScheduler.js";
import { registerSessionRoutes } from "./routes.js";
import { registerSessionSockets } from "./sockets.js";
import { logger } from "../logger.js";
import {
  ClientKind,
  TransportKind,
  OutputCodec,
} from "../contracts/index.js";

// Shared singletons — exported so routes and sockets can import them.
export let sessionManager: SessionManager;
export let roomManager: RoomManager;
export let syncClockEngine: SyncClockEngine;
export let streamScheduler: StreamScheduler;

registerPlugin({
  name: "session-room-engine",
  async setup(ctx) {
    // ── Instantiate singletons ──────────────────────────────────────────────
    sessionManager = new SessionManager();
    syncClockEngine = new SyncClockEngine({
      defaultBufferMs: 300,
      alpha: 0.125,
    });

    // Null sink — real TCP sink wired by the streaming layer (Pod B/C)
    streamScheduler = StreamScheduler.create(syncClockEngine, {
      write(_zoneId, _chunk) {
        // placeholder: real implementation pipes to per-room TCP/socket connections
      },
    });

    roomManager = new RoomManager(sessionManager);

    // ── Seed default rooms and sessions per PM decision (2 zones) ──────────
    const users = ctx.config.auth.users;

    for (const u of users) {
      const session = sessionManager.createSession(u.userId);
      logger.info(
        { userId: u.userId, sessionId: session.sessionId },
        "Default session created"
      );

      const room = roomManager.createRoom({
        displayName: `${u.displayName}'s Room`,
        client: ClientKind.Web,
        transport: TransportKind.HttpProgressive,
        codec: OutputCodec.Opus,
      });
      logger.info(
        { roomId: room.roomId, displayName: room.displayName },
        "Default room created"
      );
    }

    // ── Wire REST routes ────────────────────────────────────────────────────
    registerSessionRoutes(ctx.fastify, sessionManager, roomManager, syncClockEngine);

    // ── Wire socket.io handlers ─────────────────────────────────────────────
    registerSessionSockets(ctx.fastify, sessionManager, roomManager, syncClockEngine);

    logger.info(
      {
        sessions: sessionManager.listSessions().length,
        rooms: roomManager.listRooms().length,
      },
      "Session/Room engine ready"
    );
  },
});
