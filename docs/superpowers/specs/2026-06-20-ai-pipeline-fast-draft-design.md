# AI Pipeline: Fast-Draft → Full Refinement Design

## Goal

Make the Lightss AI pipeline feel immediate and alive. The current four-agent sequential+parallel
pipeline takes 15-30 seconds before the first light step fires. This design replaces that with a
two-track approach: a single fast-draft call that fires lights within 2-3 seconds, followed by a
full collaborative plan that upgrades the scene in the background. Step frequency drops from 14s
to 7s. Album art feeds vision-capable providers directly, replacing the serial analyst call with
richer visual inference.

## Non-Goals

- Do not remove the existing per-agent provider cards (WLED, Canvas, Host, Analyst) from settings.
- Do not change safety rules: SAFE_EFFECTS, SAFE_PALETTES, and all sanitizers remain unchanged.
- Do not add a new Anthropic/Claude provider in this slice.
- Do not change the Fire TV director or companion-server layer.
- Do not increase AI call frequency beyond the existing song-level trigger.

## Pipeline Architecture

Two tracks fire simultaneously on `videoId` change:

```
videoId change ─┬─▶ SKETCH TRACK (no debounce)
                │     Single combined agent
                │     Target: 2-3s
                │     → Apply step 0 immediately
                │     → Start 7s step interval
                │
                └─▶ FULL PLAN TRACK (background)
                      3 parallel agents, no serial analyst hop
                      Target: 10-20s
                      → Smooth swap when ready
                      → Cache by videoId
```

### Before vs. After

| | Before | After |
|---|---|---|
| First light | debounce + analyst + parallel ≈ 15-30s | sketch ≈ 2-3s |
| Serial hops | 2 (debounce + analyst) | 0 |
| Step interval | 14s | 7s |
| Cache key | `videoId:artist:title:minute` | `videoId` |
| Plan refresh | every 60s (minute-segment) | at 50% progress for songs >4 min |
| Album art | unused | vision input for Gemini / OpenAI |

## Sketch Agent

A single combined call covering all four domains (WLED + Canvas + VJ + inline analyst reasoning)
in one wide schema. The system prompt instructs the model to first analyze the song's genre, mood,
and energy from the provided context and album art, then fill every field.

**Schema (`SketchPlan`):**

```typescript
type SketchPlan = {
  genre: string;
  mood: string;
  bpm: number;
  rationale: string;
  hostLine: string;         // <140 chars
  tickerMessage: string;
  displayTheme: {
    fontFamily: "system" | "display" | "mono";
    backgroundColor: string;
    accentColor: string;
    vuLowColor: string;
    vuMidColor: string;
    vuHighColor: string;
  };
  visualScene: {
    backgroundStyle: "solid" | "gradient";
    visualizerStyle: "vuBars" | "vuDots" | "spectrumLine" | "none";
    vuStyle: "bars" | "classicLed" | "dotMatrix" | "spectrumLine" | "albumGlow";
    motion: "static" | "slow" | "medium";
    density: number;
    intensity: number;
    logoMode: "off" | "small" | "prominent";
    captionMode: "off" | "minimal" | "full";
    albumArtMode: "off" | "corner" | "hero" | "ambient";
  };
  steps: AiLightshowStep[];  // exactly 4
};
```

The sketch call uses a hard timeout of 8 seconds. On timeout or error it fails silently and the
system waits for the full plan. The existing `aiPlanRetryAfter` cooldown applies only to the full
plan track.

**Provider:** configured via `lightssSketchProvider` and `lightssSketchModel` (default:
Gemini / `gemini-2.5-flash`). The existing `queryAgent` method handles the call; the sketch path
passes the combined schema as the `schemaName: "sketch_plan"` argument.

## Full Plan Track

The three parallel agents (WLED, Canvas, VJ) remain unchanged in structure. The serial Analyst
agent call is removed entirely. Each agent's system prompt gains a preamble:

> "Begin by briefly analyzing the song's genre, mood, and energy from the context and album art
> provided. Then produce your specialized output."

This keeps analytical reasoning without adding a serial hop.

The `lightssAnalystProvider` and `lightssAnalystModel` store keys are kept to avoid a migration,
but the Analyst agent is no longer called — do not wire these to any network request. The
`lightssAnalystPrompt` value (if set by the user) is prepended to each of the three parallel
agents' system prompts as a shared reasoning style instruction. The Analyst card in the settings UI
remains visible; add a note under it: "Provider and model settings are unused — only the custom
prompt below applies."

## Vision Input

For providers that support vision (Gemini, OpenAI, and OpenRouter models that accept image URLs),
the album art thumbnail URL is added as an image part to the user message.

- **Gemini:** `contents[0].parts` gains `{ fileUri: thumbnailUrl, mimeType: "image/jpeg" }`.
- **OpenAI / OpenRouter:** `messages[1].content` becomes an array with a `{ type: "image_url" }`
  block.
