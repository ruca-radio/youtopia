import IIntegration from "../integration";
import Fastify, { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import FastifyIO from "fastify-socket.io/dist/index";
import CompanionServerAPIv1 from "./api/v1";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import Conf from "conf";
import fs from "fs";
import path from "path";
import { app, BrowserView, safeStorage } from "electron";
import { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { RemoteSocket } from "socket.io";
import { DefaultEventsMap } from "socket.io/dist/typed-events";
import cors from "@fastify/cors";
import { fastifyRateLimit } from "@fastify/rate-limit";
import crypto from "crypto";
import MemoryStore from "../../memory-store";
import log from "electron-log";
import { isDefinedAPIError } from "./api-shared/errors";
import { getLatestTvAudioProfile, getTvDisplayState } from "../../tv-display-state";
import { createTvAudioStream, createTvProgramStream, getTvAudioStatus } from "./tv-audio-stream";
import { addAudioAnalyzerSubscriber, removeAudioAnalyzerSubscriber } from "../../audio-analyzer-hub";

const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
const TV_CONTROL_PIN_HEADER = "x-tv-control-pin";

export default class CompanionServer implements IIntegration {
  private listenIp = "0.0.0.0";
  private listenPort = 9863;
  private fastifyServer: FastifyInstance;
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;
  private ytmView: BrowserView;
  private storeListener: () => void | null = null;
  private activeTvAudioStop: (() => void) | null = null;
  private tvEventClients = 0;

  private addTvAudioAnalyzerClient(): void {
    this.tvEventClients += 1;
    if (this.tvEventClients === 1) {
      addAudioAnalyzerSubscriber("tv");
    }
  }

  private removeTvAudioAnalyzerClient(): void {
    if (this.tvEventClients === 0) return;
    this.tvEventClients -= 1;
    if (this.tvEventClients === 0) {
      removeAudioAnalyzerSubscriber("tv");
    }
  }

  private getOpenAIApiKey(): string | null {
    const storeKey = (this.store.get("integrations.lightssOpenAIApiKey") as string | null)?.trim();
    return storeKey || process.env.OPENAI_API_KEY?.trim() || null;
  }

  private getOrCreateTvControlPin(): string {
    const existing = this.store.get("integrations.companionServerTvControlPin") as string | null;
    if (existing) return existing;

    const pin = crypto.randomInt(0, 1000000).toString().padStart(6, "0");
    this.store.set("integrations.companionServerTvControlPin", pin);
    return pin;
  }

  private isTvControlAuthorized(request: FastifyRequest): boolean {
    const provided = request.headers[TV_CONTROL_PIN_HEADER];
    if (typeof provided !== "string" || provided.length === 0) return false;

    const expected = this.getOrCreateTvControlPin();
    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);
    if (providedBuffer.length !== expectedBuffer.length) return false;

    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  }

  private buildDjGptSessionConfig() {
    const state = getTvDisplayState();
    const audioProfile = getLatestTvAudioProfile();
    const model =
      (this.store.get<"integrations.lightssOpenAIRealtimeModel", string>("integrations.lightssOpenAIRealtimeModel") || DEFAULT_OPENAI_REALTIME_MODEL).trim() ||
      DEFAULT_OPENAI_REALTIME_MODEL;
    const voice =
      (this.store.get<"integrations.lightssOpenAIRealtimeVoice", string>("integrations.lightssOpenAIRealtimeVoice") || DEFAULT_OPENAI_REALTIME_VOICE).trim() ||
      DEFAULT_OPENAI_REALTIME_VOICE;

    return {
      type: "realtime",
      model,
      audio: {
        output: { voice }
      },
      instructions: [
        "# Role and Objective",
        "You are DJ-GPT for Youtopia TV: a real radio-style host and audio companion for a private music room.",
        "The user was a radio DJ for years. Respect that level: be tasteful, tight, musically aware, and never generic.",
        "# Personality and Tone",
        "Sound like a seasoned late-night DJ: warm, quick, a little weird, but disciplined. One or two sentences by default.",
        "# Timing",
        "Speak between songs, over fades, or in short intro windows. talk to the post when the intro allows it: finish before the vocal or obvious downbeat.",
        "If the music is already in a vocal section or the room energy is high, stay brief or wait.",
        "# Context",
        `Current track: ${state.player.title} by ${state.player.artist}. Progress ${Math.round(state.player.progressPercent)} percent. Volume ${state.player.volume}.`,
        `Audio profile: energy ${audioProfile.energy}, bass ${audioProfile.bass}, mid ${audioProfile.mid}, treble ${audioProfile.treble}, live ${audioProfile.live}.`,
        `LED/TV status: ${state.lightss?.wledStatus || "unknown"} WLED, ${state.lightss?.lightStatus || "idle"} lights, VU style ${state.appearance.vuMeterStyle}.`,
        "Room lighting: one WLED string sits behind the TV and washes the wall as ambient bias light. Treat it as an extension of the screen, not a direct-view fixture.",
        "# Guardrails",
        "No strobe, blink, rapid flash, abrupt color jumps, or harsh jump language. Do not pretend to have executed playback changes unless a tool/result confirms it.",
        "When asked for music direction, suggest fades, searches, set arcs, or playlist ideas like a program director."
      ].join("\\n")
    };
  }

  private createServer() {
    this.fastifyServer = Fastify().withTypeProvider<TypeBoxTypeProvider>();
    this.fastifyServer.addContentTypeParser(["application/sdp", "text/plain"], { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
    // Rate limiting is opt-in per route (global: false) so it only guards the
    // PIN-protected TV control endpoints against brute-force attempts.
    this.fastifyServer.register(fastifyRateLimit, {
      global: false
    });
    this.fastifyServer.register(cors, {
      origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false) ? "*" : false
    });
    this.fastifyServer.register(FastifyIO, {
      transports: ["websocket"],
      allowUpgrades: false,
      // While this is websocket only we still apply cors just in case
      cors: {
        origin: this.store.get<"integrations.companionServerCORSWildcardEnabled", boolean>("integrations.companionServerCORSWildcardEnabled", false)
          ? "*"
          : false
      }
    });
    this.fastifyServer.register(CompanionServerAPIv1, {
      prefix: "/api/v1",
      getYtmView: () => {
        return this.ytmView;
      },
      getStore: () => {
        return this.store;
      },
      getMemoryStore: () => {
        return this.memoryStore;
      }
    });
    this.fastifyServer.setErrorHandler((error, request, reply) => {
      if (isDefinedAPIError(error)) {
        reply.send(error);
        return;
      }

      const fastifyError = error as FastifyError;
      if (!fastifyError.statusCode || fastifyError.statusCode >= 500) {
        log.error(error);
        reply.send(new Error("An internal server error occurred"));
        return;
      }

      reply.send(error);
    });
    this.fastifyServer.get("/metadata", (request, reply) => {
      reply.send({
        apiVersions: ["v1"]
      });
    });
    this.fastifyServer.get("/tv/state", (_request, reply) => {
      reply.send(getTvDisplayState());
    });
    this.fastifyServer.get("/tv/events", (request, reply) => {
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      reply.raw.write(`data: ${JSON.stringify(getTvDisplayState())}\n\n`);

      // A connected TV display must keep the YTM audio analyzer running on its own,
      // independent of the desktop VU meter toggle, or the TV VU meter stays dead.
      this.addTvAudioAnalyzerClient();
      let analyzerClientReleased = false;
      const releaseAnalyzerClient = () => {
        if (analyzerClientReleased) return;
        analyzerClientReleased = true;
        this.removeTvAudioAnalyzerClient();
      };

      const interval = setInterval(() => {
        reply.raw.write(`data: ${JSON.stringify(getTvDisplayState())}\n\n`);
      }, 66);

      request.raw.on("close", () => {
        clearInterval(interval);
        releaseAnalyzerClient();
      });
    });
    this.fastifyServer.get("/tv/audio/status", (_request, reply) => {
      reply.send(getTvAudioStatus());
    });
    this.fastifyServer.get("/tv/audio", (request, reply) => {
      const status = getTvAudioStatus();
      if (!status.ffmpegAvailable) {
        reply.code(503).send({
          error: "ffmpeg is not available",
          status
        });
        return;
      }

      const format = (request.query as { format?: string }).format === "webm" ? "webm" : "mp3";
      this.activeTvAudioStop?.();
      this.activeTvAudioStop = null;
      const audio = createTvAudioStream(format);
      this.activeTvAudioStop = audio.stop;
      log.info(`TV audio ${format} stream started from ${audio.source}`);

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": audio.contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });

      let stderr = "";
      let requestClosed = false;
      audio.process.stderr.on("data", chunk => {
        stderr += chunk.toString();
        if (stderr.length > 3000) {
          stderr = stderr.slice(-3000);
        }
      });
      audio.process.on("error", error => {
        log.warn("TV audio stream failed to start:", error);
      });
      audio.process.on("close", (code, signal) => {
        if (requestClosed || signal || code === 255) {
          log.info(`TV audio stream stopped${signal ? ` by ${signal}` : ""}`);
        } else if (code !== 0 && code !== null) {
          log.warn(`TV audio stream stopped with code ${code}: ${stderr.trim()}`);
        } else {
          log.info(`TV audio stream stopped${signal ? ` by ${signal}` : ""}`);
        }
      });
      request.raw.on("close", () => {
        requestClosed = true;
        audio.stop();
        if (this.activeTvAudioStop === audio.stop) {
          this.activeTvAudioStop = null;
        }
      });
      audio.process.stdout.pipe(reply.raw);
    });
    this.fastifyServer.get("/tv/program", (_request, reply) => {
      const status = getTvAudioStatus();
      if (!status.ffmpegAvailable) {
        reply.code(503).send({
          error: "ffmpeg is not available",
          status
        });
        return;
      }

      const state = getTvDisplayState();
      const program = createTvProgramStream({
        title: state.player.title,
        artist: state.player.artist
      });
      log.info(`TV server program stream started from ${program.source}`);

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": program.contentType,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });

      let stderr = "";
      let requestClosed = false;
      program.process.stderr.on("data", chunk => {
        stderr += chunk.toString();
        if (stderr.length > 3000) {
          stderr = stderr.slice(-3000);
        }
      });
      program.process.on("error", error => {
        log.warn("TV server program stream failed to start:", error);
      });
      program.process.on("close", (code, signal) => {
        if (requestClosed || signal || code === 255) {
          log.info(`TV server program stream stopped${signal ? ` by ${signal}` : ""}`);
        } else if (code !== 0 && code !== null) {
          log.warn(`TV server program stream stopped with code ${code}: ${stderr.trim()}`);
        } else {
          log.info(`TV server program stream stopped${signal ? ` by ${signal}` : ""}`);
        }
      });
      _request.raw.on("close", () => {
        requestClosed = true;
        program.stop();
      });
      program.process.stdout.pipe(reply.raw);
    });
    this.fastifyServer.post("/tv/dj-gpt/session", { config: { rateLimit: { max: 10, timeWindow: 1000 * 60 } } }, async (request, reply) => {
      if (!this.isTvControlAuthorized(request)) {
        reply.code(401).send({ error: "Invalid or missing TV control PIN" });
        return;
      }

      const apiKey = this.getOpenAIApiKey();
      if (!apiKey) {
        reply.code(503).send({
          error: "OpenAI API key is required for DJ-GPT realtime voice"
        });
        return;
      }

      const sdp = typeof request.body === "string" ? request.body : "";
      if (!sdp.trim()) {
        reply.code(400).send({
          error: "SDP offer is required"
        });
        return;
      }

      const form = new FormData();
      form.set("sdp", sdp);
      form.set("session", JSON.stringify(this.buildDjGptSessionConfig()));
      const response = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "OpenAI-Safety-Identifier": "youtopia-local-dj-gpt"
        },
        body: form
      });
      const answer = await response.text();
      if (!response.ok) {
        reply.code(response.status).send(answer);
        return;
      }
      reply.header("Content-Type", "application/sdp").send(answer);
    });
    this.fastifyServer.post("/tv/control", { config: { rateLimit: { max: 300, timeWindow: 1000 * 60 } } }, (request, reply) => {
      if (!this.isTvControlAuthorized(request)) {
        reply.code(401).send({ ok: false, error: "Invalid or missing TV control PIN" });
        return;
      }

      const allowedTvCommands = new Set(["playPause", "previous", "next", "volumeUp", "volumeDown", "toggleLike"]);
      const command = String((request.body as { command?: string } | null)?.command ?? "");
      if (!allowedTvCommands.has(command)) {
        reply.code(400).send({ ok: false, error: "Unsupported TV control command" });
        return;
      }

      if (!this.ytmView) {
        reply.code(503).send({ ok: false, error: "YTM view is unavailable" });
        return;
      }

      this.ytmView.webContents.send("remoteControl:execute", command);
      reply.send({ ok: true, command });
    });
    this.fastifyServer.get("/tv", (_request, reply) => {
      reply.type("text/html").send(getTvDisplayHtml());
    });
    this.fastifyServer.get("/tv/program-receiver", (_request, reply) => {
      reply.type("text/html").send(getTvReceiverHtml());
    });
    this.fastifyServer.get("/tv/provider-logo/:provider", (request, reply) => {
      const provider = String((request.params as { provider?: string }).provider ?? "").toLowerCase();
      const logoPath = getProviderLogoPath(provider);
      if (!logoPath) {
        reply.code(404).send();
        return;
      }

      reply.type("image/png").send(fs.createReadStream(logoPath));
    });

    // Disconnect connections to the default namespace
    this.fastifyServer.ready().then(() => {
      this.fastifyServer.io.on("connection", socket => socket.disconnect());
    });
  }

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, ytmView: BrowserView): void {
    this.store = store;
    this.memoryStore = memoryStore;
    this.ytmView = ytmView;
  }

  public async enable() {
    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable Companion Server Integration with reason: safeStorage unavailable");
      return;
    }

    if (!this.fastifyServer || (this.fastifyServer && !this.fastifyServer.server.listening)) {
      this.createServer();
      await this.fastifyServer.listen({
        host: this.listenIp,
        port: this.listenPort
      });
      this.storeListener = this.store.onDidChange("integrations", async newState => {
        const validTokenIds: string[] = newState.companionServerAuthTokens
          ? JSON.parse(safeStorage.decryptString(Buffer.from(newState.companionServerAuthTokens, "hex"))).map((authToken: AuthToken) => authToken.id)
          : [];
        if (this.fastifyServer.server.listening) {
          const namespaces = this.fastifyServer.io._nsps.keys();
          let sockets: RemoteSocket<DefaultEventsMap, { tokenId: string }>[] = [];

          for (const namespace of namespaces) {
            const namespacedSockets = await this.fastifyServer.io.of(namespace).fetchSockets();
            sockets = sockets.concat(namespacedSockets);
          }

          for (const socket of sockets) {
            if (!validTokenIds.includes(socket.data.tokenId)) {
              socket.disconnect(true);
            }
          }
        }
      });
    }
  }

  public async disable() {
    if (this.fastifyServer) {
      await this.fastifyServer.close();
      if (this.storeListener) {
        this.storeListener();
      }
    }
    if (this.tvEventClients > 0) {
      this.tvEventClients = 0;
      removeAudioAnalyzerSubscriber("tv");
    }
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}

function getTvReceiverHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Youtopia TV Program</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; height: 100vh; overflow: hidden; background: #000; color: #f5f5f5; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    video { width: 100vw; height: 100vh; display: block; object-fit: cover; background: #000; }
    .overlay { position: fixed; inset: auto 22px 22px 22px; display: flex; align-items: center; justify-content: space-between; gap: 14px; pointer-events: none; }
    .status { min-width: 0; color: rgba(255,255,255,.72); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 2px 14px #000; }
    button { pointer-events: auto; appearance: none; display: inline-grid; place-items: center; border: 1px solid rgba(255,255,255,.24); background: rgba(255,255,255,.1); color: #fff; border-radius: 999px; width: 42px; height: 42px; padding: 0; font: inherit; line-height: 0; }
    button svg { width: 20px; height: 20px; display: block; fill: none; stroke: currentColor; stroke-width: 2.15; stroke-linecap: round; stroke-linejoin: round; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  </style>
</head>
<body>
  <video id="program" autoplay playsinline controls src="/tv/program"></video>
  <div class="overlay">
    <div id="status" class="status">Server program feed</div>
    <button id="reload" type="button" aria-label="Reload program" title="Reload program">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>
      <span class="sr-only">Reload program</span>
    </button>
  </div>
  <script>
    const program = document.getElementById("program");
    const status = document.getElementById("status");
    const reload = document.getElementById("reload");
    function setStatus(text) { status.textContent = text; }
    function reloadProgram() {
      const muted = program.muted;
      program.src = "/tv/program?ts=" + Date.now();
      program.muted = muted;
      program.play().catch(() => setStatus("Select play to start the server feed"));
    }
    program.addEventListener("playing", () => setStatus("Server output live: audio and video in one feed"));
    program.addEventListener("waiting", () => setStatus("Buffering server program feed"));
    program.addEventListener("error", () => setStatus("Server program feed unavailable"));
    reload.addEventListener("click", reloadProgram);
    setTimeout(() => {
      program.play().catch(() => setStatus("Select play to start the server feed"));
    }, 250);
  </script>
</body>
</html>`;
}

function getTvDisplayHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Youtopia TV</title>
  <style>
	    :root {
	      color-scheme: dark;
	      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	      --tv-bg: #000000;
	      --accent: #ef4444;
	      --vu-low: #22c55e;
	      --vu-mid: #facc15;
	      --vu-high: #ef4444;
	    }
	    * { box-sizing: border-box; }
	    body { margin: 0; height: 100vh; overflow: hidden; background: #000000; color: #f1f1f1; cursor: none; }
	    body.hud-visible { cursor: default; }
	    body.hud-idle .audio-panel,
	    body.hud-idle .transport-panel {
	      opacity: 0;
	      transform: translateY(12px);
	      pointer-events: none;
	    }
	    body.hud-idle .message,
	    body.hud-idle .ticker {
	      opacity: .18;
	    }
	    body[data-font="display"] { font-family: Impact, Haettenschweiler, "Arial Narrow Bold", Inter, sans-serif; }
	    body[data-font="mono"] { font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace; }
	    .album-art-backdrop {
	      position: fixed;
	      inset: -8%;
	      z-index: 0;
	      background-position: center;
	      background-size: cover;
	      opacity: 0;
	      filter: blur(44px) saturate(1.18);
	      transform: scale(1.04);
	      transition: opacity 800ms ease;
	    }
	    body[data-album-art-mode="ambient"] .album-art-backdrop,
	    body[data-album-art-mode="hero"] .album-art-backdrop {
	      opacity: .16;
	    }
	    #scene {
	      position: fixed;
	      inset: 0;
	      width: 100%;
	      height: 100%;
	      display: block;
	      z-index: 0;
	      background: #000000;
	    }
	    main {
	      position: relative;
	      z-index: 1;
	      height: 100vh;
	      min-height: 0;
	      padding: clamp(22px, 3vw, 48px);
	      display: grid;
	      grid-template-rows: auto minmax(0, 1fr) auto;
	      gap: clamp(14px, 2.2vw, 30px);
	    }
	    .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: start; }
	    .track-copy { min-width: 0; }
	    .eyebrow { color: #aaa; font-size: clamp(12px, 1.1vw, 16px); text-transform: uppercase; letter-spacing: .12em; }
	    .eyebrow, h1, .artist, .message { text-shadow: 0 2px 16px rgba(0,0,0,.6); }
	    h1 { margin: 8px 0 4px; max-width: 20ch; max-height: 1.92em; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: clamp(38px, 5.1vw, 72px); line-height: .96; letter-spacing: 0; overflow-wrap: anywhere; }
	    .artist { margin: 0; color: #cfcfcf; font-size: clamp(20px, 2.1vw, 30px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status-lights { display: flex; justify-content: flex-end; align-items: center; gap: 14px; min-height: 32px; }
    .status-light { width: 14px; height: 14px; border-radius: 999px; background: #3f3f46; border: 1px solid rgba(255,255,255,.24); box-shadow: 0 0 0 5px rgba(255,255,255,.04), 0 0 20px rgba(255,255,255,.08); }
    .status-light.ok { background: #22c55e; border-color: rgba(134,239,172,.82); box-shadow: 0 0 0 5px rgba(34,197,94,.12), 0 0 22px rgba(34,197,94,.42); }
    .status-light.busy, .status-light.warn { background: #f59e0b; border-color: rgba(253,230,138,.82); box-shadow: 0 0 0 5px rgba(245,158,11,.12), 0 0 22px rgba(245,158,11,.38); }
    .status-light.bad { background: #ef4444; border-color: rgba(254,202,202,.82); box-shadow: 0 0 0 5px rgba(239,68,68,.13), 0 0 22px rgba(239,68,68,.42); }
    .visualizer { min-height: 0; display: flex; align-items: end; justify-content: center; gap: clamp(8px, 1vw, 18px); }
    .bar { width: clamp(12px, 2vw, 34px); min-height: 8px; border-radius: 10px 10px 4px 4px; background: linear-gradient(to top, var(--vu-low), var(--vu-mid) 62%, var(--vu-high)); opacity: .95; will-change: height; }
    .bar.fallback { opacity: .28; background: #5a5a5a; }
    body[data-vu-style="classicLed"] .bar { height: 82% !important; background: linear-gradient(to top, var(--vu-low) 0%, var(--vu-low) 55%, var(--vu-mid) 55%, var(--vu-mid) 78%, var(--vu-high) 78%); box-shadow: inset 0 0 0 2px rgba(0,0,0,.35); }
    body[data-vu-style="dotMatrix"] .bar { border-radius: 999px; background: radial-gradient(circle at 50% 86%, var(--vu-high) 0 35%, transparent 38%) 0 0 / 100% 12.5% repeat-y; }
    body[data-vu-style="spectrumLine"] .visualizer { align-items: center; gap: 3px; }
    body[data-vu-style="spectrumLine"] .bar { width: clamp(7px, .8vw, 14px); border-radius: 999px; }
    body[data-vu-style="albumGlow"] .bar { box-shadow: 0 0 18px var(--vu-high), 0 0 40px rgba(255,255,255,.12); }
    .bottom { display: grid; gap: 12px; }
    .progress { height: 8px; border-radius: 999px; background: rgba(255,255,255,.10); overflow: hidden; }
    .progress span { display: block; height: 100%; width: 0%; border-radius: inherit; background: var(--accent); transition: width 250ms linear; }
	    .control-row { display: flex; align-items: center; gap: 9px; min-height: 42px; }
	    .audio-panel { color: #d8d8d8; }
	    .audio-panel audio { display: none; }
	    .audio-panel,
	    .transport-panel,
	    .message,
	    .ticker {
	      transition: opacity 420ms ease, transform 420ms ease;
	    }
    .icon-button { appearance: none; width: 42px; height: 42px; display: inline-grid; place-items: center; flex: 0 0 auto; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(255,255,255,.065); color: #f5f5f5; font: inherit; line-height: 0; }
    .icon-button svg { width: 20px; height: 20px; display: block; fill: none; stroke: currentColor; stroke-width: 2.15; stroke-linecap: round; stroke-linejoin: round; }
    .icon-button:focus { outline: 2px solid var(--accent); outline-offset: 3px; }
    .icon-button.primary { color: #050505; background: #f5f5f5; border-color: #f5f5f5; }
    .icon-button.wide { width: 52px; }
    .icon-button:disabled { opacity: .46; }
    .pin-gate { position: fixed; inset: 0; z-index: 50; display: none; place-items: center; background: rgba(0,0,0,.78); backdrop-filter: blur(6px); }
    .pin-gate.visible { display: grid; }
    .pin-gate-card { width: min(360px, 86vw); padding: 28px; border-radius: 16px; background: #121212; border: 1px solid rgba(255,255,255,.14); box-shadow: 0 30px 90px rgba(0,0,0,.6); text-align: center; }
    .pin-gate-card h2 { margin: 0 0 8px; font-size: 20px; }
    .pin-gate-card p { margin: 0 0 16px; color: #aaa; font-size: 14px; }
    .pin-gate-card input { width: 100%; box-sizing: border-box; padding: 12px; font-size: 22px; letter-spacing: .3em; text-align: center; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); background: #050505; color: #f5f5f5; }
    .pin-gate-card button { margin-top: 14px; width: 100%; padding: 12px; border-radius: 10px; border: none; background: #f5f5f5; color: #050505; font: inherit; font-weight: 700; cursor: pointer; }
    .pin-gate-error { margin-top: 10px; color: #f87171; font-size: 13px; min-height: 16px; }
    .audio-status { min-width: 0; color: #aaa; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .transport-panel { justify-content: center; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .message { min-height: 58px; max-height: 94px; display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 12px; align-items: start; color: #ddd; font-size: 18px; line-height: 1.28; }
    .provider-badge { width: 44px; height: 44px; display: grid; place-items: center; border-radius: 9px; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.12); overflow: hidden; color: #f5f5f5; font-size: 10px; font-weight: 800; letter-spacing: .08em; }
    .provider-badge img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .provider-badge.logo { background: #050505; }
    body[data-logo-mode="off"] .provider-badge { display: none; }
    body[data-logo-mode="off"] .message { grid-template-columns: minmax(0, 1fr); }
    body[data-logo-mode="prominent"] .message { grid-template-columns: 58px minmax(0, 1fr); }
    body[data-logo-mode="prominent"] .provider-badge { width: 58px; height: 58px; }
    .message-copy { min-width: 0; display: grid; gap: 6px; }
    .message-text { max-height: 46px; overflow: auto; scrollbar-width: none; }
    .message-text::-webkit-scrollbar { display: none; }
    .meta { color: #999; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ticker { height: 28px; overflow: hidden; color: rgba(255,255,255,.78); font-size: 16px; white-space: nowrap; mask-image: linear-gradient(to right, transparent, #000 8%, #000 92%, transparent); }
    .ticker span { display: inline-block; min-width: 100%; padding-left: 100%; animation: tickerScroll 28s linear infinite; }
    .ticker[hidden] { display: none; }
    @keyframes tickerScroll {
      from { transform: translateX(0); }
      to { transform: translateX(-100%); }
    }
    body[data-caption-mode="off"] .message-copy { display: none; }
    body[data-caption-mode="off"] .message { grid-template-columns: auto; justify-content: start; }
    body[data-caption-mode="full"] .message-text { max-height: 72px; }
    body[data-visualizer-style="none"] .visualizer { visibility: hidden; }
    body[data-visualizer-style="vuDots"] .visualizer { align-items: center; }
    body[data-visualizer-style="vuDots"] .bar { width: clamp(10px, 1.4vw, 24px); border-radius: 999px; }
    body[data-visualizer-style="spectrumLine"] .visualizer { align-items: center; gap: 3px; }
    body[data-visualizer-style="spectrumLine"] .bar { width: clamp(8px, 1vw, 16px); border-radius: 999px; }
    .album-art {
      position: fixed;
      right: clamp(22px, 3vw, 48px);
      top: clamp(96px, 12vh, 150px);
      z-index: 1;
      width: clamp(108px, 13vw, 190px);
      aspect-ratio: 1;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,.14);
      object-fit: cover;
      opacity: 0;
      transform: translateY(8px) scale(.98);
      box-shadow: 0 20px 80px rgba(0,0,0,.62);
      transition: opacity 450ms ease, transform 450ms ease;
    }
    body[data-album-art-mode="corner"] .album-art,
    body[data-album-art-mode="ambient"] .album-art,
    body[data-album-art-mode="hero"] .album-art { opacity: .92; transform: translateY(0) scale(1); }
    body[data-album-art-mode="hero"] .album-art { width: clamp(170px, 22vw, 310px); top: 50%; transform: translateY(-50%) scale(1); opacity: .95; }
    body[data-tv-layout="ambient"] .track-copy { opacity: .72; }
    body[data-tv-layout="artHero"] .track-copy { max-width: 58vw; }
    body[data-tv-layout="lowHud"] main { grid-template-rows: auto 1fr auto; }
    body[data-tv-focus="albumArt"] .album-art { opacity: .98; }
    @media (max-width: 780px) {
      main { padding: 22px; }
      .top { grid-template-columns: 1fr; }
      .status-lights { justify-content: flex-start; }
      h1 { max-width: 100%; }
    }
  </style>
</head>
<body data-vu-style="bars" data-album-art-mode="corner">
	  <div id="pinGate" class="pin-gate">
	    <div class="pin-gate-card">
	      <h2>Enter TV control PIN</h2>
	      <p>Find this PIN in Youtopia under Settings &rsaquo; Integrations &rsaquo; Companion server.</p>
	      <input id="pinGateInput" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="000000" />
	      <button id="pinGateSubmit" type="button">Unlock</button>
	      <div id="pinGateError" class="pin-gate-error"></div>
	    </div>
	  </div>
	  <div id="albumArtBackdrop" class="album-art-backdrop" aria-hidden="true"></div>
	  <canvas id="scene" aria-hidden="true"></canvas>
	  <img id="albumArt" class="album-art" alt="" hidden />
	  <main>
	    <section class="top">
	      <div class="track-copy">
	        <div class="eyebrow">Youtopia TV</div>
        <h1 id="title">Loading</h1>
        <p class="artist" id="artist">Waiting for Youtopia</p>
      </div>
      <div class="status-lights" aria-label="System status">
        <span id="vu" class="status-light" role="img" aria-label="VU unknown" title="VU unknown"></span>
        <span id="ai" class="status-light" role="img" aria-label="AI idle" title="AI idle"></span>
        <span id="lights" class="status-light" role="img" aria-label="Lights unknown" title="Lights unknown"></span>
      </div>
    </section>
    <section id="visualizer" class="visualizer" aria-hidden="true"></section>
    <section class="bottom">
      <div class="progress"><span id="progress"></span></div>
      <div class="audio-panel control-row">
        <audio id="tvAudio" preload="none"></audio>
        <audio id="djGptAudio" autoplay></audio>
        <button id="audioConnect" class="icon-button primary" type="button" aria-label="Connect audio" title="Connect audio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 0 1 13.7-5.7"/><path d="M18 3v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7"/><path d="M6 21v-4h4"/></svg>
          <span class="sr-only">Connect audio</span>
        </button>
        <button id="audioMute" class="icon-button" type="button" aria-label="Mute TV" title="Mute TV">
          <svg data-icon="volume" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l6 5V5l-6 5H4z"/><path d="M17 9.5a4 4 0 0 1 0 5"/></svg>
          <span class="sr-only">Mute TV</span>
        </button>
        <button id="audioResync" class="icon-button" type="button" aria-label="Resync audio" title="Resync audio">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 0 1-15.3 6.4"/><path d="M3 12A9 9 0 0 1 18.3 5.6"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/></svg>
          <span class="sr-only">Resync audio</span>
        </button>
        <button id="djGptConnect" class="icon-button" type="button" aria-label="Start DJ-GPT voice" title="Start DJ-GPT voice">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/><path d="M8 22h8"/></svg>
          <span class="sr-only">Start DJ-GPT voice</span>
        </button>
        <button id="audioDelayDown" class="icon-button" type="button" aria-label="Decrease audio delay" title="Decrease audio delay">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M9 6l-6 6 6 6"/></svg>
          <span class="sr-only">Decrease audio delay</span>
        </button>
        <button id="audioDelayUp" class="icon-button" type="button" aria-label="Increase audio delay" title="Increase audio delay">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="M15 6l6 6-6 6"/></svg>
          <span class="sr-only">Increase audio delay</span>
        </button>
        <span id="audioStatus" class="audio-status">TV audio idle</span>
      </div>
      <div class="transport-panel control-row">
        <button class="icon-button" data-command="previous" type="button" aria-label="Previous track" title="Previous track">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14"/><path d="M19 6l-10 6 10 6V6z"/></svg>
          <span class="sr-only">Previous track</span>
        </button>
        <button class="icon-button primary wide" data-command="playPause" type="button" aria-label="Play or pause" title="Play or pause">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l9-7-9-7z"/><path d="M18 5v14"/></svg>
          <span class="sr-only">Play or pause</span>
        </button>
        <button class="icon-button" data-command="next" type="button" aria-label="Next track" title="Next track">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14"/><path d="M5 6l10 6-10 6V6z"/></svg>
          <span class="sr-only">Next track</span>
        </button>
        <button class="icon-button" data-command="volumeDown" type="button" aria-label="Volume down" title="Volume down">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l6 5V5l-6 5H4z"/><path d="M18 12h3"/></svg>
          <span class="sr-only">Volume down</span>
        </button>
        <button class="icon-button" data-command="volumeUp" type="button" aria-label="Volume up" title="Volume up">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l6 5V5l-6 5H4z"/><path d="M18 9v6"/><path d="M15 12h6"/></svg>
          <span class="sr-only">Volume up</span>
        </button>
        <button class="icon-button" data-command="toggleLike" type="button" aria-label="Like" title="Like">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/><path d="M7 11l4-8a3 3 0 0 1 3 3v4h5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 21H7V11z"/></svg>
          <span class="sr-only">Like</span>
        </button>
      </div>
      <div class="message">
        <div id="providerBadge" class="provider-badge"><span id="providerFallback">...</span><img id="providerLogo" alt="" hidden /></div>
        <div class="message-copy">
          <div id="message" class="message-text">Open Youtopia and start playback.</div>
          <div id="meta" class="meta">No lightshow data yet.</div>
        </div>
      </div>
      <div id="ticker" class="ticker" hidden><span id="tickerText"></span></div>
    </section>
	  </main>
	  <script>
	    const PIN_STORAGE_KEY = "youtopiaTvControlPin";
	    const pinGate = document.getElementById("pinGate");
	    const pinGateInput = document.getElementById("pinGateInput");
	    const pinGateSubmit = document.getElementById("pinGateSubmit");
	    const pinGateError = document.getElementById("pinGateError");
	    let pendingPinRetry = null;
	    function getCachedPin() {
	      return localStorage.getItem(PIN_STORAGE_KEY) || "";
	    }
	    function controlHeaders() {
	      const pin = getCachedPin();
	      return pin ? { "X-Tv-Control-Pin": pin } : {};
	    }
	    function showPinGate(retry) {
	      pendingPinRetry = retry || null;
	      pinGateError.textContent = "";
	      pinGateInput.value = "";
	      pinGate.classList.add("visible");
	      pinGateInput.focus();
	    }
	    function hidePinGate() {
	      pinGate.classList.remove("visible");
	      pendingPinRetry = null;
	    }
	    async function submitPinGate() {
	      const pin = pinGateInput.value.trim();
	      if (!pin) {
	        pinGateError.textContent = "Enter the PIN shown in Youtopia settings.";
	        return;
	      }
	      localStorage.setItem(PIN_STORAGE_KEY, pin);
	      const retry = pendingPinRetry;
	      hidePinGate();
	      if (retry) await retry();
	    }
	    pinGateSubmit.addEventListener("click", submitPinGate);
	    pinGateInput.addEventListener("keydown", event => {
	      if (event.key === "Enter") submitPinGate();
	    });
	    const canvas = document.getElementById("scene");
	    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
	    let canvasW = 0;
	    let canvasH = 0;
	    let dpr = 1;
	    function resizeCanvas() {
	      const nextDpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
	      const rect = canvas.getBoundingClientRect();
	      const nextW = Math.max(1, Math.floor(rect.width * nextDpr));
	      const nextH = Math.max(1, Math.floor(rect.height * nextDpr));
	      dpr = nextDpr;
	      if (canvasW === nextW && canvasH === nextH) return;
	      canvasW = nextW;
	      canvasH = nextH;
	      canvas.width = canvasW;
	      canvas.height = canvasH;
	    }
	    window.addEventListener("resize", resizeCanvas, { passive: true });
	    resizeCanvas();

	    const bars = Array.from({ length: 32 }, () => {
	      const bar = document.createElement("div");
	      bar.className = "bar fallback";
	      bar.style.height = "12%";
      document.getElementById("visualizer").appendChild(bar);
      return bar;
    });
	    let targetBins = [];
	    let displayBins = Array.from({ length: bars.length }, () => 0);
	    const VU_SMOOTHING_ATTACK = 0.34;
	    const VU_SMOOTHING_RELEASE = 0.14;
	    let latestState = null;
	    let lastEventAt = 0;
	    let fallbackPoll = null;
	    let lastAppliedStateSignature = "";
	    let lastAlbumArtUrl = "";
	    let lastTickerMessage = "";
	    let lastThemeSignature = "";
	    let lastProvider = "";
	    let sceneKey = "";
	    let sceneStartAt = Date.now();
	    let lastFrameAt = Date.now();
	    let sceneEnergy = 0;
	    let scene = null;
	    const tvAudio = document.getElementById("tvAudio");
	    const djGptAudio = document.getElementById("djGptAudio");
	    const audioConnect = document.getElementById("audioConnect");
	    const audioMute = document.getElementById("audioMute");
	    const audioResync = document.getElementById("audioResync");
	    const djGptConnect = document.getElementById("djGptConnect");
	    const audioDelayDown = document.getElementById("audioDelayDown");
	    const audioDelayUp = document.getElementById("audioDelayUp");
	    const audioStatus = document.getElementById("audioStatus");
	    let audioConnected = false;
	    let audioDelayMs = 0;
	    let pendingAudioConnect = null;
	    let audioStatusTimer = null;
	    let djGptPeerConnection = null;
	    let djGptDataChannel = null;
	    function statusLightClass(status, okValue) {
	      if (status === okValue || status === "connected" || status === "applied") return "status-light ok";
	      if (status === "planning") return "status-light busy";
	      if (status === "failed") return "status-light bad";
	      return "status-light";
    }
    function setStatusLight(id, label, className) {
      const el = document.getElementById(id);
      if (el.className !== className) el.className = className;
      if (el.title !== label) el.title = label;
      if (el.getAttribute("aria-label") !== label) el.setAttribute("aria-label", label);
    }
    function updateTextIfChanged(id, value) {
      const el = document.getElementById(id);
      const next = String(value || "");
      if (el.textContent !== next) el.textContent = next;
    }
    function providerName(provider) {
      const normalized = String(provider || "").toLowerCase();
      if (normalized === "openai") return "OpenAI";
      if (normalized === "ollama") return "Ollama";
      return "Lightshow";
    }
    function providerShort(provider) {
      const normalized = String(provider || "").toLowerCase();
      if (normalized === "openai") return "OA";
      if (normalized === "ollama") return "OL";
      return "LS";
    }
    function applyProviderBadge(provider) {
      const normalized = String(provider || "").toLowerCase();
      if (lastProvider === normalized) return;
      lastProvider = normalized;
      const badge = document.getElementById("providerBadge");
      const logo = document.getElementById("providerLogo");
      const fallback = document.getElementById("providerFallback");
      fallback.textContent = providerShort(normalized);
      if (normalized === "openai") {
        logo.hidden = false;
        logo.src = "/tv/provider-logo/openai";
        badge.classList.add("logo");
        fallback.hidden = true;
        return;
      }
      logo.hidden = true;
      logo.removeAttribute("src");
      badge.classList.remove("logo");
      fallback.hidden = false;
    }
    function lightLabel(lightss) {
      if (lightss.wledStatus === "failed" || lightss.lightStatus === "failed") return "Lights failed";
      if (lightss.lightStatus === "applied") return "Lights live";
      if (lightss.wledStatus === "connected") return "Lights connected";
      return "Lights unknown";
    }
    function lightStatusClass(lightss) {
      if (lightss.wledStatus === "failed" || lightss.lightStatus === "failed") return "status-light bad";
      if (lightss.lightStatus === "applied" || lightss.wledStatus === "connected") return "status-light ok";
      return "status-light";
    }
	    function safeHex(value, fallback) {
	      return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : fallback;
	    }
	    function hexToRgba(hex, alpha) {
	      const safe = safeHex(hex, "#ffffff").replace("#", "");
	      const r = parseInt(safe.slice(0, 2), 16);
	      const g = parseInt(safe.slice(2, 4), 16);
	      const b = parseInt(safe.slice(4, 6), 16);
	      return "rgba(" + r + "," + g + "," + b + "," + Math.max(0, Math.min(1, alpha)) + ")";
	    }
	    function clamp01(value) {
	      return Math.min(1, Math.max(0, value));
	    }
	    function lerp(a, b, t) {
	      return a + (b - a) * t;
	    }
	    function xmur3(str) {
	      let h = 1779033703 ^ str.length;
	      for (let i = 0; i < str.length; i++) {
	        h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
	        h = (h << 13) | (h >>> 19);
	      }
	      return function() {
	        h = Math.imul(h ^ (h >>> 16), 2246822507);
	        h = Math.imul(h ^ (h >>> 13), 3266489909);
	        h ^= h >>> 16;
	        return h >>> 0;
	      };
	    }
	    function mulberry32(seed) {
	      return function() {
	        let t = (seed += 0x6D2B79F5);
	        t = Math.imul(t ^ (t >>> 15), t | 1);
	        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	      };
	    }
	    function stableStringify(value) {
	      if (value === null || value === undefined) return String(value);
	      const t = typeof value;
	      if (t === "string") return JSON.stringify(value);
	      if (t === "number" || t === "boolean") return String(value);
	      if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
	      if (t === "object") {
	        const keys = Object.keys(value).sort();
	        return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
	      }
	      return JSON.stringify(String(value));
	    }
	    function normalizeVisualScene(visualScene, theme, state) {
	      // Lightss emits a strict visualScene, but keep this permissive for stale plans.
	      const src = visualScene && typeof visualScene === "object" ? visualScene : {};
	      const backgroundStyle = src.backgroundStyle === "gradient" ? "gradient" : "solid";
	      const visualizerStyle =
	        src.visualizerStyle === "vuDots" || src.visualizerStyle === "spectrumLine" || src.visualizerStyle === "none" ? src.visualizerStyle : "vuBars";
	      const fallbackVuStyle = state && state.appearance && typeof state.appearance.vuMeterStyle === "number" ? ["bars", "classicLed", "dotMatrix", "spectrumLine", "albumGlow"][state.appearance.vuMeterStyle] : "bars";
	      const vuStyle =
	        src.vuStyle === "classicLed" || src.vuStyle === "dotMatrix" || src.vuStyle === "spectrumLine" || src.vuStyle === "albumGlow" ? src.vuStyle : fallbackVuStyle;
	      const motion = src.motion === "static" || src.motion === "medium" ? src.motion : "slow";
	      const speed = motion === "static" ? 0.12 : motion === "medium" ? 0.72 : 0.38;
	      const density = typeof src.density === "number" ? Math.max(0, Math.min(100, Math.round(src.density))) : 55;
	      const intensity = typeof src.intensity === "number" ? clamp01(src.intensity / 100) : 0.6;
	      const logoMode = src.logoMode === "off" || src.logoMode === "prominent" ? src.logoMode : "small";
	      const captionMode = src.captionMode === "off" || src.captionMode === "full" ? src.captionMode : "minimal";
	      const albumArtMode = src.albumArtMode === "off" || src.albumArtMode === "hero" || src.albumArtMode === "ambient" ? src.albumArtMode : "corner";
	      const primary = safeHex(theme && theme.vuHighColor, "#ef4444");
	      const secondary = safeHex(theme && theme.vuLowColor, "#22c55e");
	      const accent = safeHex(theme && theme.vuMidColor, "#facc15");
	      const bg = "#000000";
	      const seedStr =
	        backgroundStyle + "|" + visualizerStyle + "|" + vuStyle + "|" + albumArtMode + "|" + motion + "|" + density + "|" + intensity + "|" + (state && state.player ? state.player.title + "|" + state.player.artist : "");
	      const seed = xmur3(seedStr || stableStringify(src) || "default")();
	      const baseConfig = { backgroundStyle, visualizerStyle, vuStyle, speed, density, intensity, logoMode, captionMode, albumArtMode, primary, secondary, accent, bg, seed };
	      const director = deriveTvDirector(baseConfig, state);
	      return { backgroundStyle, visualizerStyle, vuStyle, speed, density, intensity, logoMode, captionMode, albumArtMode, primary, secondary, accent, bg, seed, director };
	    }
	    function normalizeTvDirector(input, visualConfig, state) {
	      const src = input && typeof input === "object" ? input : {};
	      const fallbackDirector = { objectFamily: "ribbons" };
	      const visualizer = visualConfig.visualizerStyle;
	      const vuStyle = visualConfig.vuStyle;
	      let objectFamily = fallbackDirector.objectFamily;
	      if (src.objectFamily === "halos" || src.objectFamily === "orbits" || src.objectFamily === "spectrumField" || src.objectFamily === "albumGlow" || src.objectFamily === "minimal") {
	        objectFamily = src.objectFamily;
	      } else if (visualizer === "spectrumLine") {
	        objectFamily = "spectrumField";
	      } else if (vuStyle === "albumGlow" || visualConfig.albumArtMode === "ambient") {
	        objectFamily = "albumGlow";
	      } else if (visualConfig.density > 72) {
	        objectFamily = "orbits";
	      } else if (visualConfig.intensity > 0.72) {
	        objectFamily = "halos";
	      }

	      let layout = src.layout === "ambient" || src.layout === "artHero" || src.layout === "lowHud" ? src.layout : "standard";
	      if (visualConfig.albumArtMode === "hero") layout = "artHero";
	      if (objectFamily === "minimal") layout = "ambient";

	      const focus = src.focus === "albumArt" || src.focus === "visualizer" || src.focus === "caption" ? src.focus : "track";
	      const hudMode = src.hudMode === "visible" || src.hudMode === "ambient" ? src.hudMode : "transient";
	      const density = typeof src.density === "number" ? Math.max(0, Math.min(100, Math.round(src.density))) : visualConfig.density;
	      const intensitySource = typeof src.intensity === "number" ? src.intensity : Math.round(visualConfig.intensity * 100);
	      const intensity = Math.max(0, Math.min(78, Math.round(intensitySource)));
	      const isPlaying = Boolean(state && state.player && state.player.isPlaying);
	      return { objectFamily, layout, focus, hudMode, density, intensity, isPlaying };
	    }
	    function deriveTvDirector(visualConfig, state) {
	      return normalizeTvDirector(null, visualConfig, state);
	    }
	    function initScene(config) {
	      const rand = mulberry32(config.seed);
	      const particleCount = Math.round(lerp(28, 120, config.density / 100));
	      const particles = Array.from({ length: particleCount }, () => {
	        const r = lerp(8, 90, Math.pow(rand(), 2.4));
	        return {
	          x: rand(),
	          y: rand(),
	          r,
	          vx: lerp(-0.020, 0.020, rand()),
	          vy: lerp(-0.015, 0.015, rand()),
	          a: lerp(0.05, 0.16, rand())
	        };
	      });
	      const ribbons = Array.from({ length: 4 }, (_v, i) => ({
	        phase: rand() * Math.PI * 2,
	        band: i,
	        width: lerp(0.12, 0.26, rand())
	      }));
	      return { config, rand, particles, ribbons };
	    }
	    function applyVisualScene(visualScene, theme, state) {
	      const key = stableStringify({ visualScene: visualScene || null, theme: theme || null, track: state && state.player ? state.player.title + "|" + state.player.artist : "" });
	      if (key === sceneKey && scene) return;
	      sceneKey = key;
	      sceneStartAt = Date.now();
	      lastFrameAt = sceneStartAt;
	      const config = normalizeVisualScene(visualScene, theme, state);
	      scene = initScene(config);
	      document.body.dataset.logoMode = config.logoMode;
	      document.body.dataset.captionMode = config.captionMode;
	      document.body.dataset.visualizerStyle = config.visualizerStyle;
	      document.body.dataset.vuStyle = config.vuStyle;
	      document.body.dataset.albumArtMode = config.albumArtMode;
	      document.body.dataset.backgroundStyle = config.backgroundStyle;
	      document.body.dataset.tvObjectFamily = config.director.objectFamily;
	      document.body.dataset.tvLayout = config.director.layout;
	      document.body.dataset.tvFocus = config.director.focus;
	    }
	    function applyDisplayTheme(theme) {
	      if (!theme) return;
	      const themeSignature = stableStringify(theme);
	      if (themeSignature === lastThemeSignature) return;
	      lastThemeSignature = themeSignature;
	      const root = document.documentElement;
	      const fontFamily = theme.fontFamily === "display" || theme.fontFamily === "mono" ? theme.fontFamily : "system";
	      document.body.dataset.font = fontFamily;
      root.style.setProperty("--tv-bg", "#000000");
      root.style.setProperty("--accent", safeHex(theme.accentColor, "#ef4444"));
      root.style.setProperty("--vu-low", safeHex(theme.vuLowColor, "#22c55e"));
      root.style.setProperty("--vu-mid", safeHex(theme.vuMidColor, "#facc15"));
      root.style.setProperty("--vu-high", safeHex(theme.vuHighColor, "#ef4444"));
    }
	    function applyState(state) {
	      latestState = state;
	      lastEventAt = Date.now();
	      targetBins = Array.isArray(state.audio.bins) ? state.audio.bins.slice(0, bars.length) : [];
	        const lightss = state.lightss || {};
	        const stateSignature = stableStringify({
	          title: state.player.title,
	          artist: state.player.artist,
	          progressPercent: Math.round(Number(state.player.progressPercent || 0) * 10) / 10,
	          albumArtUrl: state.player.albumArtUrl || "",
	          audioLive: Boolean(state.audio.live),
	          isPlaying: Boolean(state.player.isPlaying),
	          aiStatus: lightss.aiStatus || "",
	          wledStatus: lightss.wledStatus || "",
	          lightStatus: lightss.lightStatus || "",
	          provider: lightss.provider || "",
	          model: lightss.model || "",
	          message: lightss.message || "",
	          hostLine: lightss.hostLine || "",
	          tickerMessage: lightss.tickerMessage || ""
	        });
	        applyDisplayTheme(lightss.displayTheme);
	        applyVisualScene(lightss.visualScene, lightss.displayTheme, state);
	        if (stateSignature === lastAppliedStateSignature) return;
	        lastAppliedStateSignature = stateSignature;
	        updateTextIfChanged("title", state.player.title);
	        updateTextIfChanged("artist", state.player.artist);
	        const progress = document.getElementById("progress");
	        const progressWidth = (Math.round(Number(state.player.progressPercent || 0) * 10) / 10) + "%";
	        if (progress.style.width !== progressWidth) progress.style.width = progressWidth;
	        const albumArtUrl = String(state.player.albumArtUrl || "");
	        if (albumArtUrl !== lastAlbumArtUrl) {
	          lastAlbumArtUrl = albumArtUrl;
	          const albumArt = document.getElementById("albumArt");
	          const albumArtBackdrop = document.getElementById("albumArtBackdrop");
	          if (albumArtUrl) {
	            albumArt.hidden = false;
	            albumArt.src = albumArtUrl;
	            albumArtBackdrop.style.backgroundImage = "url(" + JSON.stringify(albumArtUrl).slice(1, -1) + ")";
	          } else {
	            albumArt.hidden = true;
	            albumArt.removeAttribute("src");
	            albumArtBackdrop.style.backgroundImage = "none";
	          }
	        }
	        applyProviderBadge(lightss.provider);
	        const label = providerName(lightss.provider);
	        setStatusLight(
	          "vu",
	          state.audio.live ? "VU live" : state.player.isPlaying ? "VU fallback" : "VU idle",
	          state.audio.live ? "status-light ok" : state.player.isPlaying ? "status-light warn" : "status-light"
	        );
	        setStatusLight("ai", lightss.aiStatus ? label + " " + lightss.aiStatus : label + " idle", statusLightClass(lightss.aiStatus, "connected"));
	        setStatusLight("lights", lightLabel(lightss), lightStatusClass(lightss));
	        updateTextIfChanged("message", lightss.hostLine || lightss.message || "Waiting for AI lightshow status.");
	        updateTextIfChanged("meta", lightss.provider && lightss.model ? lightss.provider + " / " + lightss.model : "No provider status yet.");
	        const tickerMessage = String(lightss.tickerMessage || "").trim();
	        const ticker = document.getElementById("ticker");
	        const tickerText = document.getElementById("tickerText");
	        ticker.hidden = tickerMessage.length === 0;
	        if (tickerMessage !== lastTickerMessage) {
	          lastTickerMessage = tickerMessage;
	          tickerText.textContent = tickerMessage ? tickerMessage + "   /   " + tickerMessage : "";
	        }
	    }
    async function pollState() {
      try {
        const response = await fetch("/tv/state", { cache: "no-store" });
        applyState(await response.json());
      } catch (error) {
        setStatusLight("ai", "TV disconnected", "status-light bad");
      }
    }
	    function setAudioStatus(text, state) {
	      audioStatus.textContent = text;
	      audioStatus.dataset.state = state || "idle";
	    }
	    function setButtonLabel(button, label) {
	      button.setAttribute("aria-label", label);
	      button.setAttribute("title", label);
	      const sr = button.querySelector(".sr-only");
	      if (sr) sr.textContent = label;
	    }
	    function getPreferredAudioFormat() {
	      return tvAudio.canPlayType("audio/webm; codecs=opus") ? "webm" : "mp3";
	    }
	    async function syncTvAudioStatus() {
	      try {
	        const response = await fetch("/tv/audio/status", { cache: "no-store" });
	        const status = await response.json();
	        if (!status.available) {
	          setAudioStatus(status.ffmpegAvailable ? "Audio source unavailable" : "ffmpeg unavailable", "bad");
	          audioConnect.disabled = !status.ffmpegAvailable;
	          return;
	        }
	        if (!audioConnected) {
	          setAudioStatus("Ready: " + status.source, "ready");
	        }
	      } catch (error) {
	        setAudioStatus("Audio status unavailable", "bad");
	      }
	    }
	    async function sendTvControl(command) {
	      try {
	        const response = await fetch("/tv/control", {
	          method: "POST",
	          headers: Object.assign({ "Content-Type": "application/json" }, controlHeaders()),
	          body: JSON.stringify({ command })
	        });
	        if (response.status === 401) {
	          showPinGate(() => sendTvControl(command));
	          return;
	        }
	        if (!response.ok) throw new Error("control failed");
	        setAudioStatus("Sent " + command, "ok");
	      } catch (error) {
	        setAudioStatus("Control failed: " + command, "bad");
	      }
	    }
	    async function connectDjGptVoice() {
	      if (djGptPeerConnection) {
	        djGptPeerConnection.close();
	        djGptPeerConnection = null;
	        djGptDataChannel = null;
	        setButtonLabel(djGptConnect, "Start DJ-GPT voice");
	        setAudioStatus("DJ-GPT voice stopped", "ready");
	        return;
	      }
	      if (!window.RTCPeerConnection) {
	        setAudioStatus("DJ-GPT voice unavailable", "bad");
	        return;
	      }
	      const pc = new RTCPeerConnection();
	      djGptPeerConnection = pc;
	      djGptDataChannel = pc.createDataChannel("oai-events");
	      pc.addTransceiver("audio", { direction: "recvonly" });
	      pc.ontrack = event => {
	        const stream = event.streams[0];
	        if (stream) djGptAudio.srcObject = stream;
	      };
	      pc.onconnectionstatechange = () => {
	        if (pc.connectionState === "failed" || pc.connectionState === "closed" || pc.connectionState === "disconnected") {
	          if (djGptPeerConnection === pc) {
	            djGptPeerConnection = null;
	            djGptDataChannel = null;
	            setButtonLabel(djGptConnect, "Start DJ-GPT voice");
	          }
	        }
	      };
	      djGptDataChannel.onopen = () => {
	        setButtonLabel(djGptConnect, "Stop DJ-GPT voice");
	        setAudioStatus("DJ-GPT voice live", "ok");
	        djGptDataChannel.send(
	          JSON.stringify({
	            type: "response.create",
	            response: {
	              modalities: ["audio", "text"],
	              instructions:
	                "Give one tight radio-DJ style break for the current song. If it is an intro, talk to the post. If not, keep it short and between the music."
	            }
	          })
	        );
	      };
	      try {
	        const offer = await pc.createOffer();
	        await pc.setLocalDescription(offer);
	        const response = await fetch("/tv/dj-gpt/session", {
	          method: "POST",
	          headers: Object.assign({ "Content-Type": "application/sdp" }, controlHeaders()),
	          body: offer.sdp || ""
	        });
	        if (response.status === 401) {
	          pc.close();
	          if (djGptPeerConnection === pc) {
	            djGptPeerConnection = null;
	            djGptDataChannel = null;
	          }
	          setButtonLabel(djGptConnect, "Start DJ-GPT voice");
	          showPinGate(() => connectDjGptVoice());
	          return;
	        }
	        if (!response.ok) throw new Error(await response.text());
	        const answer = { type: "answer", sdp: await response.text() };
	        await pc.setRemoteDescription(answer);
	        setAudioStatus("Starting DJ-GPT voice...", "busy");
	      } catch (error) {
	        pc.close();
	        if (djGptPeerConnection === pc) {
	          djGptPeerConnection = null;
	          djGptDataChannel = null;
	        }
	        setButtonLabel(djGptConnect, "Start DJ-GPT voice");
	        setAudioStatus("DJ-GPT voice failed", "bad");
	      }
	    }
	    async function connectTvAudio() {
	      audioConnected = true;
	      tvAudio.src = "/tv/audio?format=" + getPreferredAudioFormat() + "&ts=" + Date.now();
	      tvAudio.muted = false;
	      setButtonLabel(audioMute, "Mute TV");
	      audioConnect.disabled = true;
	      setAudioStatus("Connecting TV audio...", "busy");
	      try {
	        await tvAudio.play();
	        audioConnect.disabled = false;
	        setButtonLabel(audioConnect, "Reconnect audio");
	        setAudioStatus("TV audio connected", "ok");
	      } catch (error) {
	        audioConnected = false;
	        audioConnect.disabled = false;
	        setButtonLabel(audioConnect, "Connect audio");
	        setAudioStatus("Select Connect Audio again", "bad");
	      }
	    }
	    function scheduleDelayedAudioConnect() {
	      if (pendingAudioConnect) {
	        clearTimeout(pendingAudioConnect);
	        pendingAudioConnect = null;
	      }
	      if (audioDelayMs <= 0) {
	        connectTvAudio();
	        return;
	      }
	      setAudioStatus("Starting TV audio in " + audioDelayMs + "ms", "busy");
	      pendingAudioConnect = setTimeout(() => {
	        pendingAudioConnect = null;
	        connectTvAudio();
	      }, audioDelayMs);
	    }
	    function resyncTvAudio() {
	      if (!audioConnected) {
	        scheduleDelayedAudioConnect();
	        return;
	      }
	      const wasMuted = tvAudio.muted;
	      tvAudio.pause();
	      tvAudio.removeAttribute("src");
	      tvAudio.load();
	      tvAudio.muted = wasMuted;
	      scheduleDelayedAudioConnect();
	    }
	    function disconnectTvAudio() {
	      audioConnected = false;
	      if (pendingAudioConnect) {
	        clearTimeout(pendingAudioConnect);
	        pendingAudioConnect = null;
	      }
	      tvAudio.pause();
	      tvAudio.removeAttribute("src");
	      tvAudio.load();
	    }
	    audioConnect.addEventListener("click", scheduleDelayedAudioConnect);
	    djGptConnect.addEventListener("click", connectDjGptVoice);
	    audioMute.addEventListener("click", () => {
	      tvAudio.muted = !tvAudio.muted;
	      setButtonLabel(audioMute, tvAudio.muted ? "Unmute TV" : "Mute TV");
	      setAudioStatus(tvAudio.muted ? "TV audio muted" : "TV audio connected", tvAudio.muted ? "ready" : "ok");
	    });
	    audioResync.addEventListener("click", resyncTvAudio);
	    audioDelayDown.addEventListener("click", () => {
	      audioDelayMs = Math.max(0, audioDelayMs - 250);
	      setAudioStatus("Audio delay " + audioDelayMs + "ms", "ready");
	    });
	    audioDelayUp.addEventListener("click", () => {
	      audioDelayMs = Math.min(3000, audioDelayMs + 250);
	      setAudioStatus("Audio delay " + audioDelayMs + "ms", "ready");
	    });
	    tvAudio.addEventListener("playing", () => setAudioStatus("TV audio connected", "ok"));
	    tvAudio.addEventListener("waiting", () => setAudioStatus("Buffering TV audio...", "busy"));
	    tvAudio.addEventListener("error", () => {
	      audioConnected = false;
	      setAudioStatus("TV audio stream failed", "bad");
	    });
	    window.addEventListener("pagehide", disconnectTvAudio);
	    window.addEventListener("beforeunload", disconnectTvAudio);
	    document.querySelectorAll("[data-command]").forEach(button => {
	      button.addEventListener("click", () => sendTvControl(button.dataset.command));
	    });
	    // Bridge for the native Fire TV WebView shell: remote keys route through here so
	    // they reuse the PIN-aware control path (header + PIN gate) instead of issuing
	    // unauthenticated POSTs that the PIN-protected endpoint now rejects.
	    window.youtopiaTvControl = function (command) {
	      const allowed = ["playPause", "previous", "next", "volumeUp", "volumeDown", "toggleLike"];
	      if (allowed.indexOf(String(command)) !== -1) sendTvControl(String(command));
	    };
	    audioStatusTimer = setInterval(syncTvAudioStatus, 5000);
	    syncTvAudioStatus();
	    function shapeBin(raw) {
	      // Byte FFT energy clusters in the low bins, leaving the upper meter near zero.
	      // A gentle perceptual curve plus modest makeup gain lets the whole meter track
	      // the music without turning quiet passages into a wall of full bars.
	      const norm = Math.max(0, Math.min(1, raw / 255));
	      const shaped = Math.pow(norm, 0.62) * 1.18;
	      return Math.max(0, Math.min(1, shaped)) * 255;
	    }
	    function render() {
	      const state = latestState;
	      const live = Boolean(state && state.audio.live && Date.now() - lastEventAt < 1500);
	      bars.forEach((bar, index) => {
	        const rawTarget = live && targetBins.length ? targetBins[Math.min(targetBins.length - 1, Math.floor(index * targetBins.length / bars.length))] : 20 + ((index % 8) * 7);
	        const target = live ? shapeBin(rawTarget) : rawTarget;
	        const smoothing = target > displayBins[index] ? VU_SMOOTHING_ATTACK : VU_SMOOTHING_RELEASE;
	        displayBins[index] += (target - displayBins[index]) * smoothing;
	        const level = Math.max(4, Math.round((displayBins[index] / 255) * 100));
	        bar.style.height = level + "%";
	        bar.classList.toggle("fallback", !live);
	      });
	      // Immersive canvas background: deterministic scene seeded from state.lightss.visualScene (if present).
	      if (ctx && canvasW && canvasH) {
	        const now = Date.now();
	        const dt = Math.max(0.001, Math.min(0.05, (now - lastFrameAt) / 1000));
	        lastFrameAt = now;
	        const lightss = state && state.lightss ? state.lightss : null;
	        const theme = lightss ? lightss.displayTheme : null;
	        const baseEnergy = live ? displayBins.reduce((sum, v) => sum + v, 0) / (displayBins.length * 255) : 0.12;
	        sceneEnergy = lerp(sceneEnergy, clamp01(baseEnergy), 0.06);

	        if (!scene) {
	          scene = initScene(normalizeVisualScene(null, theme, state));
	        }

	        resizeCanvas();

	        const cfg = scene.config;
	        const t = (now - sceneStartAt) / 1000;

	        ctx.save();
	        ctx.setTransform(1, 0, 0, 1, 0, 0);
	        ctx.clearRect(0, 0, canvasW, canvasH);

	        // True black base. Scene color is layered above, never used as the root page color.
	        ctx.fillStyle = "#000000";
	        ctx.fillRect(0, 0, canvasW, canvasH);

	        if (cfg.backgroundStyle === "gradient") {
	          const g = ctx.createLinearGradient(0, 0, canvasW, canvasH);
	          g.addColorStop(0, cfg.secondary);
	          g.addColorStop(0.5, "#000000");
	          g.addColorStop(1, cfg.primary);
	          ctx.save();
	          ctx.globalAlpha = lerp(0.035, 0.09, cfg.intensity);
	          ctx.fillStyle = g;
	          ctx.fillRect(0, 0, canvasW, canvasH);
	          ctx.restore();
	        }

	        const v = ctx.createRadialGradient(canvasW * 0.5, canvasH * 0.55, Math.min(canvasW, canvasH) * 0.18, canvasW * 0.5, canvasH * 0.55, Math.max(canvasW, canvasH) * 0.78);
	        v.addColorStop(0, "rgba(0,0,0,0)");
	        v.addColorStop(1, "rgba(0,0,0,0.55)");
	        ctx.fillStyle = v;
	        ctx.fillRect(0, 0, canvasW, canvasH);

	        const director = cfg.director || deriveTvDirector(cfg, state);
	        const objectFamily = director.objectFamily;
	        const directorIntensity = clamp01(director.intensity / 100);
	        if (objectFamily === "halos" || objectFamily === "albumGlow") {
	          const haloCount = objectFamily === "albumGlow" ? 2 : 3;
	          ctx.globalCompositeOperation = "screen";
	          for (let i = 0; i < haloCount; i++) {
	            const cx = canvasW * (0.5 + Math.sin(t * cfg.speed * 0.18 + i) * 0.12);
	            const cy = canvasH * (0.48 + Math.cos(t * cfg.speed * 0.15 + i * 1.7) * 0.10);
	            const radius = Math.min(canvasW, canvasH) * (0.24 + i * 0.12 + sceneEnergy * 0.05);
	            const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
	            hg.addColorStop(0, i % 2 ? hexToRgba(cfg.secondary, 0.10 * directorIntensity) : hexToRgba(cfg.primary, 0.10 * directorIntensity));
	            hg.addColorStop(1, "rgba(0,0,0,0)");
	            ctx.fillStyle = hg;
	            ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
	          }
	        }
	        if (objectFamily === "orbits") {
	          ctx.globalCompositeOperation = "screen";
	          const orbitCount = Math.round(lerp(8, 26, director.density / 100));
	          for (let i = 0; i < orbitCount; i++) {
	            const angle = (i / orbitCount) * Math.PI * 2 + t * cfg.speed * 0.12;
	            const radius = Math.min(canvasW, canvasH) * (0.18 + (i % 5) * 0.055);
	            const px = canvasW * 0.5 + Math.cos(angle) * radius * 1.8;
	            const py = canvasH * 0.52 + Math.sin(angle * 0.72) * radius;
	            ctx.fillStyle = i % 2 ? hexToRgba(cfg.secondary, 0.13 * directorIntensity) : hexToRgba(cfg.primary, 0.13 * directorIntensity);
	            ctx.beginPath();
	            ctx.arc(px, py, Math.max(2.4 * dpr, 5 * dpr * lerp(0.7, 1.25, sceneEnergy)), 0, Math.PI * 2);
	            ctx.fill();
	          }
	        }
	        if (objectFamily === "spectrumField" && live && targetBins.length) {
	          ctx.globalCompositeOperation = "screen";
	          const rows = 3;
	          for (let row = 0; row < rows; row++) {
	            ctx.beginPath();
	            for (let i = 0; i < displayBins.length; i++) {
	              const x = (i / Math.max(1, displayBins.length - 1)) * canvasW;
	              const level = displayBins[i] / 255;
	              const y = canvasH * (0.38 + row * 0.13) - level * canvasH * (0.10 + row * 0.025);
	              if (i === 0) ctx.moveTo(x, y);
	              else ctx.lineTo(x, y);
	            }
	            ctx.strokeStyle = row % 2 ? hexToRgba(cfg.secondary, 0.11 * directorIntensity) : hexToRgba(cfg.accent, 0.16 * directorIntensity);
	            ctx.lineWidth = Math.max(1.2, (2 + row) * dpr);
	            ctx.stroke();
	          }
	        }

	        // Ribbons: slow-moving sine bands. Designed to avoid strobe/blink effects.
	        const speed = cfg.speed * 0.55;
	        const bandAmp = lerp(0.12, 0.22, sceneEnergy) * Math.min(canvasW, canvasH);
	        const ribbonAlpha = lerp(0.035, 0.10, cfg.intensity) * lerp(0.45, 0.9, sceneEnergy);
	        ctx.globalCompositeOperation = "screen";
	        ctx.lineCap = "round";
	        ctx.lineJoin = "round";
	        for (const rb of scene.ribbons) {
	          if (cfg.visualizerStyle === "none") break;
	          ctx.beginPath();
	          const yBase = canvasH * (0.24 + rb.band * 0.18);
	          const phase = rb.phase + t * speed * (0.6 + rb.band * 0.25);
	          const waveLen = lerp(0.9, 1.6, rb.band / 3);
	          const step = Math.max(18, Math.floor(24 * dpr));
	          for (let x = -step; x <= canvasW + step; x += step) {
	            const nx = x / canvasW;
	            const y =
	              yBase +
	              Math.sin((nx * Math.PI * 2) * waveLen + phase) * bandAmp * rb.width +
	              Math.sin((nx * Math.PI * 4) * (waveLen * 0.6) + phase * 0.7) * bandAmp * rb.width * 0.22;
	            if (x <= 0) ctx.moveTo(x, y);
	            else ctx.lineTo(x, y);
	          }
	          ctx.strokeStyle = "rgba(255,255,255," + ribbonAlpha + ")";
	          ctx.lineWidth = Math.max(2.5 * dpr, bandAmp * 0.010);
	          ctx.stroke();
	          ctx.strokeStyle = "rgba(255,255,255," + (ribbonAlpha * 0.55) + ")";
	          ctx.lineWidth = Math.max(1.2 * dpr, bandAmp * 0.006);
	          ctx.stroke();
	        }

	        // Particles: slow drift, brightness smoothed with audio energy.
	        const tint = lerp(0.04, 0.14, sceneEnergy) * cfg.intensity;
	        const accentAlpha = lerp(0.02, 0.07, sceneEnergy) * cfg.intensity;
	        ctx.globalCompositeOperation = "lighter";
	        for (const p of scene.particles) {
	          p.x = (p.x + p.vx * dt * (0.4 + sceneEnergy) * cfg.speed) % 1;
	          p.y = (p.y + p.vy * dt * (0.35 + sceneEnergy) * cfg.speed) % 1;
	          if (p.x < 0) p.x += 1;
	          if (p.y < 0) p.y += 1;
	          const px = p.x * canvasW;
	          const py = p.y * canvasH;
	          const pr = p.r * dpr * lerp(0.85, 1.15, sceneEnergy);
	          const pg = ctx.createRadialGradient(px, py, 0, px, py, pr);
	          pg.addColorStop(0, "rgba(255,255,255," + (p.a * tint) + ")");
	          pg.addColorStop(0.55, "rgba(255,255,255," + (p.a * tint * 0.35) + ")");
	          pg.addColorStop(1, "rgba(255,255,255,0)");
	          ctx.fillStyle = pg;
	          ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
	        }

	        if (cfg.visualizerStyle === "spectrumLine" && live && targetBins.length) {
	          ctx.globalCompositeOperation = "screen";
	          ctx.beginPath();
	          for (let i = 0; i < displayBins.length; i++) {
	            const x = (i / Math.max(1, displayBins.length - 1)) * canvasW;
	            const level = displayBins[i] / 255;
	            const y = canvasH * 0.56 - level * canvasH * 0.24;
	            if (i === 0) ctx.moveTo(x, y);
	            else ctx.lineTo(x, y);
	          }
	          ctx.strokeStyle = cfg.accent;
	          ctx.globalAlpha = 0.32;
	          ctx.lineWidth = Math.max(2, 3 * dpr);
	          ctx.stroke();
	        }

	        ctx.globalCompositeOperation = "screen";
	        ctx.fillStyle = cfg.accent;
	        ctx.globalAlpha = accentAlpha;
	        ctx.fillRect(0, 0, canvasW, canvasH);

	        ctx.restore();
	      }
	      requestAnimationFrame(render);
	    }
    function connectEvents() {
      if (!window.EventSource) {
        fallbackPoll = setInterval(pollState, 250);
        pollState();
        return;
      }
      const source = new EventSource("/tv/events");
      source.onmessage = event => applyState(JSON.parse(event.data));
      source.onerror = () => {
        source.close();
        if (!fallbackPoll) {
          fallbackPoll = setInterval(pollState, 250);
        }
      };
    }
    connectEvents();
    render();
  </script>
</body>
</html>`;
}

function getProviderLogoPath(provider: string): string | null {
  if (provider !== "openai") return null;

  const logoPath =
    process.env.NODE_ENV === "development"
      ? path.join(app.getAppPath(), "src/assets/provider-logos/openai.png")
      : path.join(process.resourcesPath, "openai.png");

  return fs.existsSync(logoPath) ? logoPath : null;
}
