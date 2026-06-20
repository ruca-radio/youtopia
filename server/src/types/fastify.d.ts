/**
 * YouTopia Server — Fastify module augmentation.
 *
 * Adds typed fields to FastifyRequest and FastifyInstance so pods can
 * access authUserId and the Socket.IO instance without type casts.
 *
 * INTEGRATION: Added by the integration engineer pass to clean up the
 * `(request as FastifyRequest & { authUserId: string })` casts used by
 * Pod A, C, D auth middleware and session routes.
 */

import type { Server as SocketIOServer } from "socket.io";
import type { ServerToClientEvents, ClientToServerEvents } from "../contracts/index.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by requireAuth / optionalAuth preHandlers in auth/hooks.ts */
    authUserId: string;
  }

  interface FastifyInstance {
    /** Socket.IO server attached by buildApp() for plugin access. */
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  }
}
