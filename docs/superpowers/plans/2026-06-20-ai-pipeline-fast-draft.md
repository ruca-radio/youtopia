# AI Pipeline Fast-Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the serial Analyst→parallel pipeline with a two-track system: an immediate sketch agent fires lights in ~2-3s, a full collaborative plan upgrades the scene in the background, step interval drops from 14s to 7s, and album art feeds vision-capable providers.

**Architecture:** `kickOffBothPlans()` fires simultaneously on `videoId` change — a single fast sketch agent and the existing 3-agent parallel pipeline (analyst call removed, reasoning embedded inline). When the sketch resolves it applies step 0 and starts the 7s step timer; when the full plan resolves it swaps display/scene and continues the timer from the current step index.

**Tech Stack:** TypeScript, Electron, Vue 3, existing `queryAgent` pattern, Gemini/OpenAI/OpenRouter/Ollama providers.

---

## File Map

| File | Change |
|---|---|
| `src/shared/store/schema.ts` | Add 4 new `StoreSchema["integrations"]` keys |
| `src/shared/player.ts` | Add optional `planPhase` to `RendererLightssAiMessage` |
| `src/main/integrations/lightss/index.ts` | Two-track pipeline, sketch agent, vision input, 7s timer, new cache |
| `src/renderer/windows/settings/Settings.vue` | Sketch agent subsection, step interval, vision toggle |
| `src/renderer/windows/main/player-shell/SystemStatusPill.vue` | ⚡ Draft / ✦ AI phase indicator |

---

### Task 1: Schema & Type Additions

**Files:**
- Modify: `src/shared/store/schema.ts`
- Modify: `src/shared/player.ts`

- [ ] **Step 1: Add 4 new keys to StoreSchema["integrations"]**

In `src/shared/store/schema.ts`, inside the `integrations` block (after `lightssAnalystPrompt: string | null;`), add:

```typescript
    lightssSketchProvider: LightssAiProvider;
    lightssSketchModel: string;
    lightssVisionEnabled: boolean;
    lightssStepIntervalMs: number;
```

- [ ] **Step 2: Add `planPhase` to RendererLightssAiMessage**

In `src/shared/player.ts`, inside `RendererLightssAiMessage`, add after `hostLine`:

```typescript
  planPhase?: "sketch" | "full";
```

- [ ] **Step 3: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/store/schema.ts src/shared/player.ts
git commit -m "feat: add sketch provider, vision, step interval, and planPhase schema fields"
```

---

### Task 2: Lightss — New Constants, Class Fields, and Helper Methods

**Files:**
- Modify: `src/main/integrations/lightss/index.ts`

- [ ] **Step 1: Add new constants after the existing constants block (~line 30)**

Add these after `const AI_LIGHTSHOW_INTERVAL_MS = 14000;`:

```typescript
const SKETCH_TIMEOUT_MS = 8000;
const VISION_CAPABLE_PROVIDERS: LightssAiProvider[] = [LightssAiProvider.Gemini, LightssAiProvider.OpenAI, LightssAiProvider.OpenRouter];
```

Keep `AI_LIGHTSHOW_INTERVAL_MS` in place — it will be removed in Task 6 once the timer reads from the store.

- [ ] **Step 2: Add new class fields after the existing private fields (~line 188)**

Add after `private planCache = new Map<string, AiLightshowPlan>();`:

```typescript
  private sketchPlanCache = new Map<string, AiLightshowPlan>();
  private planPhase: "sketch" | "full" | null = null;
  private currentPlanVideoId: string | null = null;
  private sketchPlanPromise: Promise<void> | null = null;
  private fullPlanPromise: Promise<void> | null = null;
  private aiPlanRefreshedAt50 = false;
```

- [ ] **Step 3: Add `getSketchAiProvider` after `getAnalystAiProvider` (~line 1140)**

```typescript
  private getSketchAiProvider(): AiProviderDetails {
    const provider = (this.store.get("integrations.lightssSketchProvider") || LightssAiProvider.Gemini) as LightssAiProvider;
    let model = "";
    if (provider === LightssAiProvider.OpenAI) {
      model = this.getOpenAIModel();
    } else if (provider === LightssAiProvider.OpenRouter) {
      model = this.getOpenRouterModel();
    } else if (provider === LightssAiProvider.Gemini) {
      model = (this.store.get("integrations.lightssSketchModel") as string || "gemini-2.5-flash").trim();
    } else {
      model = (this.store.get("integrations.lightssSketchModel") as string || DEFAULT_OLLAMA_MODEL).trim();
    }
    return { provider, model };
  }
```

- [ ] **Step 4: Add `getStepIntervalMs` after `getSketchAiProvider`**

```typescript
  private getStepIntervalMs(): number {
    const val = this.store.get("integrations.lightssStepIntervalMs") as number | null;
    if (typeof val === "number" && val >= 3000 && val <= 30000) return val;
    return 7000;
  }
```

- [ ] **Step 5: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/integrations/lightss/index.ts
git commit -m "feat(lightss): add sketch provider, step interval helpers, new plan state fields"
```

---

### Task 3: Lightss — Sketch Agent Schema and `requestSketchPlan`

**Files:**
- Modify: `src/main/integrations/lightss/index.ts`

- [ ] **Step 1: Add `getSketchAgentSchema` after `getHostAgentSchema` (~line 806)**

