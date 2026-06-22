# ADR-0003 — DSP implementation: ffmpeg filtergraph vs. in-process Node DSP

**Status:** Accepted · **Date:** 2026-06-20 · **Deciders:** Architecture Lead, PM

## Context

The DSP/enrichment chain must provide a 30-band EQ, compressor, limiter/expander, noise reduction,
stereo/sound expansion, and accurate beat detection — **all AI-adjustable** through the
`DspParamDescriptor` model — and feed VU/beat telemetry to visualization + lightss. The server is
Node/TS and already uses ffmpeg for audio capture/transcode.

Options:
- **A. Pure in-process Node DSP** (e.g. Web-Audio-style graph / WASM filters).
- **B. ffmpeg filtergraph** per session (firequalizer/superequalizer, acompressor, alimiter, afftdn,
  extrastereo/stereotools, ebur128), with a small **native/Node beat detector** tapping the signal.
- **C. Native C++ addon DSP.**

## Decision

**B — ffmpeg filtergraph as the DSP backbone**, one graph per `Session`, with a lightweight beat
detector (onset/tempo) tapping the pre-output PCM. Each `DspNode` maps its `DspParamDescriptor`
values onto ffmpeg filter parameters and re-clamps defensively. Canonical order:
EQ (`superequalizer`/`firequalizer`, 30 bands) → compressor (`acompressor`) → expander
(`acompressor`/`agate` in expand mode) → limiter (`alimiter`) → noise reduction (`afftdn`) → stereo
expansion (`extrastereo`/`stereotools`), with `ebur128`/level metering and the beat tap in parallel.

## Rationale

- ffmpeg already ships every needed filter, is battle-tested, deterministic, and we already depend on
  it — no hand-rolled DSP math, no native build toolchain on the appliance.
- Filter params map cleanly to bounded scalars, which is exactly what the AI-describable
  `DspParamDescriptor` (min/max/step/unit) expresses — easy to clamp/allowlist (mirrors lightss
  `clampNumber`).
- Reconfiguring a filtergraph (or sendcmd) lets the AI change parameters live without restarting the
  stream in most cases.
- Pure-Node DSP would re-implement mature filters at higher risk and CPU cost; a native addon adds
  build/packaging complexity against little benefit for personal-scale loads.

## Consequences

- Some effects (e.g. true graphic-EQ vs. parametric, advanced NR) are bounded by what ffmpeg offers;
  acceptable for v1. Higher-end NR/expansion can later move to a dedicated filter or model.
- Live parameter changes prefer `sendcmd`/graph reconfig; where a filter can't update live, the
  engine rebuilds the graph with a short crossfade to avoid clicks (respects no-hard-cut spirit).
- Beat detection is **our** component (not ffmpeg) so we control accuracy + `BeatTelemetry`
  (bpm/confidence/phase) for visual sync; it taps PCM pre-output.
- DSP runs **per session**, so concurrent users get independent chains (more CPU; fine at home
  scale, watched by R4 latency budget).
