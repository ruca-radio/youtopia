# YouTopia — Intelligent Music Server Architecture

**Status:** Approved for build · **Branch:** `feat/intelligent-music-server` · **Date:** 2026-06-20
**Owner:** Architecture Lead · **Audience:** Pods A–D + PM

## 1. System context & goals

YouTopia today is an Electron/Vue desktop YouTube Music player (a ytmdesktop fork) with a Fastify
**companion server** on `:9863` exposing a `/tv` SSE/HLS surface, a native **Fire TV** WebView
receiver, and a **lightss** AI pipeline that plans WLED scenes + TV visual themes from the current
song. This project evolves that into a **standalone, agentic-AI Intelligent Music Server** that runs
as its own VM/OS appliance on Proxmox (HAOS-style) and serves the whole home.

**Goals**

1. **Multi-source audio** — YouTube Music (primary) + Amazon Music + local MP3/FLAC/WAV behind one
   pluggable `AudioSource` interface and a unified metadata model.
2. **Pro, AI-adjustable DSP/enrichment chain** — 30-band EQ, compressor, limiter/expander, noise
   reduction, stereo/sound expansion, accurate beat detection, plus lyrics + artist/album/song
   metadata and context, and optional music videos. Every parameter is describable and settable by
   an AI agent.
3. **Lighting + visualization** — reuse the existing `lightss` AI pipeline and WLED control with all
   hard safety rules intact.
4. **Stream audio+video to in-home clients** — Fire TV, Roku, iOS, Android, Web.
5. **Agentic AI** — users ask or type requests; the agent reads available controls and acts within
   allowlists/clamps.
6. **Multi-room + multi-user** — same content synced to multiple rooms (Sonos-like) **and**
   per-login independent streams (Patrick vs. spouse, different programs at once).

**Non-goals (this initiative)**

- Not a commercial/broadcast service; **personal LAN use only.** Licensing is not a current blocker.
- Not re-implementing the Fire TV receiver as a full renderer — it stays a thin WebView shell.
- Native Roku/iOS/Android **apps are design-only** in the first passes; Web + Fire TV are the first
  real clients.
- No public internet exposure in v1 (LAN/VPN only).
- No DRM circumvention claims; Amazon HD/DRM paths are explicitly deprioritized (see §6, ADR-0002).

## 2. High-level component diagram

```
                         YouTopia Intelligent Music Server (Proxmox VM appliance)
  +-------------------------------------------------------------------------------------------+
  |  API EDGE (Fastify + socket.io + SSE, PIN/token auth, rate limit)   [reuse companion conv.]|
  |      REST /api/v1/*      socket.io control      SSE now-playing/VU      HLS / progressive   |
  +-----------------------------------+-------------------------------------------------------+
                                      |
   +----------------+   +-------------v-------------+   +---------------------+  +-------------+
   | AudioSource    |   |   Session Engine          |   |  DSP / Enrichment   |  |  AI         |
   | Registry       |   |   (per-user Sessions,     |   |  Chain (per-Session)|  | Controller  |
   |  - YTMusic     |==>|    queue, transport)      |==>|  EQ>Comp>Exp>Lim>   |  | (lightss    |
   |  - Amazon      |   |   Room/Zone manager       |   |  NR>StereoExp +     |  | provider    |
   |  - Local       |   |   SyncClock (snapcast-ish)|   |  BeatDetector tap)  |  | pipeline)   |
   +-------+--------+   +-------------+-------------+   +----------+----------+  +------+------+
           |                          |                            |                   |
           | ffmpeg/yt-dlp            | mix + schedule             | ffmpeg filtergraph| reads
           v                          v                            v  / native nodes   v param
   +-------+--------+        +--------+---------+        +----------+----------+  descriptors,
   | source streams |        | Transcoder /     |        | VU + Beat analyzer  |  emits intents
   | (URL/manifest/ |------->| Packager (ffmpeg)|------->| (perceptual FFT)    |--> lightss/WLED
   |  file/capture) |        | Opus/AAC/MP3/PCM |        +---------------------+
   +----------------+        +--------+---------+
                                      |  per-Room transport: HLS | HTTP-progressive | sync-PCM
   ------------------------------- LAN (10.27.27.0/24) -------------------------------------------
        |                |                |               |                 |
   +----v---+      +-----v----+     +-----v----+    +-----v-----+     +-----v-----+
   | Fire TV|      |  Web      |    |  iOS     |    | Android   |     |  Roku      |
   | receiver|     |  client   |    | (design) |    | (design)  |     | (design)   |
   +--------+      +-----------+     +----------+    +-----------+     +-----------+

   External on LAN:  WLED 10.27.27.110   Ollama 10.27.27.10:11434 (kimi-k2.7-code:cloud)
```

## 3. Deployment topology (Proxmox appliance)

