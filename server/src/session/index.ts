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
 * INTEGRATION (Gap 1): Per-session DspChain is created here and stored in a
 * shared map that is accessible to both the canonical /sessions/:sid/dsp routes
 * (Pod D) and the legacy /dsp/:sessionId/* routes (Pod C). Both route families
 * read the same DspChainImpl — single source of truth.
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
// INTEGRATION (Gap 1): DSP factory from Pod C
import { createSessionDsp } from "../dsp/index.js";
// INTEGRATION (Gap 1+2): shared DSP registry (avoids circular imports with routes.ts)
import { setSessionDsp, deleteSessionDsp } from "./dspRegistry.js";
// INTEGRATION (Gap 2): register DSP control with the AI module for surface building
import {
  registerSessionDspControl,
  unregisterSessionDspControl,
} from "../ai/AiControllerImpl.js";

// ---------------------------------------------------------------------------
// Shared singletons
// ---------------------------------------------------------------------------

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

      // INTEGRATION (Gap 1): Create a real DspChain for each session.
      // Both /sessions/:sid/dsp and /dsp/:sessionId/* read the same chain.
      const dspStack = createSessionDsp(session.sessionId);
      setSessionDsp(session.sessionId, dspStack);
      // Populate session.dsp[] immediately so GET /sessions/:sid returns populated dsp
      sessionManager.updateDspSnapshot(session.sessionId, dspStack.chain.snapshot());
      // INTEGRATION (Gap 2): Register with AI controller for surface building
      registerSessionDspControl(session.sessionId, dspStack.aiControl);

      logger.info(
        { userId: u.userId, sessionId: session.sessionId },
        "Default session created with DSP chain"
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

    // Clean up DSP registry when sessions are destroyed
    sessionManager.on("session:destroyed", (sessionId: string) => {
      deleteSessionDsp(sessionId);
      unregisterSessionDspControl(sessionId);
    });

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
