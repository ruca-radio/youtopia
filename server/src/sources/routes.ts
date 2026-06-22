/**
 * YouTopia Server — Source/Catalog REST route handlers (Pod B).
 *
 * Implements the following REST_ROUTES:
 *   GET /api/v1/sources       → SourceDescriptor[] (all registered sources)
 *   GET /api/v1/search        → SearchResult (fan-out with ISRC de-dup)
 *   GET /api/v1/tracks/:id    → Track
 *   GET /api/v1/albums/:id    → Album
 *   GET /api/v1/artists/:id   → Artist
 *   GET /api/v1/playlists/:id → Playlist
 *
 * These routes are registered by calling `registerSourceRoutes(fastify, library)`
 * from server.ts (minimal edit). They REPLACE the 501 stubs Pod A registered
 * for the same paths, by registering the real handler BEFORE the stubs run.
 *
 * NOTE: server.ts must be minimally edited to call registerSourceRoutes() after
 * the LibraryService is initialized. See the "Pod B Handoff" section in the
 * architecture_handoff.md for instructions.
 *
 * Auth: sources/search are public (no auth required — catalog is read-only).
 *       track/album/artist/playlist require auth (bearer token) to prevent
 *       unauthenticated enumeration of private playlists.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { requireAuth } from "../auth/hooks.js";
import type { LibraryService } from "./library/index.js";
import type { MediaId } from "../contracts/index.js";
import { logger } from "../logger.js";

// ---------------------------------------------------------------------------
// Param shapes
// ---------------------------------------------------------------------------

interface IdParams {
  id: string;
}

interface SearchQueryParams {
  q?: string;
  kinds?: string;
  limit?: string;
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

/**
 * Register Pod B's catalog routes on the Fastify instance.
 *
 * MUST be called before registerContractRouteStubs() in server.ts so these
 * real handlers win over the 501 stubs. (Fastify matches routes in registration
 * order for identical paths.)
 *
 * If called after the stubs are already registered, the stubs will take
 * precedence. The server.ts edit below moves the stub registration to AFTER
 * this call.
 */
export function registerSourceRoutes(fastify: FastifyInstance, library: LibraryService): void {
  // ── GET /api/v1/sources ─────────────────────────────────────────────────
  fastify.get("/api/v1/sources", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const sources = library.listSources();
      await reply.send(sources);
    } catch (err) {
      logger.error({ err }, "[routes/sources] listSources error");
      await reply.code(500).send({ error: "INTERNAL_ERROR" });
    }
  });

  // ── GET /api/v1/search ──────────────────────────────────────────────────
  fastify.get<{ Querystring: SearchQueryParams }>(
    "/api/v1/search",
    async (req, reply: FastifyReply) => {
      const { q, kinds, limit } = req.query;

      if (!q || q.trim().length === 0) {
        await reply.code(400).send({ error: "BAD_REQUEST", message: "q parameter required" });
        return;
      }

      try {
        const result = await library.searchAll({
          text: q.trim(),
          kinds: kinds
            ? (kinds.split(",").map((k) => k.trim()) as Array<"track" | "album" | "artist" | "playlist">)
            : undefined,
          limit: limit ? parseInt(limit, 10) : 25,
        });
        await reply.send(result);
      } catch (err) {
        logger.error({ err, q }, "[routes/search] searchAll error");
        await reply.code(500).send({ error: "INTERNAL_ERROR" });
      }
    }
  );

  // ── GET /api/v1/tracks/:id ──────────────────────────────────────────────
  fastify.get<{ Params: IdParams }>(
    "/api/v1/tracks/:id",
    { preHandler: requireAuth },
    async (req, reply: FastifyReply) => {
      const id = decodeURIComponent(req.params.id) as MediaId;
      try {
        const track = await library.getTrack(id);
        await reply.send(track);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          await reply.code(404).send({ error: "NOT_FOUND", id });
        } else {
          logger.error({ err, id }, "[routes/tracks] getTrack error");
          await reply.code(500).send({ error: "INTERNAL_ERROR" });
        }
      }
    }
  );

  // ── GET /api/v1/albums/:id ──────────────────────────────────────────────
  fastify.get<{ Params: IdParams }>(
    "/api/v1/albums/:id",
    { preHandler: requireAuth },
    async (req, reply: FastifyReply) => {
      const id = decodeURIComponent(req.params.id) as MediaId;
      try {
        const album = await library.getAlbum(id);
        await reply.send(album);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          await reply.code(404).send({ error: "NOT_FOUND", id });
        } else {
          logger.error({ err, id }, "[routes/albums] getAlbum error");
          await reply.code(500).send({ error: "INTERNAL_ERROR" });
        }
      }
    }
  );

  // ── GET /api/v1/artists/:id ─────────────────────────────────────────────
  fastify.get<{ Params: IdParams }>(
    "/api/v1/artists/:id",
    { preHandler: requireAuth },
    async (req, reply: FastifyReply) => {
      const id = decodeURIComponent(req.params.id) as MediaId;
      try {
        const artist = await library.getArtist(id);
        await reply.send(artist);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          await reply.code(404).send({ error: "NOT_FOUND", id });
        } else {
          logger.error({ err, id }, "[routes/artists] getArtist error");
          await reply.code(500).send({ error: "INTERNAL_ERROR" });
        }
      }
    }
  );

  // ── GET /api/v1/playlists/:id ───────────────────────────────────────────
  fastify.get<{ Params: IdParams }>(
    "/api/v1/playlists/:id",
    { preHandler: requireAuth },
    async (req, reply: FastifyReply) => {
      const id = decodeURIComponent(req.params.id) as MediaId;
      try {
        const playlist = await library.getPlaylist(id);
        await reply.send(playlist);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("not found")) {
          await reply.code(404).send({ error: "NOT_FOUND", id });
        } else {
          logger.error({ err, id }, "[routes/playlists] getPlaylist error");
          await reply.code(500).send({ error: "INTERNAL_ERROR" });
        }
      }
    }
  );

  logger.info("[sources/routes] Pod B catalog routes registered");
}
