# Session / Room / Zone Engine (Pod D)

Implements multi-user sessions and multi-room synchronized playback.

## Files

- `models.ts` — Factories for User, Session, Room, Zone
- `SessionManager.ts` — Per-user independent sessions with transport/queue/DSP
- `RoomManager.ts` — Room + Zone management, grouping, session binding
- `routes.ts` — REST handlers for all Pod D API routes
- `sockets.ts` — Socket.io event handlers for real-time control
- `index.ts` — Plugin registration entry point
- `__tests__/` — Node.js runnable tests (44 assertions)

## Related

- `../sync/SyncClock.ts` — Server-authoritative NTP-style clock engine
- `../sync/StreamScheduler.ts` — PCM chunk scheduler for synced Zone delivery

## Quick start

Import the plugin side-effect in `index.ts`:
```ts
import "./session/index.js";
```

This seeds 2 rooms + sessions (one per user in `config.auth.users`) and
registers all REST routes and socket handlers.

See `pm/architecture_handoff.md` for full handoff notes.
