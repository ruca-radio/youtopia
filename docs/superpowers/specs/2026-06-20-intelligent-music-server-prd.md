# PRD — YouTopia Intelligent Music Server

**Status:** Draft for build · **Date:** 2026-06-20 · **Branch:** `feat/intelligent-music-server`
**Companion docs:** `2026-06-20-intelligent-music-server-architecture.md`, `server/CONTRACTS.md`, `adr/`

## Problem

YouTopia is a single-machine Electron desktop player tied to the YouTube Music web UI — which the
user dislikes — and to one output (the desktop + a Fire TV mirror). It cannot serve multiple sources,
cannot run pro audio enrichment, cannot stream independent programs to different people, and cannot
sync audio across rooms. The lightshow/visualization and AI brain are excellent but trapped inside
the desktop app. The user wants a **standalone home music server**: multi-source, AI-driven,
DSP-enriched, multi-room, multi-user, with beautiful clients.

## Goals

- One pluggable engine over **YouTube Music + Amazon Music + local files** with unified metadata.
- A **pro, AI-adjustable DSP chain** (30-band EQ, compressor, limiter/expander, noise reduction,
  stereo/sound expansion, accurate beat detection) + enrichment (lyrics, metadata/context, optional
  music videos).
- **Stream to in-home clients** (Fire TV + Web first; Roku/iOS/Android designed).
- **Agentic AI**: ask or type — the agent reads available controls and adjusts audio, transport,
  and lighting within safety allowlists/clamps.
- **Multi-room sync** (Sonos-like) **and** **per-login independent streams** (Patrick vs. spouse).
- Reuse the existing lightss WLED/visualization pipeline and all hard safety rules.
- Run as a **Proxmox VM/OS appliance** (HAOS-style) — eventually self-contained.

## Non-goals

- Commercial/broadcast use; public internet exposure (LAN/VPN only in v1).
- Re-implementing the Fire TV receiver as a full renderer (stays a thin WebView shell).
- Native Roku/iOS/Android apps in the first passes (design-only).
- DRM circumvention; Amazon HD/lossless/offline is out for v1.

## User stories

**Patrick (primary user / admin)**
- As Patrick, I search across YTM, Amazon, and my local FLACs from one search box and play any
  result without touching the YTM web UI.
- As Patrick, I type "tighten the bass and add a bit of air" and the AI adjusts the EQ low bands and
  high shelf within safe limits, telling me what it changed.
- As Patrick, I group the living room and kitchen into one Zone so the same song plays in sync, and
  the WLED + TV VU colors stay aligned with no strobing.
- As Patrick, I see synced lyrics, album/artist context, and a beat-locked visualization on the TV.

**Spouse (second user)**
- As the spouse, I log in on the bedroom display and play my **own** program (different song, queue,
  and EQ) at the same time Patrick is playing something else elsewhere — fully independent.
- As the spouse, I ask the agent for "something calm for reading" and get a fitting queue plus a
  calm, no-flash visualization.

**Shared / household**
- As either user, I move my session's playback to another room without restarting the track.
- As either user, the system recovers gracefully if a source (e.g. Amazon) is unavailable, showing
  clear status rather than failing silently.

## Requirements (MoSCoW)

**Must**
- `AudioSource` plugin model + unified `Track/Album/Artist/Playlist`; Local + YouTube Music working.
- Per-user `Session` with queue + transport; **concurrent independent sessions**.
- DSP chain with 30-band EQ, compressor, limiter/expander, noise reduction, stereo expansion, beat
  detection — all exposed via `DspParamDescriptor` and **AI-settable with clamps**.
- Enrichment: lyrics + song/artist/album metadata & context.
- Reused lightss WLED + visualization with all hard safety rules (no strobe, true black, color
  alignment, allowlists+clamps).
- Server↔client API (`REST_ROUTES` + socket.io/SSE events) and **Web + Fire TV clients**.
- AI chat: typed natural-language requests adjust DSP + transport + lighting.
- LAN-only auth (PIN/token, reused convention) + rate limiting.

**Should**
- Amazon Music via control/library + capture fallback (no HD).
- Multi-room **Zone** sync (snapcast-style clock) for at least 2 rooms.
- SQLite-backed local library index with fast search.
- Proxmox-deployable artifact (container/deb) on the existing host.

**Could**
- Optional music-video playback.
- Voice requests (reuse lightss realtime voice path).
- Roku/iOS/Android native clients (design now, build later).
- Cross-source de-duplication by ISRC.

**Won't (v1)**
- Amazon HD/lossless/offline; public internet access; commercial distribution; full Proxmox VM/OS
  appliance image (Later phase).

## Success metrics

- **Source coverage:** ≥ 95% of the user's everyday plays resolvable across YTM + local (Amazon
  best-effort).
- **AI control success:** ≥ 90% of in-scope NL requests produce a valid, safety-passing change with
  a correct human-readable summary; 0 safety-rule violations reach hardware/DOM.
- **Multi-room sync:** rooms in a Zone stay within the configured global buffer (target ≤ 50 ms
  perceived skew) over a 30-minute session.
- **Independent streams:** 2 concurrent user sessions run with no cross-talk and no shared-state
  bugs.
- **Latency:** low-delay client audio starts ≤ 2 s after play; VU/beat telemetry at ≥ 15 fps.
- **Reliability:** source/AI/WLED health surfaced; graceful degradation on any single failure.

## Open questions

1. API port strategy during `/tv` migration (`:9863` drop-in vs. new `:9870`).
2. Acceptable Amazon Music scope for v1 (control + capture, no HD)?
3. Music videos in the first enrichment pass or deferred?
4. Default agent provider on the appliance (private Ollama vs. cloud quality).
5. How many physical rooms/zones to target for the first multi-room milestone?
