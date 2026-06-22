# ADR-0004 — Multi-room sync: clock and buffer strategy

**Status:** Accepted · **Date:** 2026-06-20 · **Deciders:** Architecture Lead, PM

## Context

A `Zone` must play one `Session` across multiple `Room`s in tight, Sonos-like sync over the home LAN,
while other Zones/Sessions run independently. We need a clock + buffer model that keeps rooms aligned
without specialized hardware.

Options:
- **A. NTP-style offset + global buffer + scheduled start (snapcast model).** Server is the time
  anchor; each client measures its clock offset, buffers a fixed amount, and starts each audio
  segment at a server-scheduled wall-clock time.
- **B. RTP/RTCP** with sender reports.
- **C. HLS with synchronized start times** (align by media timeline + program-date-time).

## Decision

**A — snapcast-style NTP-offset + global buffer + scheduled start.** The server exposes a `SyncClock`
(`serverEpochMs`, `bufferMs`, `scheduledStartMs`). Each room runs a periodic NTP-style exchange
(T1..T4) to estimate `offsetMs`/`rttMs` and reports a `ClientClockReport`. The server hands a
`SyncClock` per zone; every room translates `scheduledStartMs` into its local clock using its offset,
buffers `bufferMs`, then begins playout of the segment at the same true instant. Synchronized Zones
use **PCM-over-TCP** transport (`TransportKind.SyncPcm`) so all rooms decode identical samples.

## Rationale

- The snapcast approach is proven for exactly this problem on a LAN, is simple to reason about, and
  matches our PCM transport choice for tight sync.
- A global buffer absorbs per-client network/decoder jitter: as long as every room's latency is
  within `bufferMs`, each room has a non-negative wait and starts together (the classic constraint).
- RTP/RTCP adds protocol weight and still needs a buffer/offset layer; HLS-synchronized-start has
  coarser alignment (segment granularity) and A/V drift over long streams — fine for single-room or
  TV, not for tight multi-room.

## Consequences

- A small fixed latency (the global `bufferMs`, e.g. ~300 ms) is added to synced playback — invisible
  for music listening, acceptable.
- The server periodically **re-anchors** `SyncClock` and emits `clock` events; if a room drifts
  beyond `bufferMs` it resyncs (drops/repeats a tiny amount or re-buffers) rather than running out of
  alignment (R3/R5).
- Standalone (non-Zone) rooms keep using HLS or low-delay Opus progressive (ADR-0005); the sync model
  only governs Zones.
- Clients must implement the NTP exchange + buffered, scheduled playout; this is part of the client
  contract surface (`ClientClockReport`, `clock` event). Web + Fire TV first.