```typescript
  private getSketchAgentSchema(): JsonValue {
    return {
      type: "object",
      additionalProperties: false,
      required: ["genre", "mood", "bpm", "rationale", "hostLine", "tickerMessage", "displayTheme", "visualScene", "steps"],
      properties: {
        genre: { type: "string" },
        mood: { type: "string" },
        bpm: { type: "number" },
        rationale: { type: "string" },
        hostLine: { type: "string" },
        tickerMessage: { type: "string" },
        displayTheme: {
          type: "object",
          additionalProperties: false,
          required: ["fontFamily", "backgroundColor", "accentColor", "vuLowColor", "vuMidColor", "vuHighColor"],
          properties: {
            fontFamily: { type: "string", enum: ["system", "display", "mono"] },
            backgroundColor: { type: "string" },
            accentColor: { type: "string" },
            vuLowColor: { type: "string" },
            vuMidColor: { type: "string" },
            vuHighColor: { type: "string" }
          }
        },
        visualScene: {
          type: "object",
          additionalProperties: false,
          required: ["backgroundStyle", "visualizerStyle", "vuStyle", "motion", "density", "intensity", "logoMode", "captionMode", "albumArtMode"],
          properties: {
            backgroundStyle: { type: "string", enum: ["solid", "gradient"] },
            visualizerStyle: { type: "string", enum: ["vuBars", "vuDots", "spectrumLine", "none"] },
            vuStyle: { type: "string", enum: ["bars", "classicLed", "dotMatrix", "spectrumLine", "albumGlow"] },
            motion: { type: "string", enum: ["static", "slow", "medium"] },
            density: { type: "integer", minimum: 0, maximum: 100 },
            intensity: { type: "integer", minimum: 0, maximum: 100 },
            logoMode: { type: "string", enum: ["off", "small", "prominent"] },
            captionMode: { type: "string", enum: ["off", "minimal", "full"] },
            albumArtMode: { type: "string", enum: ["off", "corner", "hero", "ambient"] }
          }
        },
        steps: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["reason", "brightness", "transitionMs", "effect", "speed", "intensity", "palette", "primaryColor", "secondaryColor"],
            properties: {
              reason: { type: "string" },
              brightness: { type: "integer" },
              transitionMs: { type: "integer" },
              effect: { type: "integer", enum: SAFE_EFFECTS },
              speed: { type: "integer" },
              intensity: { type: "integer" },
              palette: { type: "integer", enum: SAFE_PALETTES },
              primaryColor: { type: "array", minItems: 4, maxItems: 4, items: { type: "integer" } },
              secondaryColor: { type: "array", minItems: 4, maxItems: 4, items: { type: "integer" } }
            }
          }
        }
      }
    };
  }
```

- [ ] **Step 2: Add `buildSketchContext` after `buildAiLightshowContext` (~line 1350)**

This builds context synchronously, skipping the slow WLED snapshot:

```typescript
  private buildSketchContext(state: PlayerState): Pick<AiLightshowContext, "song" | "audioProfile" | "roomLighting" | "tvOutput" | "safetyRules"> {
    const details = state.videoDetails;
    const albumArtUrl = this.getBestThumbnailUrl(details?.thumbnails);
    const durationSeconds = details?.durationSeconds ?? 0;
    const progressPercent = durationSeconds ? Math.min(100, Math.max(0, Math.round((state.videoProgress / durationSeconds) * 100))) : 0;
    const audioProfile = getLatestTvAudioProfile();

    return {
      song: {
        title: details?.title ?? "Unknown track",
        artist: details?.author ?? "Unknown artist",
        album: details?.album ?? "",
        albumArtUrl,
        durationSeconds,
        videoType: String(details?.videoType ?? ""),
        isLive: Boolean(details?.isLive),
        likeStatus: String(details?.likeStatus ?? ""),
        volume: state.volume,
        progressSeconds: state.videoProgress,
        progressPercent,
        status: this.videoStateName(state.trackState)
      },
      audioProfile,
      tvOutput: {
        vuStyle: this.currentVisualScene?.vuStyle ?? "bars",
        albumArtAvailable: Boolean(albumArtUrl),
        albumArtModeChoices: ["off", "corner", "hero", "ambient"],
        visualizerChoices: ["vuBars", "vuDots", "spectrumLine", "none"],
        captionChoices: ["off", "minimal", "full"]
      },
      roomLighting: {
        topology: "A single WLED string is mounted behind the TV as ambient bias lighting that washes the wall around the screen.",
        colorStrategy: "Treat the LEDs as a wall-wash extension of the TV image. Match or gently complement screen-edge colors, avoid overpowering the display, and morph hue/brightness slowly during a song."
      },
      safetyRules: {
        noStrobe: true,
        noBlinkingEffects: true,
        noAbruptMidSongArtifactColorChanges: true,
        useOnlySafeEffectIds: SAFE_EFFECTS,
        useOnlySafePaletteIds: SAFE_PALETTES,
        maxBrightness: 220,
        minTransitionMs: 600
      }
    };
  }
```

- [ ] **Step 3: Add `requestSketchPlan` after `requestCollaborativePlan`**

