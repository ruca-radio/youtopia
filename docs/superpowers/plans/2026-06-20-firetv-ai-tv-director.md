# Fire TV AI TV Director Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build richer AI-directed TV visuals, transient Fire TV HUD controls, and lower-delay self-healing TV audio for the Youtopia TV receiver.

**Architecture:** Keep `firetv-receiver` as a thin Android WebView shell. Implement the richer behavior in the companion server's generated `/tv` page and the existing `tv-audio-stream.ts` ffmpeg args. Verification is static/scripted first, then live ADB/screenshot after build.

**Tech Stack:** Electron main process, Fastify companion routes, generated HTML/CSS/vanilla JS, Canvas 2D, HTMLAudioElement, ffmpeg WebM/Opus and MP3 streams, Android WebView receiver, Node verifier scripts.

---

### Task 1: Add Verifier Expectations First

**Files:**
- Modify: `scripts/verify-player-shell.mjs`
- Modify: `scripts/verify-firetv-receiver.mjs`

- [ ] **Step 1: Add failing TV director and audio checks to `scripts/verify-player-shell.mjs`**

Add these assertions near the existing companion server assertions:

```js
assertIncludes("src/main/integrations/companion-server/index.ts", "normalizeTvDirector");
assertIncludes("src/main/integrations/companion-server/index.ts", "deriveTvDirector");
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily: "ribbons"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "halos"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "orbits"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "spectrumField"');
assertIncludes("src/main/integrations/companion-server/index.ts", 'objectFamily === "albumGlow"');
assertIncludes("src/main/integrations/companion-server/index.ts", "showHud");
assertIncludes("src/main/integrations/companion-server/index.ts", "scheduleHudHide");
assertIncludes("src/main/integrations/companion-server/index.ts", "body.classList.add(\"hud-visible\")");
assertIncludes("src/main/integrations/companion-server/index.ts", "body.classList.add(\"hud-idle\")");
assertIncludes("src/main/integrations/companion-server/index.ts", "registerTvInputActivity");
assertIncludes("src/main/integrations/companion-server/index.ts", "maybeAutoRecoverAudio");
assertIncludes("src/main/integrations/companion-server/index.ts", "preferredAudioFormat = getPreferredAudioFormat()");
assertIncludes("src/main/integrations/companion-server/index.ts", "fallbackToMp3Audio");
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-probesize"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-analyzeduration"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"-cluster_time_limit"');
assertIncludes("src/main/integrations/companion-server/tv-audio-stream.ts", '"40"');
assertNotIncludes("src/main/integrations/companion-server/index.ts", "setInterval(function flash");
```

- [ ] **Step 2: Add failing receiver bridge checks to `scripts/verify-firetv-receiver.mjs`**

Add these patterns to the `MainActivity.java` check:

```js
/window\.youtopiaTvControl/,
/evaluateJavascript/,
/KEYCODE_DPAD_CENTER/,
/KEYCODE_MEDIA_FAST_FORWARD/,
/KEYCODE_MEDIA_REWIND/,
```

- [ ] **Step 3: Run verifiers and confirm the new checks fail**

Run:

```bash
yarn verify:player-shell
node scripts/verify-firetv-receiver.mjs
```

Expected: `verify-player-shell` fails on missing `normalizeTvDirector` or related strings. `verify-firetv-receiver` may already pass if bridge strings are present.

- [ ] **Step 4: Commit verifier changes**

```bash
git add scripts/verify-player-shell.mjs scripts/verify-firetv-receiver.mjs
git commit -m "test: add Fire TV director verification"
```

### Task 2: Add Director Normalization and Canvas Object Families

**Files:**
- Modify: `src/main/integrations/companion-server/index.ts`

- [ ] **Step 1: Extend CSS body state hooks**

In the generated TV CSS, add stable data-state styling:

