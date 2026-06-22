/**
 * YouTopia Intelligent Music Server — shared enums.
 *
 * These enums are the single source of truth for cross-pod string/numeric
 * unions. Every pod imports from here rather than re-declaring literals so the
 * AudioSource, DSP, Session, and API surfaces stay in lockstep.
 *
 * Naming follows existing repo conventions (see src/shared/store/schema.ts and
 * src/shared/player.ts): string enums for wire-facing values, PascalCase
 * members.
 */

/** Audio source backends. Mirrors the pluggable AudioSource registry. */
export enum SourceId {
  YouTubeMusic = "ytmusic",
  AmazonMusic = "amazon",
  Local = "local"
}

/** Transport / playback state of a Session. Superset of RendererVideoState. */
export enum PlaybackState {
  Idle = "idle",
  Buffering = "buffering",
  Playing = "playing",
  Paused = "paused",
  Stopped = "stopped",
  Error = "error"
}

/** Repeat modes for a Session queue. */
export enum RepeatMode {
  Off = "off",
  One = "one",
  All = "all"
}

/** Kinds of DSP node in the enrichment chain, in canonical signal order. */
export enum DspNodeType {
  Equalizer = "eq",
  Compressor = "compressor",
  Limiter = "limiter",
  Expander = "expander",
  NoiseReduction = "noiseReduction",
  StereoExpansion = "stereoExpansion",
  BeatDetector = "beatDetector"
}

/**
 * Parameter value kinds for the AI-describable DSP param descriptor model.
 * Keep this list small — the agent reasons over these primitive shapes.
 */
export enum DspParamType {
  Float = "float",
  Int = "int",
  Bool = "bool",
  Enum = "enum",
  /** A homogeneous numeric array, e.g. the 30 EQ band gains. */
  FloatArray = "floatArray"
}

/** Enrichment provider categories. */
export enum EnrichmentKind {
  Lyrics = "lyrics",
  Metadata = "metadata",
  ArtistContext = "artistContext",
  MusicVideo = "musicVideo"
}

/** How a track's audio is delivered from a source to the engine. */
export enum StreamDeliveryKind {
  /** A direct HTTP(S) URL the engine can hand to ffmpeg. */
  DirectUrl = "directUrl",
  /** An HLS/DASH manifest URL. */
  Manifest = "manifest",
  /** A local filesystem path. */
  LocalFile = "localFile",
  /**
   * Source cannot expose a pullable handle; engine must capture a system
   * audio monitor while the source plays out-of-process (Amazon fallback).
   */
  Capture = "capture"
}

/** Container/codec used when the server transcodes for a client. */
export enum OutputCodec {
  /** WebM/Opus — preferred low-latency path (matches TV audio convention). */
  Opus = "opus",
  /** AAC in fMP4 — Apple/HLS clients. */
  Aac = "aac",
  /** MP3 — universal fallback. */
  Mp3 = "mp3",
  /** FLAC — lossless local/LAN playback. */
  Flac = "flac",
  /** Raw PCM — synchronized multi-room snapcast-style transport. */
  Pcm = "pcm"
}

/** Wire transport a client uses to receive an audio program. */
export enum TransportKind {
  /** HLS manifest (.m3u8). Used by FireTV program path today. */
  Hls = "hls",
  /** Chunked HTTP progressive (low-delay Opus/MP3, matches /tv/audio). */
  HttpProgressive = "httpProgressive",
  /** Synchronized PCM-over-TCP for multi-room (snapcast-style). */
  SyncPcm = "syncPcm"
}

/** Client device families the server streams to. */
export enum ClientKind {
  FireTv = "firetv",
  Roku = "roku",
  Ios = "ios",
  Android = "android",
  Web = "web"
}

/** Reuses LightssAiProvider values; duplicated here so contracts have no
 * dependency on the Electron app's store schema. Keep values identical. */
export enum AiProvider {
  OpenAI = "openai",
  OpenRouter = "openrouter",
  Ollama = "ollama",
  Gemini = "gemini"
}

/** Coarse capability flags an AudioSource advertises. */
export enum SourceCapability {
  Search = "search",
  Browse = "browse",
  Playlists = "playlists",
  Library = "library",
  Lyrics = "lyrics",
  Radio = "radio",
  MusicVideo = "musicVideo",
  /** Source can return a pullable stream handle (vs. capture-only). */
  PullableStream = "pullableStream",
  /** Source exposes gapless / seek-accurate streaming. */
  Seekable = "seekable"
}