```typescript
  private async requestSketchPlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    const provider = this.getSketchAiProvider();
    const context = this.buildSketchContext(state);
    const albumArtUrl = this.getBestThumbnailUrl(state.videoDetails?.thumbnails);
    const visionEnabled = Boolean(this.store.get("integrations.lightssVisionEnabled") ?? true);
    const imageUrl = visionEnabled && albumArtUrl && VISION_CAPABLE_PROVIDERS.includes(provider.provider) ? albumArtUrl : undefined;

    log.info(`Lightss: sketch agent (${provider.provider}/${provider.model}) analyzing "${context.song.title}"${imageUrl ? " with album art" : ""}`);
    this.emitAiMessage("Sketch plan", `Sketch agent (${provider.provider}) analyzing ${context.song.title}...`, {
      provider: provider.provider,
      model: provider.model,
      aiStatus: "planning",
      lightStatus: "idle",
      planPhase: "sketch"
    });

    const systemPrompt = [
      "You are a music visualizer AI. Analyze the song from its title, artist, album, audio profile, and album art (if provided), then design a complete light show and TV display.",
      "Begin by determining the genre, mood, estimated BPM, and a creative visual concept that guides all your choices.",
      "Then fill every field in the response schema with safe, elegant settings that match the song's energy.",
      "Rules: no strobe, no blinking effects, long transitions (transitionMs >= 900), safe TV host persona.",
      "Do not make abrupt color changes to TV artifacts mid-song.",
      "Soften flash and transition intensity — keep them elegant and cinematic.",
      `Use only effect IDs from: ${SAFE_EFFECTS.join(",")} and palette IDs from: ${SAFE_PALETTES.join(",")}.`,
      "Keep the host line under 140 characters. Make it vivid and specific to this track.",
      "Return JSON matching the schema precisely."
    ].join("\n");

    const userPrompt = JSON.stringify({
      song: context.song,
      audioProfile: context.audioProfile,
      roomLighting: context.roomLighting,
      tvOutput: context.tvOutput,
      safetyRules: context.safetyRules
    });

    type SketchResult = {
      genre: string;
      mood: string;
      bpm: number;
      rationale: string;
      hostLine: string;
      tickerMessage: string;
      displayTheme: AiLightshowDisplayTheme;
      visualScene: AiLightshowVisualScene;
      steps: AiLightshowStep[];
    };

    const result = await this.queryAgent<SketchResult>(
      "Sketch Agent",
      provider,
      systemPrompt,
      userPrompt,
      this.getSketchAgentSchema(),
      "sketch_plan",
      imageUrl,
      SKETCH_TIMEOUT_MS
    );

    if (!result) return null;

    const rawSteps: Partial<AiLightshowStep>[] = Array.isArray(result.steps) ? result.steps : [];
    const sanitizedSteps = rawSteps.map(step => this.sanitizeAiStep(step));
    while (sanitizedSteps.length < AI_PLAN_STEP_COUNT) {
      sanitizedSteps.push(this.sanitizeAiStep({
        reason: "Safe sketch step",
        brightness: 150,
        transitionMs: 1200,
        effect: 98,
        speed: 100,
        intensity: 100,
        palette: 0,
        primaryColor: [120, 64, 180, 0],
        secondaryColor: [32, 180, 160, 0]
      }));
    }

    return {
      genre: this.safeString(result.genre, "ambient"),
      mood: this.safeString(result.mood, "chill"),
      bpm: this.clampNumber(result.bpm, 60, 180, 95),
      rationale: this.safeString(result.rationale, "AI sketch plan"),
      hostLine: this.safeString(result.hostLine, "Getting the vibe right..."),
      displayTheme: this.sanitizeDisplayTheme(result.displayTheme, sanitizedSteps[0]),
      visualScene: this.sanitizeVisualScene(result.visualScene),
      tickerMessage: this.safeString(result.tickerMessage, "Sketch plan — full analysis loading..."),
      steps: sanitizedSteps
    };
  }
```

- [ ] **Step 4: Run typecheck**

```bash
yarn typecheck
```

Expected: errors about `queryAgent` receiving 8 arguments (it currently takes 6). That is expected here — Task 4 adds the new parameters. If there are unrelated errors, fix them first.

- [ ] **Step 5: Commit (even with the typecheck failure — it will be fixed in Task 4)**

```bash
git add src/main/integrations/lightss/index.ts
git commit -m "feat(lightss): add sketch agent schema, buildSketchContext, and requestSketchPlan"
```

---

### Task 4: Lightss — Vision Input in `queryAgent`

**Files:**
- Modify: `src/main/integrations/lightss/index.ts`

- [ ] **Step 1: Update `queryAgent` signature to accept `imageUrl` and `timeoutOverride`**

Find the current `queryAgent` signature (~line 569):

```typescript
  private async queryAgent<T>(
    agentName: string,
    provider: AiProviderDetails,
    systemPrompt: string,
    userPrompt: string,
    schema: JsonValue,
    schemaName: string
  ): Promise<T | null> {
    const timeout =
      provider.provider === LightssAiProvider.Ollama
        ? OLLAMA_TIMEOUT_MS
        : provider.provider === LightssAiProvider.Gemini
        ? GEMINI_TIMEOUT_MS
        : OPENAI_TIMEOUT_MS;
```

Replace with:

```typescript
  private async queryAgent<T>(
    agentName: string,
    provider: AiProviderDetails,
    systemPrompt: string,
    userPrompt: string,
    schema: JsonValue,
    schemaName: string,
    imageUrl?: string,
    timeoutOverride?: number
  ): Promise<T | null> {
    const timeout =
      timeoutOverride ??
      (provider.provider === LightssAiProvider.Ollama
        ? OLLAMA_TIMEOUT_MS
        : provider.provider === LightssAiProvider.Gemini
        ? GEMINI_TIMEOUT_MS
        : OPENAI_TIMEOUT_MS);
```

- [ ] **Step 2: Add vision to the Ollama branch**

In `queryAgent`, find the Ollama branch (starts `if (provider.provider === LightssAiProvider.Ollama)`). Replace the `prompt` field construction:

```typescript
        // Before:
        prompt: `${systemPrompt}\n\nSong Context:\n${userPrompt}`

        // After:
        prompt: imageUrl
          ? `${systemPrompt}\n\nAlbum art URL (use as visual context): ${imageUrl}\n\nSong Context:\n${userPrompt}`
          : `${systemPrompt}\n\nSong Context:\n${userPrompt}`,
```

- [ ] **Step 3: Add vision to the OpenRouter branch**

In `queryAgent`, find the OpenRouter branch. Change the `messages` array:

```typescript
        // Before:
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],

        // After:
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: imageUrl
              ? [
                  { type: "text", text: userPrompt },
                  { type: "image_url", image_url: { url: imageUrl } }
                ]
              : userPrompt
          }
        ],
```