```css
body { cursor: none; }
body.hud-visible { cursor: default; }
body.hud-idle .audio-panel,
body.hud-idle .transport-panel {
  opacity: 0;
  transform: translateY(12px);
  pointer-events: none;
}
body.hud-idle .message,
body.hud-idle .ticker {
  opacity: .18;
}
.audio-panel,
.transport-panel,
.message,
.ticker {
  transition: opacity 420ms ease, transform 420ms ease;
}
body[data-tv-layout="ambient"] .track-copy { opacity: .72; }
body[data-tv-layout="artHero"] .track-copy { max-width: 58vw; }
body[data-tv-layout="lowHud"] main { grid-template-rows: auto 1fr auto; }
body[data-tv-focus="albumArt"] .album-art { opacity: .98; }
```

- [ ] **Step 2: Add director helpers after `normalizeVisualScene`**

Add:

```js
function normalizeTvDirector(input, visualConfig, state) {
  const src = input && typeof input === "object" ? input : {};
  const visualizer = visualConfig.visualizerStyle;
  const vuStyle = visualConfig.vuStyle;
  let objectFamily = "ribbons";
  if (src.objectFamily === "halos" || src.objectFamily === "orbits" || src.objectFamily === "spectrumField" || src.objectFamily === "albumGlow" || src.objectFamily === "minimal") {
    objectFamily = src.objectFamily;
  } else if (visualizer === "spectrumLine") {
    objectFamily = "spectrumField";
  } else if (vuStyle === "albumGlow" || visualConfig.albumArtMode === "ambient") {
    objectFamily = "albumGlow";
  } else if (visualConfig.density > 72) {
    objectFamily = "orbits";
  } else if (visualConfig.intensity > 0.72) {
    objectFamily = "halos";
  }

  let layout = src.layout === "ambient" || src.layout === "artHero" || src.layout === "lowHud" ? src.layout : "standard";
  if (visualConfig.albumArtMode === "hero") layout = "artHero";
  if (objectFamily === "minimal") layout = "ambient";

  const focus = src.focus === "albumArt" || src.focus === "visualizer" || src.focus === "caption" ? src.focus : "track";
  const hudMode = src.hudMode === "visible" || src.hudMode === "ambient" ? src.hudMode : "transient";
  const density = typeof src.density === "number" ? Math.max(0, Math.min(100, Math.round(src.density))) : visualConfig.density;
  const intensitySource = typeof src.intensity === "number" ? src.intensity : Math.round(visualConfig.intensity * 100);
  const intensity = Math.max(0, Math.min(78, Math.round(intensitySource)));
  const isPlaying = Boolean(state && state.player && state.player.isPlaying);
  return { objectFamily, layout, focus, hudMode, density, intensity, isPlaying };
}

function deriveTvDirector(visualConfig, state) {
  return normalizeTvDirector(null, visualConfig, state);
}
```

- [ ] **Step 3: Store director in scene config**

In `normalizeVisualScene`, before returning, add:

```js
const director = deriveTvDirector({ backgroundStyle, visualizerStyle, vuStyle, speed, density, intensity, logoMode, captionMode, albumArtMode, primary, secondary, accent, bg, seed }, state);
return { backgroundStyle, visualizerStyle, vuStyle, speed, density, intensity, logoMode, captionMode, albumArtMode, primary, secondary, accent, bg, seed, director };
```

Replace the existing return line for that function.

- [ ] **Step 4: Apply layout/focus datasets**

In `applyVisualScene`, after existing dataset assignments, add:

```js
document.body.dataset.tvObjectFamily = config.director.objectFamily;
document.body.dataset.tvLayout = config.director.layout;
document.body.dataset.tvFocus = config.director.focus;
```

- [ ] **Step 5: Draw safe object families in `render()`**

Inside the canvas render block after the vignette and before existing ribbons, add family-specific drawing. Reuse `sceneEnergy`, `cfg`, `canvasW`, `canvasH`, `dpr`, and `t`:

```js
const director = cfg.director || deriveTvDirector(cfg, state);
const objectFamily = director.objectFamily;
const directorIntensity = clamp01(director.intensity / 100);
if (objectFamily === "halos" || objectFamily === "albumGlow") {
  const haloCount = objectFamily === "albumGlow" ? 2 : 3;
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < haloCount; i++) {
    const cx = canvasW * (0.5 + Math.sin(t * cfg.speed * 0.18 + i) * 0.12);
    const cy = canvasH * (0.48 + Math.cos(t * cfg.speed * 0.15 + i * 1.7) * 0.10);
    const radius = Math.min(canvasW, canvasH) * (0.24 + i * 0.12 + sceneEnergy * 0.05);
    const hg = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    hg.addColorStop(0, i % 2 ? hexToRgba(cfg.secondary, 0.10 * directorIntensity) : hexToRgba(cfg.primary, 0.10 * directorIntensity));
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
}
if (objectFamily === "orbits") {
  ctx.globalCompositeOperation = "screen";
  const orbitCount = Math.round(lerp(8, 26, director.density / 100));
  for (let i = 0; i < orbitCount; i++) {
    const angle = (i / orbitCount) * Math.PI * 2 + t * cfg.speed * 0.12;
    const radius = Math.min(canvasW, canvasH) * (0.18 + (i % 5) * 0.055);
    const px = canvasW * 0.5 + Math.cos(angle) * radius * 1.8;
    const py = canvasH * 0.52 + Math.sin(angle * 0.72) * radius;
    ctx.fillStyle = i % 2 ? hexToRgba(cfg.secondary, 0.13 * directorIntensity) : hexToRgba(cfg.primary, 0.13 * directorIntensity);
    ctx.beginPath();
    ctx.arc(px, py, Math.max(2.4 * dpr, 5 * dpr * lerp(0.7, 1.25, sceneEnergy)), 0, Math.PI * 2);
    ctx.fill();
  }
}
```

Also add this helper near `safeHex`:

```js
function hexToRgba(hex, alpha) {
  const safe = safeHex(hex, "#ffffff").replace("#", "");
  const r = parseInt(safe.slice(0, 2), 16);
  const g = parseInt(safe.slice(2, 4), 16);
  const b = parseInt(safe.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + Math.max(0, Math.min(1, alpha)) + ")";
}
```

- [ ] **Step 6: Run verifier**

```bash
yarn verify:player-shell
```

Expected: PASS or only failures for later HUD/audio hooks that Task 3 or 4 will add.

- [ ] **Step 7: Commit director changes**

```bash
git add src/main/integrations/companion-server/index.ts
git commit -m "feat: add AI TV director scene layer"
```

### Task 3: Add Transient TV HUD Behavior

**Files:**
- Modify: `src/main/integrations/companion-server/index.ts`
- Modify: `firetv-receiver/src/main/java/studio/youtopia/tvreceiver/MainActivity.java`

- [ ] **Step 1: Add HUD state variables in the TV script**

Near the other script-level variables, add:

```js
const body = document.body;
let hudHideTimer = null;
let commandPending = false;
```

- [ ] **Step 2: Add HUD helpers**

Before event listener wiring, add:

```js
function showHud(reason) {
  body.classList.add("hud-visible");
  body.classList.remove("hud-idle");
  scheduleHudHide(reason || "activity");
}

function scheduleHudHide(reason) {
  if (hudHideTimer) clearTimeout(hudHideTimer);
  if (pinGate.classList.contains("visible") || commandPending || document.activeElement && document.activeElement.closest && document.activeElement.closest(".control-row")) {
    return;
  }
  const delay = reason === "first-load" ? 6500 : 3600;
  hudHideTimer = setTimeout(() => {
    hudHideTimer = null;
    body.classList.remove("hud-visible");
    body.classList.add("hud-idle");
  }, delay);
}

function registerTvInputActivity(reason) {
  showHud(reason || "input");
}
```

- [ ] **Step 3: Hook HUD to input and control state**

Add:

