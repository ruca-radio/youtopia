# Pod B — Multi-Source Audio Engine

**Pod B** implements the `AudioSource` plugin contract for three backends and a unified library service layer. All sources live in `server/src/sources/**`.

## Sources

### Local Files (`local/LocalFileSource.ts`)

Full implementation. Scans a configurable `libraryDir` for `.mp3/.flac/.wav/.ogg/.m4a/.aac/.opus/.wma` files. Extracts tags with `music-metadata` (ESM-only package — imported via dynamic `import()`). Builds Track/Album/Artist/Playlist models with namespaced `MediaId`s (`local:track:<slug>`). In-memory fuzzy search via `fuse.js` (threshold 0.35). `getStreamHandle` returns `StreamDeliveryKind.LocalFile` — the absolute path, directly ffmpeg-ready.

**Capabilities:** Search, Browse, Library, PullableStream, Seekable.

### YouTube Music (`ytmusic/YouTubeMusicSource.ts`)

PRIMARY source (PM Decision #2). Talks to a Python sidecar (`server/sidecars/ytmusic/sidecar.py`) for all catalog operations. The sidecar wraps `ytmusicapi` and exposes a tiny HTTP JSON API on `http://127.0.0.1:9871`. The TS source supervises the sidecar process (spawns on init if `sidecarPath` is set) and polls its `/health` endpoint.

`getStreamHandle` invokes `yt-dlp -f bestaudio --print-json --get-url` to extract a time-limited direct audio URL (expires ~6h). Premium 256 kbps Opus unlocked by setting `YTMUSIC_COOKIES_FILE` to a Netscape cookies export.

**Setup:** `pip install ytmusicapi` + `yt-dlp` on PATH. See `server/sidecars/ytmusic/README.md`.

**Capabilities:** Search, Browse, Playlists, Library (with auth), Lyrics, Radio, PullableStream, Seekable.

### Amazon Music (`amazon/AmazonMusicSource.ts`)

DEGRADED / capture-only (PM Decision #2 + ADR-0002). No official headless SDK. `getStreamHandle` returns `StreamDeliveryKind.Capture` pointing at the PulseAudio/PipeWire monitor sink (`default.monitor` by default). The DSP pipeline captures via:

```bash
ffmpeg -f pulse -i default.monitor -ac 2 -ar 48000 -f s16le pipe:1
```

`health()` reports the degraded status honestly. `search()` and metadata methods are stubbed (return empty/minimal). No seek, no gapless. Enable with `YOUTOPIA_AMAZON_ENABLED=true`.

**Capabilities:** Search (stub), Browse (stub). NOT PullableStream, NOT Seekable.

## Plugin Registration (`index.ts`)

Imports are side-effectful (call `registerPlugin()`). Import order = ISRC de-dup priority: YTM → Local → Amazon. Gated by env vars:

| Var | Default |
|---|---|
| `YOUTOPIA_YTMUSIC_ENABLED` | `true` |
| `YOUTOPIA_LOCAL_ENABLED` | `true` |
| `YOUTOPIA_AMAZON_ENABLED` | `false` |

## Library Service (`library/index.ts`)

Singleton `LibraryService` aggregates all registered sources. Import via:

```ts
import { getLibraryService } from "../sources/library/index.js";
const library = getLibraryService();
```

Key methods: `searchAll()`, `getTrack/Album/Artist/Playlist()`, `getStreamHandle()`, `browseArtists()`, `browseAlbums()`, `browseLocalTracks()`, `browseAlbumTracks()`, `browseArtistAlbums/Tracks()`, `recentlyAdded()`, `listSources()`, `invalidateCaches()`.

## REST Routes (`routes.ts`)

Registered by `registerSourceRoutes(fastify, library)` before the 501 stubs in `server.ts`:

| Route | Auth | Description |
|---|---|---|
| `GET /api/v1/sources` | Public | All source descriptors |
| `GET /api/v1/search?q=&kinds=&limit=` | Public | Fan-out search |
| `GET /api/v1/tracks/:id` | Required | Track by MediaId |
| `GET /api/v1/albums/:id` | Required | Album by MediaId |
| `GET /api/v1/artists/:id` | Required | Artist by MediaId |
| `GET /api/v1/playlists/:id` | Required | Playlist by MediaId |