- [ ] **Step 4: Add vision to the Gemini branch**

In `queryAgent`, find the Gemini `contents` construction. Replace the `parts` array:

```typescript
        // Before:
        contents: [
          {
            role: "user",
            parts: [
              { text: `System Instructions:\n${systemPrompt}\n\nSong Context:\n${userPrompt}` }
            ]
          }
        ],

        // After:
        contents: [
          {
            role: "user",
            parts: [
              { text: `System Instructions:\n${systemPrompt}\n\nSong Context:\n${userPrompt}` },
              ...(imageUrl ? [{ fileUri: imageUrl, mimeType: "image/jpeg" as const }] : [])
            ]
          }
        ],
```

- [ ] **Step 5: Add vision to the OpenAI branch**

In `queryAgent`, find the OpenAI `input` array construction. Replace the user message content:

```typescript
        // Before:
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }]
          },
          {
            role: "user",
            content: [{ type: "input_text", text: userPrompt }]
          }
        ],

        // After:
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: systemPrompt }]
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: userPrompt },
              ...(imageUrl ? [{ type: "input_image", image_url: imageUrl }] : [])
            ]
          }
        ],
```

- [ ] **Step 6: Add `planPhase` to `emitAiMessage` options type and body**

Find the `emitAiMessage` method. Change its options type to include `planPhase`:

```typescript
  private emitAiMessage(
    title: string,
    message: string,
    options: Partial<AiProviderDetails> &
      Pick<Partial<RendererLightssAiMessage>, "aiStatus" | "wledStatus" | "lightStatus" | "displayTheme" | "tickerMessage" | "hostLine" | "planPhase"> & {
        plan?: AiLightshowPlan;
      } = {}
  ): void {
```

Then inside the function body, add `planPhase` to the `aiMessage` object:

```typescript
    const aiMessage: RendererLightssAiMessage = {
      title,
      message,
      provider: options.provider ?? providerDetails.provider,
      model: options.model ?? providerDetails.model,
      aiStatus: options.aiStatus,
      wledStatus: options.wledStatus,
      lightStatus: options.lightStatus,
      mood: plan?.mood,
      genre: plan?.genre,
      bpm: plan?.bpm,
      displayTheme,
      visualScene,
      tickerMessage: options.tickerMessage ?? plan?.tickerMessage,
      hostLine: options.hostLine ?? plan?.hostLine,
      planPhase: options.planPhase,        // ← add this line
      timestamp: Date.now()
    };
```

- [ ] **Step 7: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors. The `requestSketchPlan` call to `queryAgent` with 8 args now resolves.

- [ ] **Step 8: Commit**

```bash
git add src/main/integrations/lightss/index.ts
git commit -m "feat(lightss): add vision input and planPhase to queryAgent and emitAiMessage"
```

---

### Task 5: Lightss — Remove Serial Analyst from `requestCollaborativePlan`

**Files:**
- Modify: `src/main/integrations/lightss/index.ts`

- [ ] **Step 1: Build the analyst preamble helper**

Add this private method after `getAnalystAiProvider`:

```typescript
  private getAnalystPreamble(): string {
    const customPrompt = (this.store.get("integrations.lightssAnalystPrompt") as string | null)?.trim();
    const base = "Begin by briefly analyzing the song's genre, mood, and energy from the context and album art provided. Then produce your specialized output.";
    return customPrompt ? `${base}\nAdditional style guidance: ${customPrompt}` : base;
  }
```

- [ ] **Step 2: Rewrite `requestCollaborativePlan` to remove the serial analyst call**

Find `requestCollaborativePlan` (~line 356). Replace the entire method body with the version below (keep the method signature unchanged):