```js
["pointermove", "pointerdown", "touchstart", "keydown", "focusin"].forEach(eventName => {
  window.addEventListener(eventName, () => registerTvInputActivity(eventName), { passive: true });
});
window.addEventListener("load", () => showHud("first-load"));
```

In `sendTvControl`, set pending state:

```js
commandPending = true;
showHud("command");
```

In a `finally` block at the end of `sendTvControl`, add:

```js
commandPending = false;
scheduleHudHide("command-complete");
```

- [ ] **Step 4: Make native remote keys reveal HUD**

In `window.youtopiaTvControl`, call:

```js
registerTvInputActivity("remote");
```

before `sendTvControl(...)`.

- [ ] **Step 5: Keep PIN gate visible**

In `showPinGate`, add:

```js
showHud("pin");
```

In `hidePinGate`, add:

```js
scheduleHudHide("pin-complete");
```

- [ ] **Step 6: Confirm native receiver remains thin**

No native code change is expected unless the verifier fails. If editing `MainActivity.java`, only add JS bridge calls such as:

```java
webView.evaluateJavascript(
    "(function(){if(window.registerTvInputActivity){window.registerTvInputActivity('remote');}" +
        "if(window.youtopiaTvControl){window.youtopiaTvControl('" + safeCommand + "');}})();",
    null
);
```

- [ ] **Step 7: Run HUD verification**

```bash
yarn verify:player-shell
node scripts/verify-firetv-receiver.mjs
```

Expected: PASS or only Task 4 audio-hook failures remain.

- [ ] **Step 8: Commit HUD changes**

```bash
git add src/main/integrations/companion-server/index.ts firetv-receiver/src/main/java/studio/youtopia/tvreceiver/MainActivity.java
git commit -m "feat: hide Fire TV controls when idle"
```

### Task 4: Lower TV Audio Latency and Add Recovery

**Files:**
- Modify: `src/main/integrations/companion-server/tv-audio-stream.ts`
- Modify: `src/main/integrations/companion-server/index.ts`

- [ ] **Step 1: Tighten ffmpeg startup and chunking**

In `getTvAudioFfmpegArgs`, add after `"-loglevel", "warning"`:

```ts
"-probesize",
"32",
"-analyzeduration",
"0",
```

Change Pulse fragment size:

```ts
"-fragment_size",
"960",
```

For WebM, change:

```ts
"-frame_duration",
"10",
"-cluster_time_limit",
"40",
"-cluster_size_limit",
"4096",
```

For MP3, add before `"pipe:1"`:

```ts
"-flush_packets",
"1",
```

- [ ] **Step 2: Track preferred format and recovery state in TV script**

Near audio variables, add:

```js
let preferredAudioFormat = "webm";
let audioRecoveries = 0;
let audioWaitingSince = 0;
let audioRecoveryTimer = null;
```

- [ ] **Step 3: Use preferred format in `connectTvAudio`**

At the start of `connectTvAudio`, add:

```js
preferredAudioFormat = preferredAudioFormat || getPreferredAudioFormat();
```

Change the URL line to:

```js
tvAudio.src = "/tv/audio?format=" + preferredAudioFormat + "&ts=" + Date.now();
```

- [ ] **Step 4: Add MP3 fallback and recovery helpers**

Before audio event listeners, add:

```js
function fallbackToMp3Audio(reason) {
  if (preferredAudioFormat === "mp3") return false;
  preferredAudioFormat = "mp3";
  audioRecoveries = 0;
  setAudioStatus("Switching TV audio to MP3", "busy");
  resyncTvAudio();
  return true;
}

function maybeAutoRecoverAudio(reason) {
  if (!audioConnected) return;
  if (audioRecoveryTimer) clearTimeout(audioRecoveryTimer);
  audioRecoveryTimer = setTimeout(() => {
    audioRecoveryTimer = null;
    if (!audioConnected) return;
    if (audioRecoveries < 1) {
      audioRecoveries += 1;
      setAudioStatus("Resyncing TV audio", "busy");
      resyncTvAudio();
      return;
    }
    fallbackToMp3Audio(reason || "buffering");
  }, 1400);
}
```

