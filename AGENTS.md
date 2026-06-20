# Youtopia Platform Handoff

## Current Scope

This repo is the local Youtopia desktop player fork in `/home/rucaradio/ytmdesktop`. The active workstream is a personal TV/lightshow setup:

- Desktop Electron app plays YouTube Music.
- Companion server exposes a TV display at `/tv` on port `9863`.
- Fire TV runs a sideloaded native WebView receiver app pointed at the TV display.
- Lightss AI plans WLED scenes and TV visual themes from the current song.
- VU data is captured from the player and streamed to compact/fullscreen/TV surfaces.

## Network Targets

- Youtopia TV page: `http://10.27.27.96:9863/tv`
- WLED controller: `http://10.27.27.110`
- Ollama: `http://10.27.27.10:11434`
- Preferred Ollama model: `kimi-k2.7-code:cloud`
- Fire TV ADB: `10.27.27.207:5555`
- Fire TV package: `studio.youtopia.tvreceiver`

## Fire TV Receiver

The Fire TV app lives under `firetv-receiver/`. It is intentionally a thin Android WebView shell:

- `firetv-receiver/src/main/java/studio/youtopia/tvreceiver/MainActivity.java`
- Loads `http://10.27.27.96:9863/tv`
- Keeps the screen awake.
- Runs fullscreen/immersive.
- Allows WebView media playback without a gesture.
- Maps Fire TV remote keys to `/tv/control` for play/pause, previous, next, and reload.

Build and verify:

```bash
node scripts/verify-firetv-receiver.mjs
bash scripts/build-firetv-receiver.sh
```

Install and launch:

```bash
adb connect 10.27.27.207:5555
adb install -r firetv-receiver/build/youtopia-tv-receiver.apk
adb shell am start -n studio.youtopia.tvreceiver/.MainActivity
adb shell dumpsys window | rg -n 'mCurrentFocus|mFocusedApp'
```

Screenshot verification:

```bash
adb shell screencap -p /sdcard/youtopia-tv-receiver.png
adb pull /sdcard/youtopia-tv-receiver.png /tmp/youtopia-tv-receiver.png
```

## TV Display

The TV page is generated in `src/main/integrations/companion-server/index.ts`.

Important routes:

- `GET /tv` - TV HTML surface.
- `GET /tv/state` - current player, audio, and Lightss state.
- `GET /tv/events` - SSE stream, roughly 15 FPS.
- `GET /tv/audio/status` - audio capture availability.
- `GET /tv/audio` - low-delay TV audio stream.
- `POST /tv/control` - remote control bridge to the YTM BrowserView.
- `GET /tv/provider-logo/:provider` - provider logo assets.

The TV UI should keep a true black base. If background effects are added, layer them lightly above black and avoid full-screen colored washes unless the user explicitly asks for them.

Prefer icon buttons for TV controls. Keep text for status/state only.

## Audio Stream

TV audio capture is in `src/main/integrations/companion-server/tv-audio-stream.ts`.

It uses `ffmpeg` against the default PipeWire/Pulse sink monitor:

- Prefer `wpctl inspect @DEFAULT_AUDIO_SINK@`.
- Fallback to `pactl get-default-sink`.
- WebM/Opus is preferred by the TV page when supported.
- MP3 remains as fallback.

Audio/video sync can still drift because this is HTTP audio streamed into a WebView. Use the TV page delay/resync controls for now.

## Lightss / WLED / AI

Lightss lives in `src/main/integrations/lightss/index.ts`.

Rules:

- No strobe, blinking, rapid flashing, or sudden high-contrast cuts.
- Ask the AI to soften flash and transition intensity because strong flashing gets visually fatiguing even when it is not technically a strobe.
- Keep WLED colors and TV VU/display colors aligned.
- TV VU hot color should match the WLED primary color, not white.
- Emit status so the TV can show AI/WLED connection health.

Provider settings are in the app settings UI:

- Ollama provider URL defaults toward `http://10.27.27.10:11434`.
- WLED host defaults toward `http://10.27.27.110`.
- OpenAI is also selectable when configured.

## Verification Commands

Core checks:

```bash
yarn verify:player-shell
yarn verify:firetv-receiver
yarn lint
```

Build desktop package:

```bash
yarn make --targets @electron-forge/maker-deb
```

Install desktop package:

```bash
sudo -S dpkg -i out/make/deb/x64/youtopia_2.0.11_amd64.deb
```

Launch desktop app:

```bash
ELECTRON_DISABLE_SANDBOX=1 setsid -f youtopia --no-sandbox >/tmp/youtopia.log 2>&1
```

Smoke test TV server:

```bash
curl -sI --max-time 5 http://127.0.0.1:9863/tv
curl -s --max-time 5 http://127.0.0.1:9863/tv/audio/status
```

## Collaboration Notes

- The user wants execution, not long proposals.
- The user may run parallel Codex instances. Keep changes scoped and check `git status` before editing.
- Do not revert unrelated work.
- Browser GUI, TV receiver, WLED, AI status, and VU are all first-class surfaces.
- Treat no-strobe/no-blink as a hard product rule.