- The server ships as a **Proxmox VM appliance** (debian-based cloud image, see ADR-0001 packaging),
  exposed as a single systemd-managed Node service plus a bundled Python sidecar venv (ytmusicapi)
  and `ffmpeg`/`yt-dlp` binaries. Phase 1 may run as an `electron-forge`-built deb/container on the
  existing host; the appliance image is a Later-phase deliverable.
- **LAN addressing (from AGENTS.md, kept stable):**
  - Server API: `:9863` initially (drop-in for companion), migrating to `:9870` for the new
    `/api/v1` surface while `/tv` stays compatible during migration.
  - WLED controller: `http://10.27.27.110`.
  - Ollama inference: `http://10.27.27.10:11434`, model `kimi-k2.7-code:cloud` (default agent
    provider; OpenAI/OpenRouter/Gemini selectable, reusing lightss provider config).
  - Fire TV receiver: `10.27.27.207:5555` (ADB), loads the TV/program surface.
  - Current TV page host: `10.27.27.96:9863/tv`.
- **Data plane:** Source audio is pulled (yt-dlp/HTTP/file) into ffmpeg, run through the DSP chain,
  then packaged per-Room as HLS (Fire TV/Roku/web compatibility), low-delay HTTP-progressive Opus
  (matches today's `/tv/audio`), or synchronized PCM for multi-room Zones.
- **Control plane:** REST + socket.io + SSE on the API edge. PIN/token auth reused from
  `api-shared/auth.ts`. No internet ingress; access over LAN/VPN.

## 4. Phased roadmap (Now / Next / Later)

**Phase 0 — PM setup (done):** branch, planning files, conventions.

**Now (this initiative)**
1. **Architecture + contracts (this pod).** Master spec, `server/CONTRACTS.md` + `server/src/
   contracts/*.ts`, PRD, ADRs. *Blocks everything.*
2. **Pod A — Server skeleton.** `server/` scaffold (Fastify+socket.io+SSE), config/store, plugin
   loader + `AudioSourceRegistry`, auth/rate-limit, Session Engine host, event bus, Proxmox
   packaging stub. Implements the API edge against `api.ts`.
3. **Pod B — Multi-source engine.** `AudioSource` adapters: Local (full), YouTube Music
   (ytmusicapi metadata + yt-dlp stream), Amazon Music (control/library + capture fallback per
   ADR-0002); library index for local files.
4. **Pod C — DSP suite.** `DspChain` + nodes (ffmpeg filtergraph backbone, native beat detector),
   enrichment providers (lyrics/metadata), AI-describable param descriptors, VU/beat telemetry.

**Next**
5. **Pod D — Multi-room/user.** Session/Room/Zone runtime + `SyncClock` (snapcast-style), Web
   client (first real non-TV client), per-login independent streams, Fire TV migrated to `/api/v1`
   program surface.
6. **Integration.** Typecheck/lint, reconcile, PR(s); migrate `/tv` consumers; AI chat end-to-end
   (text requests adjust DSP + transport + lighting).

**Later**
7. Proxmox VM/OS appliance image (cloud-init, systemd, auto-update); Roku/iOS/Android native
   clients; optional music-video pipeline; HD/lossless Amazon path if a viable route appears;
   spatial/multi-zone scene choreography across WLED segments.

## 5. Technology choices & rationale

| Concern | Choice | Rationale |
|---|---|---|
| Server runtime | **Node 22 + TypeScript** | Reuse existing TS types + the lightss AI pipeline; one language across desktop, server, contracts. |
| HTTP / realtime | **Fastify 5 + socket.io + SSE** | Already the companion-server stack (`@fastify/rate-limit`, typebox, fastify-socket.io). SSE proven for ~15 fps VU. |
| Media processing | **ffmpeg** (transcode/package/filtergraph) + **yt-dlp** | Already the project's audio-capture pattern; ffmpeg gives EQ/comp/limiter/expander filters and HLS/Opus packaging in one tool. |
| YTM extraction | **ytmusicapi (Python sidecar)** for metadata/search/lyrics + **yt-dlp** for stream URLs | Mature, maintained; cookie/OAuth auth. See ADR-0002. |
| Amazon Music | **Control/library + system-audio capture fallback** | No headless official SDK (closed beta + Widevine DRM + device certification). See ADR-0002. |
| Local files | **music-metadata** for tags + ffmpeg transcode | Straightforward; lossless FLAC/WAV supported. |
| DSP location | **ffmpeg filtergraph per-session** (native beat detector in-proc) | Avoids hand-rolling DSP; deterministic, scriptable, AI-clampable. See ADR-0003. |
| Multi-room sync | **Snapcast-style: NTP-offset clock + global buffer + scheduled start** | Proven, simple, LAN-friendly; PCM transport for tight sync. See ADR-0004. |
| Client transport | **HLS (broad compat) + low-delay Opus progressive + sync-PCM for Zones** | Matches Fire TV today; picks per-client capability. See ADR-0005. |
| AI agent | **Reuse lightss multi-provider pipeline** (Ollama default, OpenAI/OpenRouter/Gemini) | Already wired, vision-capable, with safety prompts + allowlists. |
| Persistence | **conf-based store** (as desktop) + SQLite for local library index | Consistent with existing store schema; SQLite scales the music library. |

## 6. Reuse / migration of existing systems

- **Electron desktop app** — becomes a **client** of the server (and a dev host in Phase 1). The
  YTM BrowserView path is retired in favor of the headless source engine; the desktop UI can point
  at `/api/v1`. No rewrite of Vue UI required to start.
- **companion-server** — its conventions (Fastify, PIN auth in `api-shared/auth.ts`, rate limits,
  SSE `/tv/events` ~15 fps, HLS `/tv/program.m3u8`, low-delay `/tv/audio`) are **lifted into the new
  API edge**. `/tv` stays serving the existing TV page during migration; new clients use `/api/v1`.
- **lightss pipeline** — reused wholesale as the **AI brain**. Its provider plumbing (Ollama/OpenAI/
  OpenRouter/Gemini), `SAFE_EFFECTS`/`SAFE_PALETTES` allowlists, `clampNumber()` discipline, two-track
  sketch+full planning, and no-strobe rules become the server's AI controller + lighting executor.
  Beat/VU telemetry from the DSP chain feeds it the same `audioProfile`/`audioSignals` shape it
  already consumes.
- **Fire TV receiver** — unchanged thin WebView shell; repointed from `/tv` to the new program
  surface in the Next phase. Remote-key → control bridge maps to `TransportCommand`.
- **VU analyzer hub** — the perceptual-FFT binning approach is reused as the server-side `VuEvent`
  source, now per-Session.

## 7. Hard product rules (enforced, non-negotiable)

- **No strobe / blink / rapid flash / hard cuts.** Enforced in lightss (already) and in the AI
  controller's `AiSafetyRules`; scene changes use minimum transition durations.
- **TV true-black base;** background effects are low-alpha layers above black.
- **WLED primary color must match the TV VU hot color** (not white) — carried in the AI surface and
  lightss color strategy.
- **AI scene/DSP values pass allowlists + clamps** before reaching DOM/canvas/WLED/DSP — the
  `DspParamDescriptor` bounds and lightss `SAFE_*` lists are the enforcement points.

## 8. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | YTM/yt-dlp breakage from upstream changes | High | High | Pin + auto-update yt-dlp; isolate behind `AudioSource`; cache stream handles with `expiresAt`; health probe + UI status. |
| R2 | Amazon Music has no headless stream path (DRM) | High | Med | Control/library + capture fallback (ADR-0002); deprioritize HD; treat as Should-have, not Must. |
| R3 | Multi-room drift / clock skew | Med | High | Snapcast-style NTP offset + global buffer; clients report `ClientClockReport`; resync when out of bufferMs (ADR-0004). |
| R4 | DSP latency vs. live VU/lighting sync | Med | Med | ffmpeg filtergraph with bounded buffers; beat detector taps pre-output; expose latency budget per transport. |
| R5 | Audio/video sync drift on long sessions | Med | Med | Reuse `/tv` resync controls; wallclock anchoring; periodic re-anchor of `SyncClock`. |
| R6 | AI proposes unsafe/invalid DSP or lighting | Med | High | Descriptor clamps + allowlists; reject + log unsafe `AiIntent`s; no direct hardware writes. |
| R7 | Scope creep (5 client platforms) | High | Med | Web + Fire TV first; Roku/iOS/Android design-only until contracts proven. |
| R8 | Proxmox appliance packaging complexity | Med | Med | Phase 1 runs as deb/container on existing host; appliance image is a Later deliverable. |
| R9 | Python sidecar (ytmusicapi) operational fragility | Med | Med | Run as supervised subprocess with health check; cache metadata; fall back to yt-dlp metadata. |

## 9. Contracts reference

The cross-cutting interface contracts live in `server/src/contracts/*.ts` and are documented in
`server/CONTRACTS.md`. All pods compile against them. They are types/enums/route-tables only and
type-check standalone under `strict: true`. Key exports: `AudioSource`/`AudioSourceRegistry`,
`Track`/`Album`/`Artist`/`Playlist`/`StreamHandle`, `DspChain`/`DspNode`/`DspParamDescriptor`,
`EnrichmentProvider`/`Enrichment`, `Session`/`Room`/`Zone`/`SyncClock`/`NowPlaying`,
`AiController`/`AiControlSurface`/`AiIntent`, and `REST_ROUTES`/`SERVER_EVENTS`/`CLIENT_EVENTS`.

## 10. Open questions for PM

1. API port: keep `:9863` as drop-in vs. dedicated `:9870` for `/api/v1` during migration?
2. Amazon Music: confirm "control + capture fallback" is acceptable for v1 (no HD, no offline)?
3. Music videos: in or out for the first DSP/enrichment pass (currently optional/Later)?
4. Default agent provider on the appliance: Ollama `kimi-k2.7-code:cloud` (LAN, private) vs. a cloud
   provider for quality?