- [ ] **Step 5: Wire recovery to events**

Replace the existing `waiting`, `playing`, and `error` listeners with:

```js
tvAudio.addEventListener("playing", () => {
  audioWaitingSince = 0;
  if (audioRecoveryTimer) {
    clearTimeout(audioRecoveryTimer);
    audioRecoveryTimer = null;
  }
  audioRecoveries = 0;
  setAudioStatus("TV audio connected", "ok");
  scheduleHudHide("audio-playing");
});
tvAudio.addEventListener("waiting", () => {
  audioWaitingSince = audioWaitingSince || Date.now();
  setAudioStatus("Buffering TV audio", "busy");
  showHud("audio-buffering");
  maybeAutoRecoverAudio("waiting");
});
tvAudio.addEventListener("error", () => {
  if (fallbackToMp3Audio("error")) return;
  audioConnected = false;
  setAudioStatus("TV audio stream failed", "bad");
  showHud("audio-error");
});
```

- [ ] **Step 6: Reset recovery on disconnect**

In `disconnectTvAudio`, add:

```js
audioRecoveries = 0;
audioWaitingSince = 0;
if (audioRecoveryTimer) {
  clearTimeout(audioRecoveryTimer);
  audioRecoveryTimer = null;
}
preferredAudioFormat = getPreferredAudioFormat();
```

- [ ] **Step 7: Run audio verification**

```bash
yarn verify:player-shell
```

Expected: PASS.

- [ ] **Step 8: Commit audio changes**

```bash
git add src/main/integrations/companion-server/index.ts src/main/integrations/companion-server/tv-audio-stream.ts
git commit -m "feat: reduce Fire TV audio buffering delay"
```

### Task 5: Build, Install, and Verify on Fire TV

**Files:**
- Build output: `firetv-receiver/build/youtopia-tv-receiver.apk`

- [ ] **Step 1: Run static verification**

```bash
yarn verify:player-shell
yarn verify:firetv-receiver
yarn lint
```

Expected: all pass.

- [ ] **Step 2: Build receiver APK**

```bash
bash scripts/build-firetv-receiver.sh
```

Expected: signed APK path printed at `firetv-receiver/build/youtopia-tv-receiver.apk`.

- [ ] **Step 3: Ensure Youtopia TV server is live**

```bash
curl -sI --max-time 5 http://127.0.0.1:9863/tv
curl -s --max-time 5 http://127.0.0.1:9863/tv/audio/status
```

Expected: `/tv` returns `HTTP/1.1 200 OK`; audio status returns JSON with `available:true` when ffmpeg/source are ready.

- [ ] **Step 4: Install and launch on Fire TV**

```bash
adb connect 10.27.27.207:5555
adb install -r firetv-receiver/build/youtopia-tv-receiver.apk
adb shell am force-stop studio.youtopia.tvreceiver
adb shell am start -n studio.youtopia.tvreceiver/.MainActivity
adb shell dumpsys window | rg -n 'mCurrentFocus|mFocusedApp'
```

Expected: focused app is `studio.youtopia.tvreceiver/.MainActivity`.

- [ ] **Step 5: Pull screenshot**

```bash
adb shell screencap -p /sdcard/youtopia-tv-receiver.png
adb pull /sdcard/youtopia-tv-receiver.png /tmp/youtopia-tv-receiver.png
```

Expected: screenshot shows Youtopia TV loaded, controls visible immediately after launch or remote input, with black-base visual scene.

- [ ] **Step 6: Final status**

Report:

```text
Verifiers:
- yarn verify:player-shell: PASS
- yarn verify:firetv-receiver: PASS
- yarn lint: PASS

Fire TV:
- APK installed: yes
- Focus: studio.youtopia.tvreceiver/.MainActivity
- Screenshot: /tmp/youtopia-tv-receiver.png
```
