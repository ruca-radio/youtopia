# ytmusic-sidecar

Thin Python HTTP sidecar that exposes ytmusicapi as a local JSON API on
`http://127.0.0.1:9871`. The TypeScript `YouTubeMusicSource` talks to it for
all catalog/search/playlist operations.

## Setup

```bash
# Create a venv in this directory
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Authentication

**Required for library access and higher-quality streams.**

### Option 1 — Browser cookie auth
```bash
python3 -m ytmusicapi browser
# Follow prompts → saves headers.json
export YTMUSIC_AUTH_FILE="$(pwd)/headers.json"
```

### Option 2 — OAuth (recommended for persistent installs)
```bash
python3 -m ytmusicapi oauth
# Follow prompts → saves oauth.json
export YTMUSIC_AUTH_FILE="$(pwd)/oauth.json"
```

Unauthenticated mode supports public search and catalog only (no library,
no private playlists).

## Running

```bash
YTMUSIC_AUTH_FILE=/path/to/headers.json \
YTMUSIC_PORT=9871 \
python3 sidecar.py
```

The TypeScript server starts the sidecar automatically if
`sources.ytmusic.sidecarPath` is set in `youtopia-server.json`.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness + auth status |
| GET | `/search?q=<text>&limit=<n>` | Search tracks/albums/artists/playlists |
| GET | `/track/<videoId>` | Track metadata |
| GET | `/album/<browseId>` | Album metadata + track list |
| GET | `/artist/<channelId>` | Artist metadata + albums |
| GET | `/playlist/<playlistId>` | Playlist metadata + tracks |
| GET | `/library/songs?limit=<n>` | Library songs (auth required) |
| GET | `/library/albums?limit=<n>` | Library albums (auth required) |
| GET | `/library/playlists` | Library playlists (auth required) |

## Stream URLs (yt-dlp)

The sidecar does NOT resolve stream URLs — that is handled by `yt-dlp` in the
TypeScript `YouTubeMusicSource.getStreamHandle()`. Install yt-dlp:

```bash
pip install yt-dlp
# or
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod +x /usr/local/bin/yt-dlp
```

Set `YTMUSIC_COOKIES_FILE` env to a Netscape-format cookies.txt exported from
your browser to unlock Premium 256 kbps Opus streams.