```typescript
  private async requestCollaborativePlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    const wledProvider = this.getWledAiProvider();
    const canvasProvider = this.getCanvasAiProvider();
    const hostProvider = this.getHostAiProvider();
    const visionEnabled = Boolean(this.store.get("integrations.lightssVisionEnabled") ?? true);
    const albumArtUrl = this.getBestThumbnailUrl(state.videoDetails?.thumbnails);

    log.info(
      `Lightss: starting parallel planning — WLED (${wledProvider.provider}/${wledProvider.model}), Canvas (${canvasProvider.provider}/${canvasProvider.model}), Host (${hostProvider.provider}/${hostProvider.model})`
    );

    const context = await this.buildAiLightshowContext(state);
    const userPrompt = JSON.stringify({
      song: context.song,
      audioProfile: context.audioProfile,
      roomLighting: context.roomLighting,
      tvOutput: context.tvOutput
    });

    const analystPreamble = this.getAnalystPreamble();

    const wledSystemPromptFromStore = (this.store.get("integrations.lightssWledPrompt") as string | null) ||
      [
        "You are the WLED Control Agent for an agentic home theater. Your role is to choose safe WLED lighting settings.",
        "Return JSON matching the schema precisely.",
        "Rules: No strobe, blinking, or sudden flashing.",
        "Always soften transition and flash intensity. Long transitions (transitionMs >= 900) are required.",
        "Generate a sequence of exactly 4 steps representing the song's energy progression (e.g. verse, chorus, bridge, outro).",
        "Use only safe effect and palette IDs.",
        "Avoid mid-song jumps; morph colors gradually."
      ].join("\n");

    const wledSystemPrompt = `${analystPreamble}\n\n${
      wledSystemPromptFromStore.includes(SAFE_EFFECTS.join(","))
        ? wledSystemPromptFromStore
        : `${wledSystemPromptFromStore}\nUse only effect IDs from: ${SAFE_EFFECTS.join(",")} and palette IDs from: ${SAFE_PALETTES.join(",")}.`
    }`;

    const canvasSystemPrompt = `${analystPreamble}\n\n${
      (this.store.get("integrations.lightssCanvasPrompt") as string | null) ||
      [
        "You are the Screen Drawing and TV Canvas Agent for an agentic display.",
        "Your role is to design premium TV layouts and visualizer styling.",
        "Keep a true black base (#000000 background) for maximum contrast and TV protection.",
        "Avoid all flashing, strobing, or bright-white sweeps. Visual elements must move slowly and elegantly.",
        "Choose colors (backgroundColor, accentColor, vuLowColor, vuMidColor, vuHighColor) that feel like one coordinated scene.",
        "Return JSON matching the schema precisely."
      ].join("\n")
    }`;

    const hostSystemPrompt = `${analystPreamble}\n\n${
      (this.store.get("integrations.lightssHostPrompt") as string | null) ||
      [
        "You are the late-night VJ and Scrolling Ticker Agent.",
        "Generate scrolling facts, commentary, and status updates for the TV host line and scrolling bottom ticker.",
        "Write one vivid, personality-filled host line under 140 characters. Keep it late-night VJ style, aware of the track.",
        "Write a ticker message as a single, concise line of fun facts, lighting notes, or playful host commentary.",
        "Return JSON matching the schema precisely."
      ].join("\n")
    }`;

    const imageUrl = visionEnabled && albumArtUrl && VISION_CAPABLE_PROVIDERS.includes(wledProvider.provider) ? albumArtUrl : undefined;

    this.emitAiMessage(
      "Full plan",
      `WLED, Canvas, and VJ agents running in parallel for "${context.song.title}"...`,
      { aiStatus: "planning", lightStatus: "idle", planPhase: "full" }
    );

    try {
      const [wledRes, canvasRes, hostRes] = await Promise.all([
        this.queryAgent<{ genre: string; mood: string; bpm: number; rationale: string; steps: AiLightshowStep[] }>(
          "WLED Control Agent", wledProvider, wledSystemPrompt, userPrompt, this.getWledAgentSchema(), "wled_plan", imageUrl
        ),
        this.queryAgent<{ displayTheme: AiLightshowDisplayTheme; visualScene: AiLightshowVisualScene }>(
          "TV Canvas Agent", canvasProvider, canvasSystemPrompt, userPrompt, this.getCanvasAgentSchema(), "canvas_theme",
          visionEnabled && albumArtUrl && VISION_CAPABLE_PROVIDERS.includes(canvasProvider.provider) ? albumArtUrl : undefined
        ),
        this.queryAgent<{ hostLine: string; tickerMessage: string }>(
          "VJ Host Agent", hostProvider, hostSystemPrompt, userPrompt, this.getHostAgentSchema(), "host_vj",
          visionEnabled && albumArtUrl && VISION_CAPABLE_PROVIDERS.includes(hostProvider.provider) ? albumArtUrl : undefined
        )
      ]);

      if (!wledRes && !canvasRes && !hostRes) {
        throw new Error("All collaborative agents failed to respond.");
      }

      const steps = wledRes?.steps || [];
      const sanitizedSteps =
        steps.length > 0
          ? steps.map(step => this.sanitizeAiStep(step))
          : Array(AI_PLAN_STEP_COUNT).fill(null).map(() =>
              this.sanitizeAiStep({
                reason: "Safe backup light step",
                brightness: 150,
                transitionMs: 1200,
                effect: 98,
                speed: 100,
                intensity: 100,
                palette: 0,
                primaryColor: [120, 64, 180, 0],
                secondaryColor: [32, 180, 160, 0]
              })
            );

      while (sanitizedSteps.length < AI_PLAN_STEP_COUNT) {
        sanitizedSteps.push(sanitizedSteps[sanitizedSteps.length - 1]);
      }

      const mergedPlan: AiLightshowPlan = {
        genre: this.safeString(wledRes?.genre, "ambient"),
        mood: this.safeString(wledRes?.mood, "chill"),
        bpm: this.clampNumber(wledRes?.bpm, 60, 180, 95),
        rationale: this.safeString(wledRes?.rationale, "Full collaborative plan"),
        hostLine: this.safeString(hostRes?.hostLine, "Tuning the room and the screen to this premium vibe."),
        displayTheme: this.sanitizeDisplayTheme(canvasRes?.displayTheme, sanitizedSteps[0]),
        visualScene: this.sanitizeVisualScene(canvasRes?.visualScene),
        tickerMessage: this.safeString(hostRes?.tickerMessage, "VJ: Coordinated canvas visualizers and ambient WLED backing aligned."),
        steps: sanitizedSteps
      };

      this.emitAiMessage("Full plan ready", mergedPlan.hostLine || mergedPlan.rationale, {
        plan: mergedPlan,
        hostLine: mergedPlan.hostLine,
        aiStatus: "connected",
        lightStatus: "idle",
        planPhase: "full"
      });

      return mergedPlan;
    } catch (err) {
      log.error("Lightss: full collaborative plan failed:", err);
      this.emitAiMessage("Planning failed", "Full agents could not complete. Sketch plan remains active.", {
        aiStatus: "failed",
        lightStatus: "idle"
      });
      return null;
    }
  }
```

- [ ] **Step 3: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/integrations/lightss/index.ts
git commit -m "feat(lightss): remove serial analyst call, embed inline preamble in parallel agents"
```

---

### Task 6: Lightss — Two-Track State Machine

**Files:**
- Modify: `src/main/integrations/lightss/index.ts`

This is the main pipeline refactor. Replace the existing `onPlayerStateChanged`, `debounceSongChange`, `startReactiveMode`, `stopReactiveMode`, `planAndApplyAiScene`, `getTrackKey`, and `ensureAiPlan` methods with the new two-track system.

- [ ] **Step 1: Replace the body of `disable()` with an updated reset block**

Find the `disable()` method. Replace the reset block (everything after the `stateCallback` removal) with:

```typescript
    this.lastVideoId = null;
    this.aiPlan = null;
    this.aiPlanIndex = 0;
    this.planPhase = null;
    this.aiPlanRefreshedAt50 = false;
    this.sketchPlanPromise = null;
    this.fullPlanPromise = null;
    this.currentPlanVideoId = null;
    this.currentDisplayTheme = null;
    this.currentVisualScene = null;
    this.stopReactiveMode();
