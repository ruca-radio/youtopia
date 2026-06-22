# ADR-0005 — Audio transport & codec to clients

**Status:** Accepted · **Date:** 2026-06-20 · **Deciders:** Architecture Lead, PM

## Context

The server streams DSP-processed audio (and optional video) to heterogeneous clients — Fire TV,
Roku, iOS, Android, Web — with different codec/transport support and latency needs. Some playback is
single-room/low-latency; some is tightly synced multi-room (ADR-0004). The existing TV path already
uses **HLS** for `/tv/program.m3u8` and **low-delay WebM/Opus (MP3 fallback)** for `/tv/audio`.

Options per dimension:
- **Transport:** HLS · low-delay HTTP-progressive · synchronized PCM-over-TCP.
- **Codec:** Opus · AAC · MP3 · FLAC · raw PCM.

## Decision

**Negotiate transport + codec per Room from its capabilities**, choosing from three modes:

1. **Low-delay HTTP-progressive Opus (default single-room).** WebM/Opus, MP3 fallback — exactly the
   proven `/tv/audio` pattern. Lowest startup latency for Web + Fire TV.
2. **HLS (broad-compatibility / video).** For Roku and clients that prefer adaptive HLS, and for the
   optional music-video program path. Matches today's `/tv/program.m3u8`.
3. **Synchronized PCM-over-TCP (multi-room Zones).** `TransportKind.SyncPcm` + `OutputCodec.Pcm`,
   driven by the `SyncClock` (ADR-0004), so every room in a Zone decodes identical samples in
   lock-step. FLAC offered for lossless single-room LAN playback where supported.

Codec preference order mirrors the existing convention: **Opus → AAC → MP3**, with **FLAC** for
lossless local/LAN and **PCM** for sync.

## Rationale

- Reuses the project's working, low-latency Opus path and HLS packaging — minimal new risk.
- One size does not fit all five clients: capability negotiation (`Room.transport`/`Room.codec`) lets
  each client get the best mode without forking the engine.
- PCM-for-sync is the natural pairing with the snapcast-style clock; compressed codecs complicate
  sample-accurate alignment.

## Consequences

- The packager (ffmpeg) maintains up to three output forms per active Session; cost is bounded at
  home scale and only spun up per active transport.
- A/V sync drift on long HLS sessions is mitigated by wallclock anchoring and the existing `/tv`
  resync controls (R5).
- The `Room` contract carries negotiated `transport`/`codec`; clients advertise capabilities on
  connect. Web + Fire TV implement modes 1–2 first; Zone sync (mode 3) lands with Pod D.
- Lossless FLAC and HD paths are best-effort and depend on source quality (YTM Premium AAC 256 kbps;
  Amazon capture is lossy by nature — see ADR-0002).