- **Ollama:** skipped unless the configured model name contains `"llava"` or `"vision"`.

Guards: `lightssVisionEnabled` must be true (default: true), `albumArtUrl` must be non-empty, and
the URL must begin with `https://` (YouTube CDN thumbnails always do). Falls back to text-only
silently on any error.

Vision applies to both the sketch agent and each full-plan agent.

## State Machine

```
IDLE
  │  videoId change
  ▼
SKETCH_PENDING ──────────────────────────────────── both tracks fire here
  │  sketch resolves (~2-3s)    sketch fails/times out (8s)
  ▼                                    │
SKETCH_ACTIVE                          │ (full plan still running in background)
  │  ── step timer (7s) ──►            │
  │  full plan resolves                │ full plan resolves
  ▼                                    ▼
FULL_ACTIVE  ──── step timer (7s) ────────────────► IDLE (song end / pause)
```

### Transition Behavior

When the full plan resolves while the sketch is active:

1. `emitAiMessage` fires with the full plan's `displayTheme`, `visualScene`, `hostLine`, and
   `planPhase: "full"`. The UI transitions immediately.
2. The WLED step index is **not reset**. The next 7s tick advances `aiPlanIndex` into the full
   plan's step array, avoiding a light jump mid-song.

### 50% Refresh

When `progressPercent >= 50`, the song is longer than 240 seconds, and the flag
`aiPlanRefreshedAt50` is clear, a new full-plan request fires in the background. The sketch track
does not re-fire. The flag resets on `videoId` change.

### Caching

`planCache` key changes from `` `${videoId}:${author}:${title}:${segment}` `` to `videoId`.
A separate `sketchPlanCache` (same 100-entry LRU cap) stores sketch plans. On a repeated
`videoId`, if the full plan cache holds an entry, the sketch phase is skipped and the full plan
applies immediately.

## New Store Keys

| Key | Type | Default |
|---|---|---|
| `lightssSketchProvider` | `LightssAiProvider` | `LightssAiProvider.Gemini` |
| `lightssSketchModel` | `string` | `"gemini-2.5-flash"` |
| `lightssVisionEnabled` | `boolean` | `true` |
| `lightssStepIntervalMs` | `number` | `7000` |

## RendererLightssAiMessage Addition

```typescript
planPhase?: "sketch" | "full";  // optional; existing consumers ignore it
```

## Settings UI Changes

A "Sketch Agent" subsection appears above the existing per-agent cards in the Lightss settings tab:

```
┌─────────────────────────────────────────────────────────┐
│  ⚡ Sketch Agent  (fast-draft, fires immediately)        │
│                                                         │
│  Provider  [ Gemini ▼ ]   Model  [ gemini-2.5-flash   ] │
│  ☑ Album art vision input                               │
│  Step interval  [ 7 ] s                                 │
└─────────────────────────────────────────────────────────┘
```

Uses the existing `<YTMDSetting>` pattern and `LightssAiProvider` dropdown. No new component.

The `SystemStatusPill` gains a phase indicator:

- `⚡ Draft` — sketch active, full plan pending
- `✦ AI` — full plan active (no change for existing behavior)

## Files to Change

| File | Change |
|---|---|
| `src/shared/store/schema.ts` | Add 4 new `StoreSchema["integrations"]` keys |
| `src/shared/player.ts` | Add optional `planPhase` to `RendererLightssAiMessage` |
| `src/main/integrations/lightss/index.ts` | Two-track pipeline, sketch agent, vision input, 7s interval, new cache strategy, 50% refresh |
| `src/renderer/windows/settings/Settings.vue` | Sketch Agent subsection, step interval input, vision toggle |
| `src/renderer/windows/main/player-shell/SystemStatusPill.vue` | Phase indicator (⚡ Draft vs ✦ AI) |

## Safety Rules (Unchanged)

- `SAFE_EFFECTS` and `SAFE_PALETTES` allowlists remain enforced on all steps including sketch.
- `sanitizeAiStep`, `sanitizeDisplayTheme`, and `sanitizeVisualScene` run on all plan output.
- No strobe, blink, or abrupt color cuts. All transitions remain clamped to `minTransitionMs: 600`.
- Vision input is read-only context; it does not expand the output schema or safety surface.

## Testing

- Run `yarn verify:player-shell` and `yarn verify:firetv-receiver` to confirm no regressions.
- Run `yarn lint` and `yarn typecheck`.
- Smoke test: start a song, confirm a light step fires within 3 seconds, confirm the status pill
  shows `⚡ Draft` then transitions to `✦ AI` when the full plan arrives.
- Confirm the 7s step interval by watching WLED updates in the log.
- Confirm replaying a song skips the sketch phase and applies the cached full plan immediately.