```

This removes the old references to `aiPlanTrackKey`, `aiPlanPromise`, and `debounceTimeout` that will no longer exist as class fields after Step 6.

- [ ] **Step 2: Replace `onPlayerStateChanged`**

Find and replace the entire `onPlayerStateChanged` method:

```typescript
  private onPlayerStateChanged(state: PlayerState): void {
    if (!state.videoDetails) {
      this.lastVideoId = null;
      this.stopReactiveMode();
      return;
    }

    const isPlaying = state.trackState === VideoState.Playing;
    const videoId = state.videoDetails.id;

    if (videoId !== this.lastVideoId) {
      this.lastVideoId = videoId;
      this.resetPlanState();
      if (isPlaying) {
        this.kickOffBothPlans(state);
      }
    } else if (isPlaying && this.planPhase === "full" && !this.aiPlanRefreshedAt50) {
      const durationSeconds = state.videoDetails.durationSeconds ?? 0;
      if (durationSeconds > 240 && state.videoProgress / durationSeconds >= 0.5) {
        this.aiPlanRefreshedAt50 = true;
        this.kickOffFullPlan(state);
      }
    }

    if (isPlaying) {
      if (!this.aiPlan && !this.sketchPlanPromise && !this.fullPlanPromise) {
        this.kickOffBothPlans(state);
      } else if (this.aiPlan && !this.aiLightshowInterval) {
        this.startReactiveMode();
      }
    } else {
      this.stopReactiveMode();
    }
  }
```

- [ ] **Step 3: Remove `debounceSongChange` and replace `ensureAiPlan` and `getTrackKey` with new methods**

Delete the `debounceSongChange`, `getTrackKey`, and `ensureAiPlan` methods entirely.

Add these new methods in their place:

```typescript
  private resetPlanState(): void {
    this.aiPlan = null;
    this.aiPlanIndex = 0;
    this.planPhase = null;
    this.aiPlanRefreshedAt50 = false;
    this.currentDisplayTheme = null;
    this.currentVisualScene = null;
    this.sketchPlanPromise = null;
    this.fullPlanPromise = null;
    this.stopReactiveMode();
  }

  private kickOffBothPlans(state: PlayerState): void {
    this.kickOffSketch(state);
    this.kickOffFullPlan(state);
  }

  private kickOffSketch(state: PlayerState): void {
    if (this.sketchPlanPromise) return;
    const videoId = state.videoDetails?.id ?? "";

    if (this.sketchPlanCache.has(videoId)) {
      const cached = this.sketchPlanCache.get(videoId)!;
      if (!this.aiPlan) {
        this.applyPlan(cached, "sketch", "Cached sketch plan applied.");
      }
      return;
    }

    this.sketchPlanPromise = this.requestSketchPlan(state)
      .then(plan => {
        if (!plan || this.lastVideoId !== videoId) return;
        if (this.sketchPlanCache.size >= 100) {
          const firstKey = this.sketchPlanCache.keys().next().value;
          if (firstKey) this.sketchPlanCache.delete(firstKey);
        }
        this.sketchPlanCache.set(videoId, plan);
        if (!this.aiPlan) {
          this.applyPlan(plan, "sketch", "Sketch plan applied, full analysis loading...");
        }
      })
      .catch(err => {
        log.warn("Lightss: sketch plan failed:", err);
      })
      .finally(() => {
        this.sketchPlanPromise = null;
      });
  }

  private kickOffFullPlan(state: PlayerState): void {
    if (this.fullPlanPromise) return;
    const videoId = state.videoDetails?.id ?? "";

    if (this.planCache.has(videoId)) {
      const cached = this.planCache.get(videoId)!;
      this.applyPlan(cached, "full", cached.hostLine || cached.rationale);
      return;
    }

    this.fullPlanPromise = this.requestCollaborativePlan(state)
      .then(plan => {
        if (!plan || this.lastVideoId !== videoId) return;
        if (this.planCache.size >= 100) {
          const firstKey = this.planCache.keys().next().value;
          if (firstKey) this.planCache.delete(firstKey);
        }
        this.planCache.set(videoId, plan);
        this.applyPlan(plan, "full", plan.hostLine || plan.rationale);
      })
      .finally(() => {
        this.fullPlanPromise = null;
      });
  }

  private applyPlan(plan: AiLightshowPlan, phase: "sketch" | "full", message: string): void {
    const isUpgrade = phase === "full" && this.planPhase === "sketch";
    this.aiPlan = plan;
    this.planPhase = phase;
    this.currentDisplayTheme = plan.displayTheme;
    this.currentVisualScene = plan.visualScene;

    this.emitAiMessage(
      phase === "sketch" ? "Sketch ready" : isUpgrade ? "Full plan ready" : "Plan ready",
      message,
      { plan, hostLine: plan.hostLine, aiStatus: "connected", lightStatus: "idle", planPhase: phase }
    );

    if (!isUpgrade) {
      this.aiPlanIndex = 0;
      const step = plan.steps[0];
      this.aiPlanIndex = 1;
      void this.postWledState(this.buildWledPayloadFromAiStep(step), `${phase} plan start`, step.reason, step);
    }

    const currentState = playerStateStore.getState();
    if (currentState.trackState === VideoState.Playing) {
      this.startReactiveMode();
    }
  }
