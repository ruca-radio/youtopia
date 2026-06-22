/**
 * YouTopia Server — AI module barrel.
 *
 * Registers the AI route handlers (GET /api/v1/sessions/:sid/ai/surface,
 * POST /api/v1/sessions/:sid/ai/chat) with Fastify via registerPlugin().
 *
 * Exports AiControllerImpl and the session DSP control registry so other
 * modules can register/look up per-session DSP chains.
 */

import { registerPlugin } from "../plugins/loader.js";
import { logger } from "../logger.js";

export {
  AiControllerImpl,
  registerSessionDspControl,
  unregisterSessionDspControl,
  getSessionDspControl,
  validateIntent,
} from "./AiControllerImpl.js";

export { callProvider, extractJsonObject } from "./providers.js";

// Plugin registration — wired last so session manager exists
registerPlugin({
  name: "ai-controller",
  async setup(ctx) {
    // Deferred import to avoid circular dependency: ai/index → session/index → ai/index
    const { sessionManager } = await import("../session/index.js");
    const { AiControllerImpl } = await import("./AiControllerImpl.js");

    const controller = new AiControllerImpl(sessionManager, ctx.config.ai);

    // ── AI REST routes ────────────────────────────────────────────────────────

    // GET /api/v1/sessions/:sid/ai/surface  → AiControlSurface
    ctx.fastify.get<{ Params: { sid: string } }>(
      "/api/v1/sessions/:sid/ai/surface",
      async (request, reply) => {
        const { sid } = request.params;
        const session = sessionManager.getSession(sid);
        if (!session) {
          return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
        }
        const surface = controller.describeSurface(sid);
        return reply.send(surface);
      },
    );

    // POST /api/v1/sessions/:sid/ai/chat  body: AiChatRequest → AiChatResponse
    ctx.fastify.post<{
      Params: { sid: string };
      Body: { text?: string; provider?: string };
    }>(
      "/api/v1/sessions/:sid/ai/chat",
      async (request, reply) => {
        const { sid } = request.params;
        const session = sessionManager.getSession(sid);
        if (!session) {
          return reply.code(404).send({ error: "SESSION_NOT_FOUND" });
        }

        const body = request.body ?? {};
        if (typeof body.text !== "string" || !body.text.trim()) {
          return reply.code(400).send({ error: "MISSING_TEXT" });
        }

        // Use cast pattern for authUserId (augmented type loaded via fastify.d.ts)
        const authUserId = (request as unknown as { authUserId: string }).authUserId ?? session.userId;

        const chatReq = {
          sessionId: sid,
          userId: authUserId,
          text: body.text.trim(),
          ...(body.provider ? { provider: body.provider as import("../contracts/index.js").AiProvider } : {}),
        };

        const response = await controller.handle(chatReq);
        return reply.send(response);
      },
    );

    logger.info(
      {
        routes: [
          "GET /api/v1/sessions/:sid/ai/surface",
          "POST /api/v1/sessions/:sid/ai/chat",
        ],
      },
      "AI controller routes registered",
    );
  },
});
