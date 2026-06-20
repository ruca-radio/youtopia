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

export async function buildApp(config: YouTopiaConfig): Promise<AppInstance> {
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

  // ── REST_ROUTES stubs ─────────────────────────────────────────────────────
  registerContractRouteStubs(fastify);

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

  return { fastify, io };
}

// ---------------------------------------------------------------------------
// REST stub registration
// ---------------------------------------------------------------------------

function registerContractRouteStubs(fastify: FastifyInstance): void {
  for (const [routeKey, routeValue] of Object.entries(REST_ROUTES) as Array<[string, string]>) {
    const spaceIdx = routeValue.indexOf(" ");
    const method = routeValue.slice(0, spaceIdx);
    const fastifyPath = routeValue.slice(spaceIdx + 1);

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
