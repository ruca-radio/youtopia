# ADR-0002 — How to obtain YouTube Music, Amazon Music, and local audio headlessly

**Status:** Accepted · **Date:** 2026-06-20 · **Deciders:** Architecture Lead, PM

## Context

The server is headless (no browser/BrowserView) and must source audio from three backends behind one
`AudioSource` interface. Personal LAN use; licensing is not a current blocker. Each source has very
different access realities (researched 2026-06-20).

- **YouTube Music** — no official streaming SDK for third-party playback. Two mature unofficial
  paths: **ytmusicapi** (Python) emulates the web client for search/browse/playlists/lyrics/metadata
  with cookie or OAuth (TV-device) auth; **yt-dlp** extracts the actual audio stream URL (best-audio,
  Opus/AAC; Premium cookies unlock 256 kbps).
- **Amazon Music** — the official **Web Playback API exists but is closed beta**, requires Amazon
  device certification, a security-profile `x-api-key`, **Widevine DRM** (DASH; only the first ~30 s
  is clear lead), and 1-hour-expiring stream URLs. Not viable for an uncertified headless appliance.
  Community projects (`pypi: amazon-music`, `Jaffa/amazon-music`) offer metadata/library/search and
  experimental stream/Widevine extraction, but are fragile and DRM-laden.
- **Local files** — trivial: index MP3/FLAC/WAV, read tags via `music-metadata`, transcode via
  ffmpeg.

## Decision

Implement each source as an `AudioSource` with capability flags, deciding access **per source**:

1. **Local (Must, full):** filesystem index (SQLite), `music-metadata` tags, ffmpeg transcode.
   `StreamDeliveryKind.LocalFile`, fully `Seekable` + `PullableStream`.
2. **YouTube Music (Must, full):** **ytmusicapi** (supervised Python sidecar) for search/browse/
   playlists/lyrics/metadata; **yt-dlp** for `getStreamHandle` → a `DirectUrl`/`Manifest`
   `StreamHandle` with `expiresAt` and any required headers/cookies. Caps include
   `PullableStream`, `Seekable`, `Lyrics`.
3. **Amazon Music (Should, degraded):** start **control/library + metadata** via a community client;
   for actual audio, use a **system-audio capture fallback** (`StreamDeliveryKind.Capture`) — the
   server captures the default sink monitor via ffmpeg/PipeWire (the exact pattern already used by
   `tv-audio-stream.ts`) while Amazon plays out-of-process. Advertise **without** `PullableStream`.
   **No HD/lossless/offline.** Revisit if a clean route appears.

## Rationale

- ytmusicapi + yt-dlp is the de-facto, maintained way to do headless YTM and matches the user's
  "YTM primary, hates the UI" goal directly.
- Amazon's only sanctioned path is gated behind certification + DRM we cannot satisfy on an
  appliance; capture is the pragmatic, robust fallback that still delivers sound to the DSP chain and
  clients. Keeping it behind capability flags means the rest of the system degrades gracefully.
- Local files are unconstrained and give us the highest-fidelity test/dev path.

## Consequences

- A **Python sidecar venv** (ytmusicapi) and the `yt-dlp` + `ffmpeg` binaries are appliance
  dependencies; the sidecar runs supervised with a health check (R9). yt-dlp must auto-update (R1).
- Stream handles are **time-limited**; the engine re-resolves on `expiresAt`.
- Amazon is explicitly a **Should**, not a Must; UI shows degraded status when capture-only.
- Capture-sourced audio is post-Amazon-DSP; our DSP chain still applies, but per-track seek/gapless
  is limited for that source.