```

- [ ] **Step 4: Replace `startReactiveMode` and `planAndApplyAiScene` with slim versions**

Find and replace `startReactiveMode` and `planAndApplyAiScene`:

```typescript
  private startReactiveMode(): void {
    if (!this.store.get("integrations.lightssReactiveEnabled")) return;
    if (this.aiLightshowInterval) return;
    const intervalMs = this.getStepIntervalMs();
    log.info(`Lightss: starting step timer (${intervalMs}ms)`);
    this.aiLightshowInterval = setInterval(() => {
      const currentState = playerStateStore.getState();
      if (currentState.trackState !== VideoState.Playing) {
        this.stopReactiveMode();
        return;
      }
      this.advanceStep();
    }, intervalMs);
  }

  private advanceStep(): void {
    if (!this.aiPlan || this.aiPlan.steps.length === 0) return;
    const step = this.aiPlan.steps[this.aiPlanIndex % this.aiPlan.steps.length];
    this.aiPlanIndex += 1;
    this.emitAiMessage("Light step", step.reason, {
      plan: this.aiPlan,
      hostLine: this.aiPlan.hostLine,
      planPhase: this.planPhase ?? undefined
    });
    void this.postWledState(this.buildWledPayloadFromAiStep(step), "lightshow step", step.reason, step);
  }
```

Delete the old `planAndApplyAiScene` method.

Also remove the now-unused `aiPlanTrackKey`, `aiPlanPromise`, `aiPlanRetryAfter` class fields. Keep `debounceTimeout` removal too (no longer needed).

- [ ] **Step 5: Remove unused `debounceTimeout` field and references**

Remove `private debounceTimeout: NodeJS.Timeout | null = null;` from the class fields.

In `disable()`, remove the block:
```typescript
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }
```

- [ ] **Step 6: Remove now-unused private fields from class declaration**

Remove:
- `private aiPlanTrackKey: string | null = null;`
- `private aiPlanPromise: Promise<AiLightshowPlan | null> | null = null;`
- `private aiPlanRetryAfter = 0;`
- `private debounceTimeout: NodeJS.Timeout | null = null;`

And remove any remaining references to `this.aiPlanTrackKey`, `this.aiPlanPromise`, `this.aiPlanRetryAfter` throughout the file (only in disable/reset code).

Also find and remove the now-empty `disable()` reference to `this.lastVideoId = null;` duplicate check — keep it once.

- [ ] **Step 7: Update `buildAiLightshowContext` to remove the now-stale planCache write**

The planCache write that was inside `requestCollaborativePlan` was already removed in Task 5 (it now writes in `kickOffFullPlan`). Verify there are no remaining planCache writes inside `requestCollaborativePlan`.

- [ ] **Step 8: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors. Fix any remaining references to removed fields or deleted methods.

- [ ] **Step 9: Run verify scripts**

```bash
yarn verify:player-shell && yarn verify:firetv-receiver
```

Expected: both pass. The legacy compat methods at the bottom of `index.ts` must remain untouched.

- [ ] **Step 10: Run lint**

```bash
yarn lint
```

Fix any lint errors.

- [ ] **Step 11: Commit**

```bash
git add src/main/integrations/lightss/index.ts
git commit -m "feat(lightss): two-track pipeline — sketch fires immediately, full plan upgrades in background"
```

---

### Task 7: Settings UI — Sketch Agent Subsection

**Files:**
- Modify: `src/renderer/windows/settings/Settings.vue`

- [ ] **Step 1: Add 4 new reactive refs after `lightssAnalystPrompt`**

After `const lightssAnalystPrompt = ref<string | null>(...)` (~line 116):

```typescript
const lightssSketchProvider = ref<LightssAiProvider>(integrations.lightssSketchProvider ?? LightssAiProvider.Gemini);
const lightssSketchModel = ref<string>(integrations.lightssSketchModel ?? "gemini-2.5-flash");
const lightssVisionEnabled = ref<boolean>(integrations.lightssVisionEnabled ?? true);
const lightssStepIntervalMs = ref<number>(integrations.lightssStepIntervalMs ?? 7000);
```

- [ ] **Step 2: Add 4 entries to `store.onDidAnyChange`**

After `lightssAnalystPrompt.value = newState.integrations.lightssAnalystPrompt ?? null;` (~line 203):

```typescript
  lightssSketchProvider.value = newState.integrations.lightssSketchProvider ?? LightssAiProvider.Gemini;
  lightssSketchModel.value = newState.integrations.lightssSketchModel ?? "gemini-2.5-flash";
  lightssVisionEnabled.value = newState.integrations.lightssVisionEnabled ?? true;
  lightssStepIntervalMs.value = newState.integrations.lightssStepIntervalMs ?? 7000;
```

- [ ] **Step 3: Add 4 entries to `settingsChanged()`**

After `store.set("integrations.lightssAnalystPrompt", lightssAnalystPrompt.value);`:

```typescript
  store.set("integrations.lightssSketchProvider", lightssSketchProvider.value);
  store.set("integrations.lightssSketchModel", lightssSketchModel.value);
  store.set("integrations.lightssVisionEnabled", lightssVisionEnabled.value);
  store.set("integrations.lightssStepIntervalMs", lightssStepIntervalMs.value);
