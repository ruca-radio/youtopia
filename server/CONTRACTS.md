# YouTopia Intelligent Music Server — Cross-Pod Contracts

These are the **TypeScript interface contracts every engineering pod compiles against.**
They are **types, enums, and const route/event tables only** — no runtime logic. Pods import
from the barrel:

```ts
import {
  AudioSource, AudioSourceRegistry,
  Track, Album, Artist, Playlist, StreamHandle,
  DspChain, DspNode, DspParamDescriptor,
  EnrichmentProvider, Enrichment,
  Session, Room, Zone, SyncClock, NowPlaying,
  AiController, AiControlSurface, AiIntent,
  REST_ROUTES, SERVER_EVENTS, CLIENT_EVENTS,
  ServerToClientEvents, ClientToServerEvents
} from "../contracts";
```

> **Stability rule.** Changing an exported type here is a breaking change for every pod.
> Propose contract changes to the Architecture Lead / PM before editing. Add new optional
> fields rather than mutating existing ones where possible.

All files live under `server/src/contracts/`. They type-check standalone under `strict: true`.

---

## File map & ownership

| File | Exports (primary) | Consumed by |
|---|---|---|
| `enums.ts` | `SourceId`, `PlaybackState`, `RepeatMode`, `DspNodeType`, `DspParamType`, `EnrichmentKind`, `StreamDeliveryKind`, `OutputCodec`, `TransportKind`, `ClientKind`, `AiProvider`, `SourceCapability` | all pods |
| `media.ts` | `Track`, `Album`, `Artist`, `Playlist`, `MediaEntity`, `Artwork`, `MediaId`, `SearchQuery`, `SearchResult`, `StreamHandle`, `SourceDescriptor` | A, B, C, clients |
| `source.ts` | `AudioSource`, `AudioSourceRegistry`, `SourceHealth` | A (registry), B (adapters) |
| `dsp.ts` | `DspChain`, `DspNode`, `DspNodeState`, `DspParamDescriptor`, `DspParamPatch`, `EqualizerParams`, `CompressorParams`, `LimiterParams`, `ExpanderParams`, `NoiseReductionParams`, `StereoExpansionParams`, `BeatDetectionParams`, `BeatTelemetry` | C (impl), A (host), AI |
| `enrichment.ts` | `EnrichmentProvider`, `Enrichment`, `Lyrics`, `LyricLine`, `TrackContext`, `ArtistContext`, `MusicVideoRef` | C (impl), clients |
| `session.ts` | `User`, `Session`, `Room`, `Zone`, `SyncClock`, `ClientClockReport`, `Transport`, `QueueItem`, `NowPlaying` | A (host), D (rooms/zones), clients |
| `ai.ts` | `AiController`, `AiControlSurface`, `AiChatRequest`, `AiChatResponse`, `AiIntent`, `AiTransportAction`, `AiSafetyRules` | A (AI host), clients |
| `api.ts` | `REST_ROUTES`, `SERVER_EVENTS`, `CLIENT_EVENTS`, `ServerToClientEvents`, `ClientToServerEvents`, `TransportCommand`, `QueueAddCommand`, plus event payload types | A (routes), all clients |
| `index.ts` | barrel re-export of all of the above | everyone |

---

## The seven contract groups

### 1. AudioSource plugin (`source.ts` + `media.ts`)
`AudioSource` is the pluggable backend. YTM, Amazon, and Local each implement it; the engine
talks only to the interface via `AudioSourceRegistry`. Key methods: `search`, `getTrack/Album/
Artist/Playlist`, `getTrackIds`, `getStreamHandle` (returns a time-limited `StreamHandle` with a
`StreamDeliveryKind` — `DirectUrl`, `Manifest`, `LocalFile`, or `Capture`), `health`, optional
`getRadio`. Capabilities are advertised via `SourceCapability[]` so the router can skip
unsupported operations (e.g. Amazon may lack `PullableStream`).

