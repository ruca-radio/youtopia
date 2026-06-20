# Fire TV AI TV Director Design

## Goal

Improve the Youtopia Fire TV experience as a personal music-room display. The TV should feel directed by the AI lightshow system: visual objects, layout, color, and motion should adapt to the song vibe while preserving the hard no-strobe/no-blink rule. The on-screen controls should behave like a TV HUD that appears only during interaction. TV audio should start and recover with less buffering delay.

## Non-Goals

- Do not turn the native Fire TV app into a full renderer. It remains a thin Android WebView shell for `http://10.27.27.96:9863/tv`.
- Do not add raw audio, screenshots, canvas data, or full WLED snapshots to always-on AI requests.
- Do not let AI trigger strobe, blinking, rapid flashing, sudden high-contrast cuts, or abrupt full-screen color washes.
- Do not make WLED updates more frequent just to animate the TV.

## Architecture

Keep the main behavior in `src/main/integrations/companion-server/index.ts`, with the native receiver in `firetv-receiver/src/main/java/studio/youtopia/tvreceiver/MainActivity.java` limited to immersive WebView hosting, lifecycle reloads, and remote-key forwarding.

The existing Lightss planner remains the song-level source of truth. It already emits `displayTheme`, `visualScene`, `hostLine`, and `tickerMessage`. The TV page will add a TV-only scene director layer that derives a richer render plan from:

- `state.lightss.visualScene`
- `state.lightss.displayTheme`
- player title, artist, progress, playing state, and album art availability
- live VU bins and smoothed audio energy
- AI/WLED status

This first implementation should avoid a separate AI network call. The director layer is a deterministic translator over the existing AI plan. A later optional endpoint can refresh TV-only director state independently, but it must keep the same safety schema and rate limits.

## Scene Director

The TV director outputs safe, bounded render config:

- `objectFamily`: `ribbons`, `halos`, `orbits`, `spectrumField`, `albumGlow`, or `minimal`
- `layout`: `standard`, `ambient`, `artHero`, or `lowHud`
- `motion`: `static`, `slow`, or `medium`
- `density`: integer `0-100`
- `intensity`: integer `0-100`, clamped to a conservative page-level maximum
- `focus`: `track`, `albumArt`, `visualizer`, or `caption`
- `hudMode`: `visible`, `transient`, or `ambient`

The canvas scene should morph between configs smoothly. Scene changes are allowed on track changes and on occasional state changes, but object positions, alpha, and color should ease rather than snap. Audio energy may influence scale, drift, and opacity only through smoothed values.

The renderer should keep a true black base. Any background gradients, album-art glow, particles, fields, or ribbons are low-alpha layers above black.

## HUD Controls

The audio and transport controls become a transient TV HUD:

- Visible on first page load.
- Visible on Fire TV remote key input, pointer/touch input, focused control, PIN prompt, audio state changes, and command result.
- Auto-hide after a short idle window when no input is active.
- Reappear immediately when the native shell calls `window.youtopiaTvControl(...)`.
- Keep a small ambient status cluster visible or nearly visible so VU/AI/WLED health is still inspectable.

The HUD must never hide the PIN gate. It should not hide controls while keyboard focus is inside the HUD or while a command is actively pending.

## Low-Delay TV Audio

The page should default to the lowest tolerable delay:

- Default `audioDelayMs` to `0`.
- Prefer WebM/Opus when supported, otherwise MP3.
- Tune ffmpeg chunking and flushing for lower live latency.
- Connect immediately after the user or remote action that starts TV audio.
- Keep manual delay controls, but hide them with the transient HUD.
- On prolonged `waiting` or repeated buffering, automatically resync the stream once before declaring failure.
- If WebM/Opus repeatedly fails or buffers, fall back to MP3 automatically.
- Buffering status should be a small HUD/status pulse, not a persistent large interruption.

## Safety Rules

- No strobe, blink, rapid flashing, hard cuts, sudden high-contrast flashes, or fast alternating colors.
- Minimum transition duration for scene changes should be long enough to read as a morph, not a flash.
- AI-derived scene values must be normalized through allowlists and clamps before touching DOM or canvas state.
- If Lightss state is missing, invalid, or stale, use a calm local fallback scene based on black background, low-density ribbons, and subdued VU motion.

## Testing

Extend verification around the actual surfaces:

- `scripts/verify-firetv-receiver.mjs` confirms the receiver stays a thin WebView shell, loads the fixed TV URL, keeps immersive mode, and forwards remote keys through the JS bridge.
- `scripts/verify-player-shell.mjs` or a focused TV verifier confirms the TV page includes transient HUD hooks, director normalization allowlists, safe scene terms, and low-delay audio recovery hooks.
- Verify no banned strobe/blink/flash behavior terms are introduced into the TV scene engine.
- Run `yarn verify:player-shell`, `yarn verify:firetv-receiver`, and `yarn lint`.
- Build with `bash scripts/build-firetv-receiver.sh`.
- Install and launch on Fire TV with ADB, then confirm focus and screenshot.
- Smoke test `http://127.0.0.1:9863/tv` and `http://127.0.0.1:9863/tv/audio/status`.

## Rollout

Implement in small slices:

1. Add director normalization and canvas object families without changing native receiver behavior.
2. Add transient HUD behavior and remote-input show/hide hooks.
3. Lower audio startup latency and add automatic resync/fallback.
4. Rebuild, install, launch, and screenshot-verify the Fire TV receiver.
