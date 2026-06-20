/**
 * YouTopia Intelligent Music Server — Server <-> Client API surface.
 *
 * The REST endpoint catalog and the WebSocket/SSE event names + payload types
 * every client (FireTV, Roku, iOS, Android, Web) and the desktop app compile
 * against. Transport follows existing conventions: Fastify REST, socket.io for
 * bi-directional control, SSE for high-rate now-playing/VU (matches the
 * /tv/events ~15 fps pattern in companion-server/index.ts). PIN/token auth is
 * reused from api-shared/auth.ts.
 *
 * This file declares the *shapes*; Pod A wires the actual routes/handlers.
 */

import type { SearchQuery, SearchResult, MediaId } from "./media";
import type { SourceDescriptor } from "./media";
import type { DspNodeState, DspParamPatch, BeatTelemetry } from "./dsp";
import type { Enrichment } from "./enrichment";
import type {
  NowPlaying,
  Room,
  Session,
  Transport,
  User,
  Zone,
  ClientClockReport,
  SyncClock,
  QueueItem
} from "./session";
import type { AiChatRequest, AiChatResponse, AiControlSurface } from "./ai";

/* ------------------------------------------------------------------ *
 * REST endpoint catalog
 * ------------------------------------------------------------------ *
 * Base path: /api/v1. All mutating routes require a bearer token; control
 * routes are rate-limited (mirrors companion-server). Documented here as a
 * typed manifest so clients and the server stay in sync.
 */

/** Canonical REST route table. Values are path templates. */
export const REST_ROUTES = {
  // --- discovery / health ---
  health: "GET /api/v1/health",
  sources: "GET /api/v1/sources", // -> SourceDescriptor[]
  // --- catalog ---
  search: "GET /api/v1/search", // ?q&kinds&limit -> SearchResult
  track: "GET /api/v1/tracks/:id",
  album: "GET /api/v1/albums/:id",
  artist: "GET /api/v1/artists/:id",
  playlist: "GET /api/v1/playlists/:id",
  enrichment: "GET /api/v1/tracks/:id/enrichment", // -> Enrichment
  // --- sessions (per-user independent programs) ---
  listSessions: "GET /api/v1/sessions",
  createSession: "POST /api/v1/sessions",
  getSession: "GET /api/v1/sessions/:sid",
  deleteSession: "DELETE /api/v1/sessions/:sid",
  nowPlaying: "GET /api/v1/sessions/:sid/now-playing", // -> NowPlaying
  // --- transport ---
  transport: "POST /api/v1/sessions/:sid/transport", // body: TransportCommand
  queueAdd: "POST /api/v1/sessions/:sid/queue", // body: QueueAddCommand
  queueReorder: "PUT /api/v1/sessions/:sid/queue",
  // --- dsp ---
  dspSnapshot: "GET /api/v1/sessions/:sid/dsp", // -> DspNodeState[]
  dspPatch: "POST /api/v1/sessions/:sid/dsp", // body: DspParamPatch[]
  // --- rooms / zones (multi-room sync) ---
  listRooms: "GET /api/v1/rooms",
  listZones: "GET /api/v1/zones",
  createZone: "POST /api/v1/zones",
  zoneMembers: "PUT /api/v1/zones/:zid/rooms", // body: { roomIds }
  bindZoneSession: "PUT /api/v1/zones/:zid/session", // body: { sessionId }
  clockReport: "POST /api/v1/rooms/:rid/clock", // body: ClientClockReport
  // --- streaming ---
  programManifest: "GET /api/v1/sessions/:sid/program.m3u8", // HLS
  programAudio: "GET /api/v1/sessions/:sid/audio", // low-delay progressive
  // --- ai ---
  aiSurface: "GET /api/v1/sessions/:sid/ai/surface", // -> AiControlSurface
  aiChat: "POST /api/v1/sessions/:sid/ai/chat" // body: AiChatRequest
} as const;

/** Transport command body for POST /sessions/:sid/transport. */
export type TransportCommand =
  | { op: "play" }
  | { op: "pause" }
  | { op: "next" }
  | { op: "previous" }
  | { op: "seek"; positionSeconds: number }
  | { op: "setVolume"; volume: number }
  | { op: "setMuted"; muted: boolean }
  | { op: "setRepeat"; repeat: Transport["repeat"] }
  | { op: "setShuffle"; shuffle: boolean };