### 2. Unified metadata models (`media.ts`)
Source-agnostic `Track` / `Album` / `Artist` / `Playlist`, all extending `MediaEntityBase`.
IDs are namespaced (`MediaId = "${source}:${kind}:${nativeId}"`) so any id routes back to its
source. `Track.isrc` lets the registry de-duplicate the same song across sources. Field names
match `src/shared/player.ts` (`durationSeconds`, `Artwork` ≈ `RendererThumbnail`).

### 3. DSP nodes + AI-describable params (`dsp.ts`)
`DspChain` holds ordered `DspNode`s (EQ → Compressor → Expander → Limiter → NoiseReduction →
StereoExpansion, with a parallel BeatDetector tap). **Every adjustable parameter is described by a
`DspParamDescriptor`** (key, label, `DspParamType`, unit, `min`/`max`/`step`, `default`,
`options`, `arrayLength`+`elementMin/Max` for the 30-band EQ). This is the JSON-schema-like model
the AI reads. `DspNode.setParams()` **must clamp to descriptor bounds and return the effective
values** — the same allowlist+clamp discipline as `lightss` `clampNumber()` / `SAFE_EFFECTS`.
`BeatTelemetry` (bpm/confidence/phase) is read-only output for visual sync and lightss.

### 4. Enrichment providers (`enrichment.ts`)
`EnrichmentProvider` supplies one or more `EnrichmentKind`s (lyrics, metadata, artist context,
music video). The engine merges all providers into one `Enrichment` bundle attached to
now-playing. `Lyrics` supports timed `LyricLine[]` for karaoke sync.

### 5. Player / Session / Room / Zone (`session.ts`)
- **User** = a login (Patrick, spouse).
- **Session** = an independent program (queue + `Transport` + DSP state) owned by one user.
- **Room** = a physical output endpoint/client device.
- **Zone** = a sync group of Rooms playing **one** Session in lock-step.

Multiple Sessions run concurrently (independent streams). A Zone binds to a Session for synced
multi-room. `SyncClock` (serverEpochMs + bufferMs + scheduledStartMs) and `ClientClockReport`
carry the snapcast-style NTP-offset clock model (see ADR-0004).

### 6. Server ↔ Client API (`api.ts`)
- **REST**: `REST_ROUTES` is the typed route manifest under `/api/v1` (discovery, catalog,
  sessions, transport, queue, dsp, rooms/zones, streaming, ai). Bodies: `TransportCommand`,
  `QueueAddCommand`, `DspParamPatch[]`, `AiChatRequest`.
- **Realtime**: `SERVER_EVENTS` / `CLIENT_EVENTS` name the socket.io + SSE channels.
  Payloads: `NowPlayingEvent`, `TransportEvent`, `VuEvent` (high-rate spectrum bins, like the
  existing `/tv/events` ~15 fps SSE), `BeatEvent`, `DspStateEvent`, `ZoneEvent`, `RoomEvent`,
  `ClockEvent`, `AiMessageEvent`, `SourceStatusEvent`. `ServerToClientEvents` /
  `ClientToServerEvents` are the strongly-typed socket.io maps.

### 7. AI control surface (`ai.ts`)
`AiController.describeSurface(sessionId)` builds an `AiControlSurface` — the full set of DSP
`DspParamDescriptor`s + allowed `AiTransportAction`s + `AiSafetyRules` — handed to the model
(reusing the lightss multi-provider pipeline). `AiController.handle()` returns an `AiChatResponse`
with validated, **already-clamped** `AiIntent[]`. The agent never writes DSP/hardware directly;
it emits intents the server validates against allowlists and descriptor bounds.

---

## Safety obligations baked into the contracts
- DSP: `setParams` clamps to `DspParamDescriptor` bounds (hard min/max) before applying.
- AI: `AiSafetyRules` (noStrobe, noBlinkingEffects, clampDspToDescriptorBounds,
  alignWledToVuHotColor, trueBlackTvBase) are enforced server-side; unsafe `AiIntent`s are
  rejected with a reason.
- Lighting intents are delegated to the existing `lightss` pipeline, which already enforces
  `SAFE_EFFECTS`/`SAFE_PALETTES`, min transition durations, and no-strobe.
