/**
 * YouTopia Server — Auth REST routes.
 *
 * POST /api/v1/auth/login  — exchange userId + PIN for a bearer token.
 * POST /api/v1/auth/logout — revoke the current token.
 * GET  /api/v1/auth/users  — list configured users (no secrets).
 *
 * These routes are not in the REST_ROUTES contract because they are
 * infrastructure-level auth; clients hard-code them.
 * NOTE FOR PM: Consider adding auth routes to contracts/api.ts REST_ROUTES
 * for discoverability by client pods.
 */

import type { FastifyInstance } from "fastify";
import { validatePin, issueToken, revokeToken } from "./token.js";
import { requireAuth } from "./hooks.js";
import { getConfig } from "../config/index.js";
import { logger } from "../logger.js";

export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/auth/login
   * Body: { userId: string; pin: string }
   * Response: { token: string; userId: string; expiresInSeconds: number }
   */
  fastify.post<{ Body: { userId: string; pin: string } }>(
    "/api/v1/auth/login",
    async (request, reply) => {
      const { userId, pin } = request.body;
      if (!userId || !pin) {
        return reply.code(400).send({ error: "userId and pin are required" });
      }

      const resolvedUserId = validatePin(userId, pin);
      if (!resolvedUserId) {
        logger.warn({ userId }, "Failed login attempt");
        return reply.code(401).send({ error: "INVALID_CREDENTIALS" });
      }

      const token = issueToken(resolvedUserId);
      const cfg = getConfig();
      logger.info({ userId: resolvedUserId }, "User logged in");

      return reply.send({
        token,
        userId: resolvedUserId,
        expiresInSeconds: cfg.auth.tokenTtlSeconds,
      });
    }
  );

  /**
   * POST /api/v1/auth/logout
   * Header: Authorization: Bearer <token>
   * Response: 204 No Content
   */
  fastify.post(
    "/api/v1/auth/logout",
    { preHandler: requireAuth },
    async (request, reply) => {
      const authHeader = request.headers.authorization ?? "";
      const rawToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : authHeader.trim();
      revokeToken(rawToken);
      return reply.code(204).send();
    }
  );

  /**
   * GET /api/v1/auth/users
   * Returns the list of configured user display names (no PINs/hashes).
   */
  fastify.get("/api/v1/auth/users", async (_request, reply) => {
    const cfg = getConfig();
    const users = cfg.auth.users.map((u) => ({
      userId: u.userId,
      displayName: u.displayName,
    }));
    return reply.send({ users });
  });
}