/** Queue mutation body for POST /sessions/:sid/queue. */
export type QueueAddCommand = {
  trackIds: MediaId[];
  /** "next" inserts after current; "last" appends; "now" plays immediately. */
  mode: "next" | "last" | "now";
};

/* ------------------------------------------------------------------ *
 * Realtime event bus (socket.io + SSE)
 * ------------------------------------------------------------------ *
 * Server->client events on the now-playing/VU channel. High-rate events
 * (vu, beat) are SSE-friendly (~15-30 fps); control events go over socket.io.
 */

/** Server -> client event names. */
export const SERVER_EVENTS = {
  nowPlaying: "now-playing", // NowPlayingEvent
  transport: "transport", // TransportEvent
  vu: "vu", // VuEvent (high-rate)
  beat: "beat", // BeatEvent
  dsp: "dsp", // DspStateEvent
  zone: "zone", // ZoneEvent
  room: "room", // RoomEvent
  clock: "clock", // ClockEvent (sync anchor updates)
  aiMessage: "ai-message", // AiMessageEvent
  sourceStatus: "source-status" // SourceStatusEvent
} as const;

/** Client -> server event names (socket.io control channel). */
export const CLIENT_EVENTS = {
  subscribe: "subscribe", // { sessionId } | { zoneId }
  transport: "transport", // TransportCommand
  queueAdd: "queue-add", // QueueAddCommand
  dspPatch: "dsp-patch", // DspParamPatch[]
  clockReport: "clock-report", // ClientClockReport
  aiChat: "ai-chat" // AiChatRequest
} as const;

export type NowPlayingEvent = NowPlaying;
export type TransportEvent = { sessionId: string; transport: Transport };

/** VU / visualization frame. Mirrors the perceptual bins fed to the TV. */
export type VuEvent = {
  sessionId: string;
  /** Normalized 0..1 spectrum bins (perceptual FFT curve). */
  bins: number[];
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  /** Epoch ms of capture. */
  at: number;
};

export type BeatEvent = { sessionId: string; beat: BeatTelemetry };
export type DspStateEvent = { sessionId: string; dsp: DspNodeState[] };
export type ZoneEvent = { zone: Zone };
export type RoomEvent = { room: Room };
export type ClockEvent = { zoneId: string; clock: SyncClock };
export type SourceStatusEvent = { sources: SourceDescriptor[] };

/** AI/host message — superset-compatible with RendererLightssAiMessage. */
export type AiMessageEvent = {
  sessionId: string;
  title: string;
  message: string;
  provider: string;
  model: string;
  at: number;
};

/* ------------------------------------------------------------------ *
 * Strongly-typed event maps for socket.io clients/servers.
 * ------------------------------------------------------------------ */

export type ServerToClientEvents = {
  "now-playing": (e: NowPlayingEvent) => void;
  transport: (e: TransportEvent) => void;
  vu: (e: VuEvent) => void;
  beat: (e: BeatEvent) => void;
  dsp: (e: DspStateEvent) => void;
  zone: (e: ZoneEvent) => void;
  room: (e: RoomEvent) => void;
  clock: (e: ClockEvent) => void;
  "ai-message": (e: AiMessageEvent) => void;
  "source-status": (e: SourceStatusEvent) => void;
};

export type ClientToServerEvents = {
  subscribe: (p: { sessionId?: string; zoneId?: string }) => void;
  transport: (p: TransportCommand) => void;
  "queue-add": (p: QueueAddCommand) => void;
  "dsp-patch": (p: DspParamPatch[]) => void;
  "clock-report": (p: ClientClockReport) => void;
  "ai-chat": (p: AiChatRequest) => void;
};

/* Re-export request/response shapes referenced by REST bodies for one-import
 * convenience by client pods. */
export type {
  SearchQuery,
  SearchResult,
  Session,
  User,
  Room,
  Zone,
  QueueItem,
  AiChatRequest,
  AiChatResponse,
  AiControlSurface,
  DspParamPatch,
  Enrichment
};