```

- [ ] **Step 4: Add the Sketch Agent UI block in the template**

Find the Lightss settings section in the template. Add the Sketch Agent block directly above the existing per-agent provider cards (the WLED provider card). The block follows the same `<div class="setting-group">` pattern used by other agent cards:

```html
<!-- Sketch Agent -->
<div class="setting-group">
  <h4>⚡ Sketch Agent <span class="setting-hint">fires immediately on song change</span></h4>
  <div class="setting-row">
    <label>Provider</label>
    <select v-model="lightssSketchProvider" @change="settingsChanged">
      <option :value="LightssAiProvider.Gemini">Gemini</option>
      <option :value="LightssAiProvider.OpenAI">OpenAI</option>
      <option :value="LightssAiProvider.OpenRouter">OpenRouter</option>
      <option :value="LightssAiProvider.Ollama">Ollama</option>
    </select>
  </div>
  <div class="setting-row">
    <label>Model</label>
    <input v-model="lightssSketchModel" type="text" placeholder="gemini-2.5-flash" @change="settingsChanged" />
  </div>
  <div class="setting-row">
    <label>Album art vision input</label>
    <input v-model="lightssVisionEnabled" type="checkbox" @change="settingsChanged" />
  </div>
  <div class="setting-row">
    <label>Step interval (seconds)</label>
    <input
      v-model.number="lightssStepIntervalMs"
      type="number"
      min="3"
      max="30"
      step="1"
      @change="() => { lightssStepIntervalMs = Math.round(lightssStepIntervalMs * 1000); settingsChanged(); }"
    />
  </div>
</div>
```

**Note:** The step interval is stored in milliseconds but displayed in seconds. Adjust the model accordingly — display `lightssStepIntervalMs / 1000` and convert back on change. The simplest approach: use a separate computed `stepIntervalSecs` ref:

```typescript
const stepIntervalSecs = ref<number>((integrations.lightssStepIntervalMs ?? 7000) / 1000);
```

And save it:
```typescript
// In settingsChanged():
store.set("integrations.lightssStepIntervalMs", Math.round(stepIntervalSecs.value) * 1000);
```

Use `v-model="stepIntervalSecs"` in the input instead of `lightssStepIntervalMs`. This avoids a divide-by-1000 confusion in the template.

- [ ] **Step 5: Add an informational note under the Analyst card**

In the Analyst agent card section of the template, add a `<p class="setting-note">` below the provider/model dropdowns:

```html
<p class="setting-note">Provider and model are unused — only the custom prompt below applies (prepended to each agent).</p>
```

- [ ] **Step 6: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 7: Run verify-player-shell to confirm existing assertions still pass**

```bash
yarn verify:player-shell
```

Expected: passes. The verifier checks for specific strings like `integrations.lightssBridgePath ?? null` — confirm none were accidentally deleted.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/windows/settings/Settings.vue
git commit -m "feat(settings): add sketch agent provider, model, vision, and step interval controls"
```

---

### Task 8: SystemStatusPill — Phase Indicator

**Files:**
- Modify: `src/renderer/windows/main/player-shell/SystemStatusPill.vue`

- [ ] **Step 1: Add `planPhase` computed**

In the `<script setup>` block, after the `model` computed:

```typescript
const planPhase = computed(() => props.message?.planPhase ?? null);
```

- [ ] **Step 2: Update `title` computed to include phase prefix**

Replace the current `title` computed:

```typescript
// Before:
const title = computed(() => props.message?.title ?? "AI Lightshow");

// After:
const title = computed(() => {
  const base = props.message?.title ?? "AI Lightshow";
  if (planPhase.value === "sketch") return `⚡ ${base}`;
  return base;
});
```

- [ ] **Step 3: Run typecheck**

```bash
yarn typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/windows/main/player-shell/SystemStatusPill.vue
git commit -m "feat(ui): show ⚡ Draft phase indicator in status pill during sketch plan"
```

---

### Task 9: Add Verify Assertions for New Features

**Files:**
- Modify: `scripts/verify-player-shell.mjs`

- [ ] **Step 1: Add schema assertions for the 4 new keys**

In `verify-player-shell.mjs`, after the existing `lightssOllamaModel` assertion:

```javascript
assertIncludes(schema, "lightssSketchProvider: LightssAiProvider;");
assertIncludes(schema, "lightssSketchModel: string;");
assertIncludes(schema, "lightssVisionEnabled: boolean;");
assertIncludes(schema, "lightssStepIntervalMs: number;");
```

- [ ] **Step 2: Add lightss/index.ts assertions for new constants and methods**

After the existing `djGptRealtime` assertion:

```javascript
assertIncludes("src/main/integrations/lightss/index.ts", "SKETCH_TIMEOUT_MS");
assertIncludes("src/main/integrations/lightss/index.ts", "VISION_CAPABLE_PROVIDERS");
assertIncludes("src/main/integrations/lightss/index.ts", "requestSketchPlan");
assertIncludes("src/main/integrations/lightss/index.ts", "kickOffBothPlans");
assertIncludes("src/main/integrations/lightss/index.ts", "planPhase");
assertIncludes("src/main/integrations/lightss/index.ts", "getStepIntervalMs");
```

- [ ] **Step 3: Add settings assertions for new controls**

After the existing `lightssAnalystPrompt` assertion:

```javascript
assertIncludes(settings, "integrations.lightssSketchProvider ?? LightssAiProvider.Gemini");
assertIncludes(settings, 'integrations.lightssSketchModel ?? "gemini-2.5-flash"');
assertIncludes(settings, "integrations.lightssVisionEnabled ?? true");
```

- [ ] **Step 4: Run all verify scripts and lint**

```bash
yarn verify:player-shell && yarn verify:firetv-receiver && yarn lint && yarn typecheck
```

Expected: all pass.

- [ ] **Step 5: Smoke test**

Start the app, play a song with Lightss enabled, and confirm:
- A WLED step fires within ~3 seconds (sketch plan)
- The status pill shows "⚡ Sketch ready" then transitions to "Full plan ready"
- WLED steps continue every 7 seconds
- Replaying the same song applies the cached full plan immediately (no sketch phase)
- The step interval control in settings changes the timer when saved

- [ ] **Step 6: Final commit**

```bash
git add scripts/verify-player-shell.mjs
git commit -m "test(verify): add assertions for sketch agent, vision, two-track pipeline"
```
