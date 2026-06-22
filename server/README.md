# YouTopia Server

Standalone Node/TypeScript music server — the backend for the YouTopia Intelligent Music System.

- **Port:** `9870` (PM Decision #1; existing companion server stays on `:9863`)
- **Stack:** Fastify 5, Socket.IO 4, pino, TypeScript 5.9 strict/NodeNext
- **Auth:** PIN → bearer token, multi-user (Patrick + spouse)
- **Entrypoint:** `src/index.ts`

---

## Prerequisites

- Node ≥ 22 (check with `node --version`)
- npm ≥ 10

---

## Quick Start (development)

```bash
cd server
npm install
npm run dev
```

The server watches for file changes and restarts automatically (`tsx watch`).
Confirm it's up:

```bash
curl http://localhost:9870/healthz
# {"ok":true,"service":"youtopia-server","version":"0.1.0","port":9870,"uptime":...}
```

---

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Watch + restart (`tsx watch src/index.ts`) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled `dist/index.js` (production) |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | ESLint over `src/` |

---

## Configuration

Resolution order (highest wins):

1. **Environment variables** — `YOUTOPIA_*` (see `src/config/index.ts` for the full list)
2. **Config file** — `$YOUTOPIA_CONFIG_PATH` or `<cwd>/youtopia-server.json`
3. **Built-in defaults** — real LAN values from `AGENTS.md`

### Key env vars

| Var | Default | Description |
|---|---|---|
| `YOUTOPIA_PORT` | `9870` | HTTP listen port |
| `YOUTOPIA_HOST` | `0.0.0.0` | Bind address |
| `YOUTOPIA_JWT_SECRET` | `change-me-in-production-config` | Token signing secret — **override in prod** |
| `YOUTOPIA_DATA_DIR` | `./data` | SQLite / persistent state |
| `YOUTOPIA_WLED_HOST` | `10.27.27.110` | WLED controller LAN IP |
| `YOUTOPIA_OLLAMA_URL` | `http://10.27.27.10:11434` | Ollama base URL |
| `YOUTOPIA_OLLAMA_MODEL` | `kimi-k2.7-code:cloud` | Default Ollama model |
| `YOUTOPIA_AI_PROVIDER` | `ollama` | Default AI provider (`ollama`/`openai`/`openrouter`/`gemini`) |
| `OPENAI_API_KEY` | — | OpenAI key (optional) |
| `OPENROUTER_API_KEY` | — | OpenRouter key (optional) |
| `GEMINI_API_KEY` | — | Gemini key (optional) |

### Config file example (`youtopia-server.json`)

```json
{
  "auth": {
    "jwtSecret": "a-long-random-secret-here",
    "users": [
      {
        "userId": "patrick",
        "displayName": "Patrick",
        "pinHash": "<sha256-hex-of-your-pin>"
      },
      {
        "userId": "spouse",
        "displayName": "Spouse",
        "pinHash": "<sha256-hex-of-your-pin>"
      }
    ]
  },
  "ai": {
    "defaultProvider": "ollama",
    "ollama": {
      "baseUrl": "http://10.27.27.10:11434",
      "defaultModel": "kimi-k2.7-code:cloud"
    }
  }
}
```

Generate a PIN hash: `echo -n "your-pin" | sha256sum`

---

## API surface

All REST routes are under `/api/v1`.  Stubs return `501 Not Implemented` until Pods B/C/D fill them in.

| Route | Description |
|---|---|
| `GET /healthz` | Health check (no auth) |
| `POST /api/v1/auth/login` | PIN login → bearer token |
| `POST /api/v1/auth/logout` | Revoke token |
| `GET /api/v1/auth/users` | List configured users |
| `GET /api/v1/sources` | List audio sources |
| `GET /api/v1/search` | Search catalog |
| `GET /api/v1/sessions` | List sessions |
| `POST /api/v1/sessions` | Create session |
| `POST /api/v1/sessions/:sid/transport` | Playback control |
| `POST /api/v1/sessions/:sid/ai/chat` | AI chat |
| *(all REST_ROUTES from contracts)* | — |

Socket.IO on the same port — typed events: `now-playing`, `vu`, `beat`, `dsp`, `zone`, `room`, `clock`, `ai-message`, `source-status`.

---

## Proxmox VM Appliance

The server is designed to run as a standalone VM on Proxmox (HAOS-style: its own minimal OS image).  Phase 1 can run as a deb/container on the existing host; the appliance image is a **Later** milestone.

### Systemd service (on a dedicated Debian/Ubuntu VM or LXC)

See `deploy/youtopia-server.service`.  Quick setup:

```bash
# 1. Copy the service unit
sudo cp deploy/youtopia-server.service /etc/systemd/system/

# 2. Create the service user
sudo useradd -r -s /bin/false -d /opt/youtopia-server youtopia

# 3. Install Node (via nvm or nodesource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Deploy app
sudo mkdir -p /opt/youtopia-server
sudo cp -r . /opt/youtopia-server/
cd /opt/youtopia-server && sudo npm install && sudo npm run build

# 5. Create config
sudo cp youtopia-server.json.example /opt/youtopia-server/youtopia-server.json
# Edit jwtSecret + user PIN hashes

# 6. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now youtopia-server
sudo systemctl status youtopia-server
```

### Docker

```bash
# Build image
docker build -t youtopia-server:latest .

# Run with LAN access (host networking so Ollama/WLED are reachable)
docker run --network=host \
  -e YOUTOPIA_JWT_SECRET=your-secret-here \
  -v /opt/youtopia-data:/opt/youtopia-server/data \
  youtopia-server:latest
```

Or with a config file:

```bash
docker run --network=host \
  -v /opt/youtopia-config/youtopia-server.json:/opt/youtopia-server/youtopia-server.json:ro \
  -v /opt/youtopia-data:/opt/youtopia-server/data \
  youtopia-server:latest
```

### Building a minimal appliance image (Later milestone)

The target is a Proxmox VM running a minimal Debian root with:
- Node 22 + the compiled server bundle
- Systemd as init
- Static IP on the LAN (`10.27.27.x`)
- The `youtopia-server.service` unit started at boot

A minimal Debian cloud image (`debian-12-generic-amd64.img`) cloud-init setup:

```yaml
# cloud-config (user-data)
hostname: youtopia-server
packages:
  - nodejs
  - npm
  - ffmpeg
runcmd:
  - curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  - apt-get install -y nodejs
  - mkdir -p /opt/youtopia-server
  # copy app from NAS / git clone
  - git clone https://github.com/your-fork/youtopia /opt/youtopia-server/repo
  - cd /opt/youtopia-server/repo/server && npm install && npm run build
  - cp /opt/youtopia-server/repo/server/deploy/youtopia-server.service /etc/systemd/system/
  - systemctl daemon-reload && systemctl enable --now youtopia-server
```

Proxmox VM specs:
- **CPU:** 2 vCPU
- **RAM:** 2 GB (4 GB recommended when running Ollama locally)
- **Disk:** 32 GB (space for music library cache + SQLite)
- **Network:** VirtIO, bridged to `vmbr0` (LAN), static IP recommended

> Ollama stays on its own Proxmox node (`10.27.27.10`) per AGENTS.md — the YouTopia server reaches it over LAN.
