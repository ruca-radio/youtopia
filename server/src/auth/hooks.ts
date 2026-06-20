/**
 * YouTopia Server — Fastify auth hooks.
 *
 * Drop-in preHandler hook for routes that require a valid bearer token.
 * Matches the pattern from companion-server api-shared/auth.ts but without
 * Electron safeStorage (pure Node, no Electron deps).
 *
 * Usage in Fastify:
 *   fastify.addHook("preHandler", requireAuth);
 *   // or per-route:
 *   fastify.post("/foo", { preHandler: requireAuth }, handler);
 */

import type {
  FastifyReply,
  FastifyRequest,
  HookHandlerDoneFunction,
} from "fastify";
import { verifyToken } from "./token.js";

/**
 * Fastify preHandler: validates `Authorization: Bearer <token>` header.
 * On success, attaches `request.authUserId` for downstream handlers.
 * On failure, responds 401 immediately.
 */
export function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const authHeader = request.headers.authorization ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  const result = verifyToken(rawToken);
  if (result.valid) {
    // Attach userId to the request for handler use
    (request as FastifyRequest & { authUserId: string }).authUserId =
      result.userId;
    done();
  } else {
    void reply.code(401).send({ error: "UNAUTHORIZED" });
  }
}

/**
 * Optional preHandler that does NOT block the request but attaches
 * authUserId if a valid token is present (for optionally-authenticated routes).
 */
export function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
  done: HookHandlerDoneFunction
): void {
  const authHeader = request.headers.authorization ?? "";
  const rawToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (rawToken) {
    const result = verifyToken(rawToken);
    if (result.valid) {
      (request as FastifyRequest & { authUserId: string }).authUserId =
        result.userId;
    }
  }
  done();
}
