# ADR-0001 — Standalone server appliance vs. extending the companion server

**Status:** Accepted · **Date:** 2026-06-20 · **Deciders:** Architecture Lead, PM

## Context

YouTopia's networked surface today is the Fastify **companion server** embedded inside the Electron
main process (`src/main/integrations/companion-server/index.ts`), serving `/tv`. The goal is a
standalone, multi-source, multi-room, multi-user **Intelligent Music Server** that runs as its own
Proxmox VM/OS appliance and serves the whole home — independent of any desktop session being open.

Options:
- **A. Extend the companion server in-process** inside Electron.
- **B. New standalone Node/TS server** in a `server/` dir, reusing companion conventions + the
  lightss pipeline, packaged to run headless on Proxmox. Electron becomes a client.

## Decision

**B — build a new standalone Node/TypeScript server** under `server/`, alongside the existing
Electron app and `firetv-receiver/` (monorepo, matching the `firetv-receiver/` precedent). It reuses
the companion server's stack and conventions (Fastify 5, socket.io, SSE, PIN/token auth, rate
limiting) and the lightss AI pipeline, but runs as its own headless service. The Electron desktop app
is repositioned as a client (and a Phase-1 dev host).

## Rationale

- The product must run **without a desktop session** (HAOS-style appliance) — incompatible with
  living in the Electron main process.
- Multi-user **independent sessions** and multi-room **Zones** need a server-owned runtime, not a
  per-window player.
- Reusing companion conventions + lightss keeps the migration cheap; we lift patterns, not rewrite.
- A clean `server/` boundary lets Pods A–D build against typed contracts in parallel.

## Consequences

- **Phase 1** runs the server as a deb/container on the existing host (`:9863` drop-in or `:9870`);
  the full Proxmox VM/OS **appliance image is a Later deliverable** (cloud-init + systemd +
  auto-update).
- The YTM BrowserView extraction path is retired in favor of the headless source engine (ADR-0002).
- `/tv` continues to serve during migration; new clients use `/api/v1`.
- Slightly more ops surface (a service to supervise) — accepted for the capability gain.
