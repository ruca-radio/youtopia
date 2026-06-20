/**
 * YouTopia Server — Fastify app factory.
 *
 * Creates and configures the Fastify app + Socket.IO instance:
 *  - CORS (origins from config)
 *  - Rate limiting (per-IP, control routes)
 *  - Health route: GET /healthz
 *  - Auth routes: POST /api/v1/auth/login|logout, GET /api/v1/auth/users
 *  - All REST_ROUTES from contracts as stubs (return 501 Not Implemented)
 *  - Socket.IO typed with ServerToClientEvents / ClientToServerEvents maps
 *
 * Usage:
 *   const { fastify, io } = await buildApp(config);
 *   await fastify.listen({ port: 9870, host: "0.0.0.0" });
 */

import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type FastifyReply,
} from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { Server as HttpServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";

import type { YouTopiaConfig } from "./config/index.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "./contracts/index.js";
import { REST_ROUTES } from "./contracts/index.js";
import { logger } from "./logger.js";
import { registerAuthRoutes } from "./auth/routes.js";
// Pod B: catalog routes (registered before stubs so real handlers take precedence)
import { registerSourceRoutes } from "./sources/routes.js";
import type { LibraryService } from "./sources/library/index.js";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export interface AppInstance {
  fastify: FastifyInstance;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
}

// ---------------------------------------------------------------------------
// Stub handler — returns 501 for all unimplemented routes
// ---------------------------------------------------------------------------

type StubHandler = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

function makeStub(routeKey: string, method: string, path: string): StubHandler {
  return async (_req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await reply.code(501).send({
      error: "NOT_IMPLEMENTED",
      route: routeKey,
      message: `${method} ${path} is a stub awaiting Pod B/C/D implementation`,
    });
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export async function buildApp(
  config: YouTopiaConfig,
  /** Optional LibraryService — provided by Pod B plugin at boot (injected after plugins load). */
  library?: LibraryService
): Promise<AppInstance> {
  const fastify: FastifyInstance = Fastify({
    logger: {
      level: process.env["LOG_LEVEL"] ?? (process.env["NODE_ENV"] !== "production" ? "debug" : "info"),
    },
    trustProxy: true,
  });

  // ── CORS ──────────────────────────────────────────────────────────────────
  await fastify.register(cors, {
    origin: config.server.corsOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  });

  // ── Rate limiting ─────────────────────────────────────────────────────────
  await fastify.register(rateLimit, {
    max: config.server.rateLimitPerMinute,
    timeWindow: "1 minute",
    errorResponseBuilder: () => ({
      error: "RATE_LIMITED",
      message: "Too many requests",
    }),
  });

  // ── Health ────────────────────────────────────────────────────────────────
  fastify.get("/healthz", async (_req: FastifyRequest, reply: FastifyReply) => {
    await reply.send({
      ok: true,
      service: "youtopia-server",
      version: "0.1.0",
      port: config.server.port,
      uptime: process.uptime(),
    });
  });

  // ── Auth routes ───────────────────────────────────────────────────────────
  await registerAuthRoutes(fastify);

  // ── Pod B catalog routes (before stubs — real handlers win) ──────────────
  // NOTE (Pod B edit): registerSourceRoutes registers before the 501 stubs so
  // GET /sources, /search, /tracks/:id, /albums/:id, /artists/:id, /playlists/:id
  // return real data instead of 501. library may be undefined at buildApp time if
  // plugins haven't loaded yet; in that case routes are omitted and stubs run.
  // The preferred pattern is to call buildApp without library, then call
  // registerSourceRoutes(fastify, library) directly from the plugin setup —
  // but Fastify requires route registration before listen(). We therefore
  // accept library as a parameter and defer to index.ts to pass it.
  if (library) {
    registerSourceRoutes(fastify, library);
  }

  // ── REST_ROUTES stubs (skip routes registered by Pod B and Pod D) ─────────
  // POD B EDIT: pass skipRoutes so stub registration doesn't conflict.
  // POD D EDIT: also skip session/room/zone routes — real handlers registered
  //             by Pod D's plugin in loadAllPlugins().
  const podBRoutes = new Set([
    "/api/v1/sources",
    "/api/v1/search",
    "/api/v1/tracks/:id",
    "/api/v1/albums/:id",
    "/api/v1/artists/:id",
    "/api/v1/playlists/:id",
  ]);
  // Pod D owns: sessions, transport, queue, dsp (session-level), rooms, zones, clock
  const podDRoutes = new Set([
    "/api/v1/sessions",
    "/api/v1/sessions/:sid",
    "/api/v1/sessions/:sid/now-playing",
    "/api/v1/sessions/:sid/transport",
    "/api/v1/sessions/:sid/queue",
    "/api/v1/sessions/:sid/dsp",
    "/api/v1/rooms",
    "/api/v1/zones",
    "/api/v1/zones/:zid/rooms",
    "/api/v1/zones/:zid/session",
    "/api/v1/rooms/:rid/clock",
  ]);
  const skipRoutes = new Set([...podBRoutes, ...podDRoutes]);
  registerContractRouteStubs(fastify, library ? skipRoutes : podDRoutes);

  // ── Socket.IO ─────────────────────────────────────────────────────────────
  const httpServer = fastify.server as unknown as HttpServer;
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    {
      cors: {
        origin: config.server.corsOrigins,
        credentials: true,
      },
      transports: ["polling", "websocket"],
    }
  );

  // Minimal connection handler — Pods B/D add their own listeners
  io.on("connection", (socket) => {
    logger.debug({ socketId: socket.id }, "Socket.IO client connected");

    socket.on("disconnect", (reason) => {
      logger.debug({ socketId: socket.id, reason }, "Socket.IO client disconnected");
    });

    // subscribe stub — actual session/zone subscription wired by Pod D
    socket.on("subscribe", (payload) => {
      logger.debug({ socketId: socket.id, payload }, "subscribe (stub — Pod D)");
    });
  });

  // ── Attach io to fastify for plugin access (Pod D) ──────────────────────
  // Plugins (Pod D session engine) call registerSessionSockets(fastify, ...)
  // and need the io instance. Attaching it here avoids circular imports while
  // keeping the AppInstance the primary return shape.
  (fastify as unknown as { io: typeof io }).io = io;

  return { fastify, io };
}

// ---------------------------------------------------------------------------
// REST stub registration
// ---------------------------------------------------------------------------

function registerContractRouteStubs(
  fastify: FastifyInstance,
  skipPaths: Set<string> = new Set()
): void {
  for (const [routeKey, routeValue] of Object.entries(REST_ROUTES) as Array<[string, string]>) {
    const spaceIdx = routeValue.indexOf(" ");
    const method = routeValue.slice(0, spaceIdx);
    const fastifyPath = routeValue.slice(spaceIdx + 1);

    // POD B EDIT: skip routes that have real handlers registered above
    if (skipPaths.has(fastifyPath)) continue;

    const stub = makeStub(routeKey, method, fastifyPath);

    switch (method) {
      case "GET":
        fastify.get(fastifyPath, stub);
        break;
      case "POST":
        fastify.post(fastifyPath, stub);
        break;
      case "PUT":
        fastify.put(fastifyPath, stub);
        break;
      case "DELETE":
        fastify.delete(fastifyPath, stub);
        break;
      default:
        logger.warn({ method, routeKey }, "Unknown HTTP method in REST_ROUTES — skipping");
    }
  }
}
