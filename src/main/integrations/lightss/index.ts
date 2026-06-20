import Conf from "conf";
import { BrowserView } from "electron";
import log from "electron-log";
import http from "http";
import https from "https";
import playerStateStore, { PlayerState, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import type { RendererLightssAiMessage, RendererLightssVisualScene } from "../../../shared/player";
import { LightssAiProvider, type MemoryStoreSchema, type StoreSchema } from "../../../shared/store/schema";
import MemoryStore from "../../memory-store";
import { getLatestTvAudioProfile } from "../../tv-display-state";

const DEFAULT_WLED_HOST = "http://10.27.27.110";
const DEFAULT_OPENAI_MODEL = "gpt-5.5";
const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-2";
const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
const DEFAULT_OPENROUTER_MODEL = "openrouter/free";
const DEFAULT_OLLAMA_BASE_URL = "http://10.27.27.10:11434";
const DEFAULT_OLLAMA_MODEL = "kimi-k2.7-code:cloud";
const WLED_TIMEOUT_MS = 2500;
const OPENAI_TIMEOUT_MS = 20000;
const OLLAMA_TIMEOUT_MS = 45000;
const AI_LIGHTSHOW_INTERVAL_MS = 14000;
const AI_PLAN_STEP_COUNT = 4;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const SAFE_EFFECTS = [2, 8, 9, 12, 28, 30, 33, 37, 52, 54, 62, 63, 64, 67, 74, 76, 90, 92, 98, 105, 108, 115, 120, 122, 130, 162, 163, 172, 179, 183];
const SAFE_PALETTES = [0, 1, 4, 5, 7, 8, 9, 11, 13, 22, 25, 26, 33, 39, 43, 46, 50, 52, 55, 61, 68];

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type WledSegmentPayload = {
  col?: number[][];
  fx?: number;
  sx?: number;
  ix?: number;
  pal?: number;
};

type WledPayload = {
  on?: boolean;
  bri?: number;
  transition?: number;
  seg?: WledSegmentPayload[];
};

type AiLightshowStep = {
  reason: string;
  brightness: number;
  transitionMs: number;
  effect: number;
  speed: number;
  intensity: number;
  palette: number;
  primaryColor: number[];
  secondaryColor: number[];
};

type AiLightshowDisplayTheme = {
  fontFamily: "system" | "display" | "mono";
  backgroundColor: string;
  accentColor: string;
  vuLowColor: string;
  vuMidColor: string;
  vuHighColor: string;
};

type AiLightshowVisualScene = {
  backgroundStyle: RendererLightssVisualScene["backgroundStyle"];
  visualizerStyle: RendererLightssVisualScene["visualizerStyle"];
  vuStyle: RendererLightssVisualScene["vuStyle"];
  motion: RendererLightssVisualScene["motion"];
  density: number;
  intensity: number;
  logoMode: RendererLightssVisualScene["logoMode"];
  captionMode: RendererLightssVisualScene["captionMode"];
  albumArtMode: RendererLightssVisualScene["albumArtMode"];
};

type AiLightshowPlan = {
  genre: string;
  mood: string;
  bpm: number;
  rationale: string;
  hostLine: string;
  displayTheme: AiLightshowDisplayTheme;
  visualScene: AiLightshowVisualScene;
  tickerMessage: string;
  steps: AiLightshowStep[];
};

type AiLightshowContext = {
  song: {
    title: string;
    artist: string;
    album: string;
    albumArtUrl: string;
    durationSeconds: number;
    videoType: string;
    isLive: boolean;
    likeStatus: string;
    volume: number;
    progressSeconds: number;
    progressPercent: number;
    status: string;
  };
  audioProfile: {
    live: boolean;
    updatedAt: number;
    energy: number;
    bass: number;
    mid: number;
    treble: number;
    bins: number[];
  };
  tvOutput: {
    vuStyle: RendererLightssVisualScene["vuStyle"];
    albumArtAvailable: boolean;
    albumArtModeChoices: RendererLightssVisualScene["albumArtMode"][];
    visualizerChoices: RendererLightssVisualScene["visualizerStyle"][];
    captionChoices: RendererLightssVisualScene["captionMode"][];
  };
  hostPersonality: {
    voice: string;
    hostLineRules: string;
    roomBrief: string;
  };
  roomLighting: {
    topology: string;
    colorStrategy: string;
  };
  djGptRealtime: {
    availableWhenOpenAIKeyIsConfigured: boolean;
    model: string;
    voice: string;
    role: string;
  };
  inferredMetadataInstructions: string;
  safetyRules: {
    noStrobe: boolean;
    noBlinkingEffects: boolean;
    noAbruptMidSongArtifactColorChanges: boolean;
    useOnlySafeEffectIds: number[];
    useOnlySafePaletteIds: number[];
    maxBrightness: number;
    minTransitionMs: number;
  };
  wled: {
    host: string;
    snapshot: JsonValue | null;
  };
};

type AiProviderDetails = {
  provider: LightssAiProvider;
  model: string;
};

export default class LightssIntegration implements IIntegration {
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;
  private enabled = false;
  private stateCallback: (state: PlayerState) => void = null;
  private lastVideoId: string | null = null;
  private debounceTimeout: NodeJS.Timeout | null = null;
  private aiLightshowInterval: NodeJS.Timeout | null = null;
  private aiPlan: AiLightshowPlan | null = null;
  private aiPlanTrackKey: string | null = null;
  private aiPlanIndex = 0;
  private aiPlanPromise: Promise<AiLightshowPlan | null> | null = null;
  private aiPlanRetryAfter = 0;
  private aiMessageCallback: ((message: RendererLightssAiMessage) => void) | null = null;
  private currentDisplayTheme: AiLightshowDisplayTheme | null = null;
  private currentVisualScene: AiLightshowVisualScene | null = null;

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>, _ytmView: BrowserView): void {
    this.store = store;
    this.memoryStore = memoryStore;
    // _ytmView is unused but kept for a consistent provide() signature with other integrations.
    void this.memoryStore;
    void _ytmView;
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;

    this.stateCallback = state => this.onPlayerStateChanged(state);
    playerStateStore.addEventListener(this.stateCallback);
  }

  public disable(): void {
    if (!this.enabled) return;
    this.enabled = false;

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
      this.stateCallback = null;
    }

    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    this.lastVideoId = null;
    this.aiPlan = null;
    this.aiPlanTrackKey = null;
    this.aiPlanPromise = null;
    this.stopReactiveMode();
    this.currentVisualScene = null;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }

  public onAiMessage(callback: (message: RendererLightssAiMessage) => void): void {
    this.aiMessageCallback = callback;
  }

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
      this.aiPlan = null;
      this.aiPlanTrackKey = null;
      this.aiPlanIndex = 0;
      this.aiPlanPromise = null;
      this.aiPlanRetryAfter = 0;
      this.currentDisplayTheme = null;
      this.currentVisualScene = null;
      if (isPlaying) {
        this.debounceSongChange(state);
      }
    }

    if (isPlaying) {
      this.startReactiveMode(state);
    } else {
      this.stopReactiveMode();
    }
  }

  private debounceSongChange(state: PlayerState): void {
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
    }

    this.debounceTimeout = setTimeout(() => {
      this.debounceTimeout = null;
      void this.planAndApplyAiScene(state, "song change");
    }, 1500);
  }

  private startReactiveMode(state: PlayerState): void {
    if (!this.store.get("integrations.lightssReactiveEnabled")) return;
    if (this.aiLightshowInterval) return;

    log.info("Lightss: starting AI WLED lightshow");
    this.emitAiMessage("AI Lightshow", "Reading the current song and preparing a safe WLED plan.", { aiStatus: "planning", lightStatus: "idle" });
    void this.planAndApplyAiScene(state, "lightshow start");
    this.aiLightshowInterval = setInterval(() => {
      const currentState = playerStateStore.getState();
      if (currentState.trackState !== VideoState.Playing) {
        this.stopReactiveMode();
        return;
      }
      void this.planAndApplyAiScene(currentState, "lightshow step");
    }, AI_LIGHTSHOW_INTERVAL_MS);
  }

  private stopReactiveMode(): void {
    if (this.aiLightshowInterval) {
      log.info("Lightss: stopping AI WLED lightshow");
      clearInterval(this.aiLightshowInterval);
      this.aiLightshowInterval = null;
    }
  }

  private async planAndApplyAiScene(state: PlayerState, reason: string): Promise<void> {
    if (!this.store.get("integrations.lightssEnabled")) return;
    if (!state.videoDetails) return;

    const plan = await this.ensureAiPlan(state);
    if (!plan || plan.steps.length === 0) return;

    const step = plan.steps[this.aiPlanIndex % plan.steps.length];
    this.aiPlanIndex += 1;
    this.emitAiMessage("Light step", step.reason, { plan, hostLine: plan.hostLine });
    await this.postWledState(this.buildWledPayloadFromAiStep(step), reason, step.reason, step);
  }

  private async ensureAiPlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    if (!state.videoDetails) return null;

    const trackKey = `${state.videoDetails.id}:${state.videoDetails.author}:${state.videoDetails.title}`;
    if (this.aiPlan && this.aiPlanTrackKey === trackKey) return this.aiPlan;
    if (this.aiPlanPromise) return this.aiPlanPromise;
    if (Date.now() < this.aiPlanRetryAfter) {
      this.emitAiMessage("AI cooldown", "The last AI planning request timed out. Waiting before trying again.", { aiStatus: "failed", lightStatus: "idle" });
      return null;
    }

    this.aiPlanPromise = this.requestAiLightshowPlan(state)
      .then(plan => {
        this.aiPlan = plan;
        this.aiPlanTrackKey = plan ? trackKey : null;
        this.aiPlanIndex = 0;
        if (!plan) {
          this.aiPlanRetryAfter = Date.now() + 60000;
        }
        return plan;
      })
      .finally(() => {
        this.aiPlanPromise = null;
      });

    return this.aiPlanPromise;
  }

  private async requestAiLightshowPlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    const provider = this.getAiProvider();

    if (provider.provider === LightssAiProvider.Ollama) {
      return this.requestOllamaLightshowPlan(state);
    }

    if (provider.provider === LightssAiProvider.OpenRouter) {
      return this.requestOpenRouterLightshowPlan(state);
    }

    return this.requestOpenAiLightshowPlan(state);
  }

  private async requestOpenAiLightshowPlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    if (!state.videoDetails) return null;

    const apiKey = this.getOpenAIApiKey();
    if (!apiKey) {
      log.warn("Lightss: OPENAI_API_KEY or Lightss OpenAI API key is required for AI WLED lightshow");
      this.emitAiMessage("OpenAI unavailable", "Add an OpenAI API key in Settings or launch Youtopia with OPENAI_API_KEY set.", {
        provider: LightssAiProvider.OpenAI,
        model: this.getOpenAIModel(),
        aiStatus: "failed",
        lightStatus: "idle"
      });
      return null;
    }

    const model = this.getOpenAIModel();
    const context = await this.buildAiLightshowContext(state);

    log.info("Lightss: requesting OpenAI WLED lightshow plan for", context.song.title);
    this.emitAiMessage("OpenAI planning", `Asking ${model} to infer mood, BPM, and a safe light scene for ${context.song.title}.`, {
      provider: LightssAiProvider.OpenAI,
      model,
      aiStatus: "planning",
      lightStatus: "idle"
    });

    const response = await this.postJson<JsonValue>(
      new URL(OPENAI_RESPONSES_URL),
      {
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You are a WLED lightshow designer and safe TV host persona for music playback. Return a safe, non-strobe plan only. Effects and palettes must come from the provided allowlists. Match energy to the song, current VU/audio profile, playback progress, album art availability, and WLED snapshot. Infer missing BPM/genre/mood, and avoid flashing or sudden transitions. Always soften flash and transition intensity; visually fatiguing flash is not acceptable even when it is not technically a strobe. Do not make abrupt color changes to TV artifacts, backgrounds, album art treatments, VU colors, or LED palettes mid-song; morph them gradually unless the track changes. Choose a displayTheme so the TV VU, AI commentary font, and WLED colors feel like one coordinated scene. Also choose a safe visualScene object for the TV show engine that avoids strobe/blink or rapid flashing visuals. Include hostLine as a short late-night VJ line with personality, and tickerMessage with one concise line of fun song facts, lightshow commentary, or playful host personality for a bottom TV ticker."
              }
            ]
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(context)
              }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "wled_lightshow_plan",
            strict: true,
            schema: this.getAiPlanSchema()
          }
        },
        max_output_tokens: 1400
      },
      OPENAI_TIMEOUT_MS,
      {
        Authorization: `Bearer ${apiKey}`
      }
    );

    const outputText = this.extractOpenAIOutputText(response);
    if (!outputText) {
      log.warn("Lightss: AI WLED lightshow response did not include output text");
      this.emitAiMessage("OpenAI response issue", "The model answered without a usable lightshow plan.", {
        provider: LightssAiProvider.OpenAI,
        model,
        aiStatus: "failed",
        lightStatus: "idle"
      });
      return null;
    }

    return this.parseAndSanitizeAiPlan(outputText, { provider: LightssAiProvider.OpenAI, model });
  }

  private async requestOpenRouterLightshowPlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    if (!state.videoDetails) return null;

    const apiKey = this.getOpenRouterApiKey();
    const model = this.getOpenRouterModel();
    if (!apiKey) {
      log.warn("Lightss: OPENROUTER_API_KEY or Lightss OpenRouter API key is required for OpenRouter WLED lightshow");
      this.emitAiMessage("OpenRouter unavailable", "Add an OpenRouter API key in Settings or launch Youtopia with OPENROUTER_API_KEY set.", {
        provider: LightssAiProvider.OpenRouter,
        model,
        aiStatus: "failed",
        lightStatus: "idle"
      });
      return null;
    }

    const context = await this.buildOpenRouterLightshowContext(state);
    log.info("Lightss: requesting OpenRouter WLED lightshow plan for", context.song.title);
    this.emitAiMessage("OpenRouter planning", `Asking ${model} to infer the song mood and choose safe WLED motion.`, {
      provider: LightssAiProvider.OpenRouter,
      model,
      aiStatus: "planning",
      lightStatus: "idle"
    });

    const response = await this.postJson<JsonValue>(
      new URL(OPENROUTER_CHAT_COMPLETIONS_URL),
      {
        model,
        messages: [
          {
            role: "system",
            content: [
              "You are a WLED lightshow designer and safe TV host persona for music playback.",
              "Return JSON only. Do not use Markdown.",
              "Effects and palettes must come from the provided allowlists.",
              "Avoid strobe, blinking, sudden flashing, and abrupt color jumps.",
              "Always soften flash and transition intensity; visually fatiguing flash is not acceptable even when it is not technically a strobe.",
              "Match the TV VU/display colors and WLED colors as one coordinated scene.",
              "Include hostLine and tickerMessage, each concise and specific to the song or room energy."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify(context)
          }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "wled_lightshow_plan",
            strict: true,
            schema: this.getAiPlanSchema()
          }
        },
        temperature: 0.55,
        max_tokens: 1400
      },
      OPENAI_TIMEOUT_MS,
      {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "http://localhost:9863",
        "X-Title": "Youtopia"
      }
    );

    const outputText = this.extractOpenRouterOutputText(response);
    if (!outputText) {
      log.warn("Lightss: OpenRouter WLED lightshow response did not include output text");
      this.emitAiMessage("OpenRouter response issue", "The model answered without a usable lightshow plan.", {
        provider: LightssAiProvider.OpenRouter,
        model,
        aiStatus: "failed",
        lightStatus: "idle"
      });
      return null;
    }

    return this.parseAndSanitizeAiPlan(outputText, { provider: LightssAiProvider.OpenRouter, model });
  }

  private async requestOllamaLightshowPlan(state: PlayerState): Promise<AiLightshowPlan | null> {
    if (!state.videoDetails) return null;

    const model = this.getOllamaModel();
    const context = await this.buildAiLightshowContext(state);
    const url = new URL("/api/generate", this.getOllamaBaseUrl());

    log.info("Lightss: requesting Ollama WLED lightshow plan for", context.song.title);
    this.emitAiMessage("Ollama planning", `Asking ${model} to infer the song mood and choose safe WLED motion.`, {
      provider: LightssAiProvider.Ollama,
      model,
      aiStatus: "planning",
      lightStatus: "idle"
    });

    try {
      const response = await this.postJson<JsonValue>(
        url,
        {
          model,
          stream: false,
          format: this.getAiPlanSchema(),
          prompt: [
            "You are a WLED lightshow designer for music playback.",
            "Return JSON only. Do not use Markdown.",
            "Effects and palettes must come from the provided allowlists.",
            "Avoid strobe, blinking, and sudden flashing.",
            "Always soften flash and transition intensity; visually fatiguing flash is not acceptable even when it is not technically a strobe.",
            "Soften flash-like moments, high-contrast jumps, and intensity spikes because visually fatiguing flash is not acceptable even when it is not technically a strobe.",
            "Do not make abrupt color changes to TV artifacts, backgrounds, album art treatments, VU colors, or LED palettes mid-song. Morph colors gradually unless the track changes.",
            "Infer missing BPM, genre, mood, and color direction from the song metadata, current VU/audio profile, playback progress, album art availability, and WLED snapshot.",
            "Include a displayTheme for the TV host persona: fontFamily must be system, display, or mono; colors must be hex strings. Make the VU colors match the WLED palette and the WLED colors match the VU.",
            "Include a visualScene object for the TV show engine. It must use only the allowed enums, and it must avoid strobe/blink/rapid flashing visuals. density/intensity are 0-100 integers.",
            "Include hostLine as one short late-night VJ sentence with personality. It should feel aware of the song, LED colors, TV output, and room energy.",
            "Include tickerMessage with one concise line of fun song facts, lightshow commentary, or playful host personality for a bottom TV ticker.",
            JSON.stringify(context)
          ].join("\n\n")
        },
        OLLAMA_TIMEOUT_MS
      );
      const outputText = this.extractOllamaOutputText(response);
      if (!outputText) {
        log.warn("Lightss: Ollama WLED lightshow response did not include output text");
        this.emitAiMessage("Ollama response issue", "Ollama answered without a usable lightshow plan.", {
          provider: LightssAiProvider.Ollama,
          model,
          aiStatus: "failed",
          lightStatus: "idle"
        });
        return null;
      }
      return this.parseAndSanitizeAiPlan(outputText, { provider: LightssAiProvider.Ollama, model });
    } catch (error) {
      log.warn(`Lightss: Ollama WLED lightshow request failed for ${url.toString()}:`, error);
      this.emitAiMessage("Ollama unavailable", `Could not reach Ollama at ${this.getOllamaBaseUrl()}.`, {
        provider: LightssAiProvider.Ollama,
        model,
        aiStatus: "failed",
        lightStatus: "idle"
      });
      return null;
    }
  }

  private getAiPlanSchema(): JsonValue {
    return {
      type: "object",
      additionalProperties: false,
      required: ["genre", "mood", "bpm", "rationale", "hostLine", "displayTheme", "visualScene", "tickerMessage", "steps"],
      properties: {
        genre: { type: "string" },
        mood: { type: "string" },
        bpm: { type: "number" },
        rationale: { type: "string" },
        hostLine: { type: "string" },
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
        tickerMessage: { type: "string" },
        steps: {
          type: "array",
          minItems: AI_PLAN_STEP_COUNT,
          maxItems: AI_PLAN_STEP_COUNT,
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
              primaryColor: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "integer" }
              },
              secondaryColor: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                items: { type: "integer" }
              }
            }
          }
        }
      }
    };
  }

  private sanitizeAiLightshowPlan(value: unknown): AiLightshowPlan | null {
    const plan = value as Partial<AiLightshowPlan>;
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) return null;

    const steps = plan.steps.slice(0, AI_PLAN_STEP_COUNT).map(step => this.sanitizeAiStep(step));
    while (steps.length < AI_PLAN_STEP_COUNT) {
      steps.push(steps[steps.length - 1]);
    }

    return {
      genre: this.safeString(plan.genre, "unknown"),
      mood: this.safeString(plan.mood, "adaptive"),
      bpm: this.clampNumber(plan.bpm, 60, 180, 100),
      rationale: this.safeString(plan.rationale, "AI selected a safe WLED scene for the current song."),
      hostLine: this.safeString(plan.hostLine, "The room is tuned to the track, with the TV and LEDs moving in the same groove."),
      displayTheme: this.sanitizeDisplayTheme(plan.displayTheme, steps[0]),
      visualScene: this.sanitizeVisualScene(plan.visualScene as unknown),
      tickerMessage: this.safeString(plan.tickerMessage, "AI is matching the lights, VU, and room energy to the music."),
      steps
    };
  }

  private sanitizeAiStep(step: Partial<AiLightshowStep>): AiLightshowStep {
    const effect = SAFE_EFFECTS.includes(Number(step.effect)) ? Number(step.effect) : 98;
    const palette = SAFE_PALETTES.includes(Number(step.palette)) ? Number(step.palette) : 0;

    return {
      reason: this.safeString(step.reason, "safe AI WLED step"),
      brightness: this.clampNumber(step.brightness, 8, 220, 170),
      transitionMs: this.clampNumber(step.transitionMs, 600, 3000, 900),
      effect,
      speed: this.clampNumber(step.speed, 20, 220, 130),
      intensity: this.clampNumber(step.intensity, 20, 220, 140),
      palette,
      primaryColor: this.sanitizeColor(step.primaryColor, [120, 64, 180, 0]),
      secondaryColor: this.sanitizeColor(step.secondaryColor, [32, 180, 160, 0])
    };
  }

  private async buildAiLightshowContext(state: PlayerState): Promise<AiLightshowContext> {
    const details = state.videoDetails;
    const wledSnapshot = await this.getWledSnapshot();
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
      hostPersonality: {
        voice: "A warm, slightly weird late-night VJ who knows the music, the LEDs, and the room.",
        hostLineRules:
          "Write one vivid sentence under 140 characters. Be specific to this song or color scene. Do not explain controls, mention JSON, or use strobe/blink language.",
        roomBrief: "Private listening room with TV output and WLED strips. Keep the vibe immersive, confident, and safe for long viewing."
      },
      roomLighting: {
        topology: "A single WLED string is mounted behind the TV as ambient bias lighting that washes the wall around the screen.",
        colorStrategy:
          "Treat the LEDs as a wall-wash extension of the TV image. Match or gently complement screen-edge colors, avoid overpowering the display, and morph hue/brightness slowly during a song."
      },
      djGptRealtime: {
        availableWhenOpenAIKeyIsConfigured: Boolean(this.getOpenAIApiKey()),
        model: this.getOpenAIRealtimeModel(),
        voice: this.getOpenAIRealtimeVoice(),
        role: "DJ-GPT can speak short, music-aware host lines and explain the current LED/TV scene without interrupting playback."
      },
      inferredMetadataInstructions:
        "Infer BPM, genre, mood, energy, and color direction from title, artist, album, duration, progressPercent, audioProfile, albumArtAvailable, and current WLED state when explicit metadata is not available.",
      safetyRules: {
        noStrobe: true,
        noBlinkingEffects: true,
        noAbruptMidSongArtifactColorChanges: true,
        useOnlySafeEffectIds: SAFE_EFFECTS,
        useOnlySafePaletteIds: SAFE_PALETTES,
        maxBrightness: 220,
        minTransitionMs: 600
      },
      wled: {
        host: this.getWledHost(),
        snapshot: wledSnapshot
      }
    };
  }

  private async buildOpenRouterLightshowContext(state: PlayerState): Promise<JsonValue> {
    const context = await this.buildAiLightshowContext(state);

    return {
      song: {
        title: context.song.title,
        artist: context.song.artist,
        album: context.song.album,
        durationSeconds: context.song.durationSeconds,
        progressPercent: context.song.progressPercent,
        status: context.song.status
      },
      audioProfile: {
        live: context.audioProfile.live,
        energy: context.audioProfile.energy,
        bass: context.audioProfile.bass,
        mid: context.audioProfile.mid,
        treble: context.audioProfile.treble
      },
      tvOutput: context.tvOutput,
      hostPersonality: context.hostPersonality,
      roomLighting: context.roomLighting,
      inferredMetadataInstructions: context.inferredMetadataInstructions,
      safetyRules: context.safetyRules,
      wled: {
        host: context.wled.host,
        connected: context.wled.snapshot !== null
      },
      privacy: {
        rawAudioSent: false,
        vuBinsSent: false,
        canvasSent: false,
        screenshotsSent: false,
        fullWledSnapshotSent: false
      }
    };
  }

  private parseAndSanitizeAiPlan(outputText: string, provider: AiProviderDetails): AiLightshowPlan | null {
    try {
      const plan = this.sanitizeAiLightshowPlan(JSON.parse(this.extractJsonObject(outputText)));
      if (plan) {
        this.currentDisplayTheme = plan.displayTheme;
        this.currentVisualScene = plan.visualScene;
        this.emitAiMessage("Plan ready", plan.hostLine || plan.rationale, {
          provider: provider.provider,
          model: provider.model,
          plan,
          hostLine: plan.hostLine,
          aiStatus: "connected",
          lightStatus: "idle"
        });
      }
      return plan;
    } catch (error) {
      log.warn("Lightss: AI WLED lightshow plan was not valid JSON:", error);
      this.emitAiMessage("Plan parse failed", "The AI response was not usable JSON, so no WLED command was sent.", provider);
      return null;
    }
  }

  private extractJsonObject(value: string): string {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return this.extractJsonObject(fenced[1]);

    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
    return trimmed;
  }

  private buildWledPayloadFromAiStep(step: AiLightshowStep): WledPayload {
    return {
      on: true,
      bri: step.brightness,
      transition: Math.round(step.transitionMs / 100),
      seg: [
        {
          col: [step.primaryColor, step.secondaryColor],
          fx: step.effect,
          sx: step.speed,
          ix: step.intensity,
          pal: step.palette
        }
      ]
    };
  }

  private async postWledState(payload: WledPayload, reason: string, aiReason: string, appliedStep?: AiLightshowStep): Promise<void> {
    const host = this.getWledHost();
    const url = new URL("/json/state", host);

    try {
      await this.postJson(url, payload, WLED_TIMEOUT_MS);
      log.info(`Lightss: AI WLED lightshow ${reason} applied`, aiReason, JSON.stringify(payload));
      const appliedDisplayTheme = appliedStep ? this.displayThemeFromAiStep(appliedStep) : undefined;
      if (appliedDisplayTheme) {
        this.currentDisplayTheme = appliedDisplayTheme;
      }
      this.emitAiMessage("WLED updated", aiReason, {
        aiStatus: "connected",
        wledStatus: "connected",
        lightStatus: "applied",
        displayTheme: appliedDisplayTheme,
        hostLine: this.aiPlan?.hostLine
      });
    } catch (error) {
      log.warn(`Lightss: AI WLED lightshow ${reason} failed for ${url.toString()}:`, error);
      this.emitAiMessage("WLED update failed", `Could not send the planned scene to ${host}.`, { wledStatus: "failed", lightStatus: "failed" });
    }
  }

  private async getWledSnapshot(): Promise<JsonValue | null> {
    const snapshot = {
      state: await this.getWledSnapshotEndpoint("/json/state"),
      info: await this.getWledSnapshotEndpoint("/json/info"),
      effects: await this.getWledSnapshotEndpoint("/json/effects"),
      palettes: await this.getWledSnapshotEndpoint("/json/palettes"),
      config: await this.getWledSnapshotEndpoint("/json/cfg"),
      fxdata: await this.getWledSnapshotEndpoint("/json/fxdata"),
      networks: await this.getWledSnapshotEndpoint("/json/net")
    };

    if (this.isSuccessfulSnapshotValue(snapshot.state) || this.isSuccessfulSnapshotValue(snapshot.info)) {
      this.emitAiMessage("WLED connected", `Controller is reachable at ${this.getWledHost()}.`, { wledStatus: "connected" });
      return snapshot as JsonValue;
    }

    this.emitAiMessage("WLED unavailable", `Could not read controller state from ${this.getWledHost()}.`, { wledStatus: "failed", lightStatus: "failed" });
    return snapshot as JsonValue;
  }

  private async getWledSnapshotEndpoint(pathname: string): Promise<JsonValue | null> {
    const url = new URL(pathname, this.getWledHost());

    try {
      return await this.getJson(url, WLED_TIMEOUT_MS);
    } catch (error) {
      log.warn(`Lightss: optional WLED snapshot endpoint failed for ${url.toString()}:`, error);
      return {
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private isSuccessfulSnapshotValue(value: JsonValue | null): boolean {
    return Boolean(value && (typeof value !== "object" || Array.isArray(value) || !("error" in value)));
  }

  private postJson<T>(url: URL, payload: JsonValue, timeoutMs: number, headers: Record<string, string> = {}): Promise<T> {
    const body = JSON.stringify(payload);
    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const request = transport.request(
        url,
        {
          method: "POST",
          timeout: timeoutMs,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            ...headers
          }
        },
        response => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", chunk => {
            responseBody += chunk;
          });
          response.on("end", () => {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`HTTP ${response.statusCode ?? "unknown"} ${responseBody}`));
              return;
            }

            if (!responseBody.trim()) {
              resolve(null as T);
              return;
            }

            try {
              resolve(JSON.parse(responseBody) as T);
            } catch {
              resolve(responseBody as T);
            }
          });
        }
      );

      request.on("timeout", () => {
        request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
      });
      request.on("error", reject);
      request.end(body);
    });
  }

  private getJson<T>(url: URL, timeoutMs: number): Promise<T> {
    const transport = url.protocol === "https:" ? https : http;

    return new Promise((resolve, reject) => {
      const request = transport.request(
        url,
        {
          method: "GET",
          timeout: timeoutMs
        },
        response => {
          let responseBody = "";
          response.setEncoding("utf8");
          response.on("data", chunk => {
            responseBody += chunk;
          });
          response.on("end", () => {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              reject(new Error(`HTTP ${response.statusCode ?? "unknown"} ${responseBody}`));
              return;
            }

            try {
              resolve(JSON.parse(responseBody) as T);
            } catch (error) {
              reject(error);
            }
          });
        }
      );

      request.on("timeout", () => {
        request.destroy(new Error(`Timed out after ${timeoutMs}ms`));
      });
      request.on("error", reject);
      request.end();
    });
  }

  private extractOpenAIOutputText(response: JsonValue): string | null {
    if (!response || typeof response !== "object" || Array.isArray(response)) return null;
    if (typeof response.output_text === "string") return response.output_text;

    const output = response.output;
    if (!Array.isArray(output)) return null;

    for (const item of output) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const content = item.content;
      if (!Array.isArray(content)) continue;

      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== "object" || Array.isArray(contentItem)) continue;
        if (typeof contentItem.text === "string") return contentItem.text;
      }
    }

    return null;
  }

  private extractOpenRouterOutputText(response: JsonValue): string | null {
    if (!response || typeof response !== "object" || Array.isArray(response)) return null;
    const choices = response.choices;
    if (!Array.isArray(choices)) return null;

    for (const choice of choices) {
      if (!choice || typeof choice !== "object" || Array.isArray(choice)) continue;
      const message = choice.message;
      if (!message || typeof message !== "object" || Array.isArray(message)) continue;
      const content = message.content;
      if (typeof content === "string") return content;
      if (!Array.isArray(content)) continue;

      for (const contentItem of content) {
        if (!contentItem || typeof contentItem !== "object" || Array.isArray(contentItem)) continue;
        if (typeof contentItem.text === "string") return contentItem.text;
      }
    }

    return null;
  }

  private extractOllamaOutputText(response: JsonValue): string | null {
    if (!response || typeof response !== "object" || Array.isArray(response)) return null;
    return typeof response.response === "string" ? response.response : null;
  }

  private emitAiMessage(
    title: string,
    message: string,
    options: Partial<AiProviderDetails> &
      Pick<Partial<RendererLightssAiMessage>, "aiStatus" | "wledStatus" | "lightStatus" | "displayTheme" | "tickerMessage" | "hostLine"> & {
        plan?: AiLightshowPlan;
      } = {}
  ): void {
    const providerDetails = this.getAiProvider();
    const plan = options.plan;
    const displayTheme = options.displayTheme ?? plan?.displayTheme ?? this.currentDisplayTheme ?? undefined;
    const visualScene = plan?.visualScene ?? this.currentVisualScene ?? this.safeDefaultVisualScene();
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
      timestamp: Date.now()
    };

    this.aiMessageCallback?.(aiMessage);
  }

  private getAiProvider(): AiProviderDetails {
    const provider = (this.store.get("integrations.lightssAiProvider") || LightssAiProvider.Ollama) as LightssAiProvider;
    if (provider === LightssAiProvider.OpenAI) {
      return {
        provider,
        model: this.getOpenAIModel()
      };
    }

    if (provider === LightssAiProvider.OpenRouter) {
      return {
        provider,
        model: this.getOpenRouterModel()
      };
    }

    return {
      provider: LightssAiProvider.Ollama,
      model: this.getOllamaModel()
    };
  }

  private getOpenAIModel(): string {
    return (this.store.get("integrations.lightssOpenAIModel") || DEFAULT_OPENAI_MODEL).trim() || DEFAULT_OPENAI_MODEL;
  }

  private getOpenAIRealtimeModel(): string {
    return (this.store.get("integrations.lightssOpenAIRealtimeModel") || DEFAULT_OPENAI_REALTIME_MODEL).trim() || DEFAULT_OPENAI_REALTIME_MODEL;
  }

  private getOpenAIRealtimeVoice(): string {
    return (this.store.get("integrations.lightssOpenAIRealtimeVoice") || DEFAULT_OPENAI_REALTIME_VOICE).trim() || DEFAULT_OPENAI_REALTIME_VOICE;
  }

  private getOpenRouterModel(): string {
    return (this.store.get("integrations.lightssOpenRouterModel") || DEFAULT_OPENROUTER_MODEL).trim() || DEFAULT_OPENROUTER_MODEL;
  }

  private getOllamaModel(): string {
    return (this.store.get("integrations.lightssOllamaModel") || DEFAULT_OLLAMA_MODEL).trim() || DEFAULT_OLLAMA_MODEL;
  }

  private getOllamaBaseUrl(): string {
    const baseUrl = (this.store.get("integrations.lightssOllamaBaseUrl") || DEFAULT_OLLAMA_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
    if (baseUrl.startsWith("http://") || baseUrl.startsWith("https://")) {
      return baseUrl;
    }
    return `http://${baseUrl}`;
  }

  private getOpenAIApiKey(): string | null {
    const storeKey = (this.store.get("integrations.lightssOpenAIApiKey") as string | null)?.trim();
    return storeKey || process.env.OPENAI_API_KEY?.trim() || null;
  }

  private getOpenRouterApiKey(): string | null {
    const storeKey = (this.store.get("integrations.lightssOpenRouterApiKey") as string | null)?.trim();
    return storeKey || process.env.OPENROUTER_API_KEY?.trim() || null;
  }

  private getWledHost(): string {
    const host = (this.store.get("integrations.lightssHost") as string | null) || DEFAULT_WLED_HOST;
    const normalized = host.trim().replace(/\/+$/, "");
    if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
      return normalized;
    }
    return `http://${normalized}`;
  }

  private videoStateName(state: VideoState): string {
    switch (state) {
      case VideoState.Playing:
        return "Playing";
      case VideoState.Paused:
        return "Paused";
      case VideoState.Buffering:
        return "Buffering";
      default:
        return "Unknown";
    }
  }

  private getBestThumbnailUrl(thumbnails: { height: number; url: string; width: number }[] | undefined): string {
    if (!thumbnails?.length) return "";
    return thumbnails.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0]?.url ?? "";
  }

  private safeString(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.max(min, Math.min(max, Math.round(numberValue)));
  }

  private sanitizeColor(value: unknown, fallback: number[]): number[] {
    if (!Array.isArray(value)) return fallback;
    const color = value.slice(0, 4).map(channel => this.clampNumber(channel, 0, 255, 0));
    while (color.length < 4) color.push(0);
    return color;
  }

  private sanitizeDisplayTheme(value: unknown, firstStep: AiLightshowStep): AiLightshowDisplayTheme {
    const theme = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AiLightshowDisplayTheme>) : {};
    const primary = this.rgbToHex(firstStep.primaryColor);
    const secondary = this.rgbToHex(firstStep.secondaryColor);
    const fontFamily = theme.fontFamily === "display" || theme.fontFamily === "mono" ? theme.fontFamily : "system";

    return {
      fontFamily,
      backgroundColor: this.sanitizeHexColor(theme.backgroundColor, "#050505"),
      accentColor: this.sanitizeHexColor(theme.accentColor, primary),
      vuLowColor: this.sanitizeHexColor(theme.vuLowColor, secondary),
      vuMidColor: this.sanitizeHexColor(theme.vuMidColor, primary),
      vuHighColor: this.sanitizeHexColor(theme.vuHighColor, primary)
    };
  }

  private displayThemeFromAiStep(step: AiLightshowStep): AiLightshowDisplayTheme {
    const primary = this.rgbToHex(step.primaryColor);
    const secondary = this.rgbToHex(step.secondaryColor);

    return {
      fontFamily: this.currentDisplayTheme?.fontFamily ?? "system",
      backgroundColor: "#000000",
      accentColor: primary,
      vuLowColor: secondary,
      vuMidColor: this.blendHexColors(primary, secondary),
      vuHighColor: primary
    };
  }

  private blendHexColors(a: string, b: string): string {
    const aChannels = this.hexToRgb(a);
    const bChannels = this.hexToRgb(b);
    const blended = aChannels.map((channel, index) => Math.round((channel + bChannels[index]) / 2));
    return this.rgbToHex(blended);
  }

  private hexToRgb(hex: string): number[] {
    const normalized = this.sanitizeHexColor(hex, "#000000").slice(1);
    return [0, 2, 4].map(index => Number.parseInt(normalized.slice(index, index + 2), 16));
  }

  private sanitizeHexColor(value: unknown, fallback: string): string {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
    return fallback;
  }

  private rgbToHex(color: number[]): string {
    const channels = color.slice(0, 3).map(channel => this.clampNumber(channel, 0, 255, 0).toString(16).padStart(2, "0"));
    return `#${channels.join("")}`;
  }

  private safeDefaultVisualScene(): AiLightshowVisualScene {
    return {
      backgroundStyle: "solid",
      visualizerStyle: "vuBars",
      vuStyle: "bars",
      motion: "slow",
      density: 55,
      intensity: 60,
      logoMode: "small",
      captionMode: "minimal",
      albumArtMode: "corner"
    };
  }

  private sanitizeVisualScene(value: unknown): AiLightshowVisualScene {
    if (!value || typeof value !== "object" || Array.isArray(value)) return this.safeDefaultVisualScene();
    const scene = value as Partial<AiLightshowVisualScene>;

    const backgroundStyle = scene.backgroundStyle === "gradient" ? "gradient" : "solid";
    const visualizerStyle =
      scene.visualizerStyle === "vuDots" || scene.visualizerStyle === "spectrumLine" || scene.visualizerStyle === "none" ? scene.visualizerStyle : "vuBars";
    const vuStyle =
      scene.vuStyle === "classicLed" || scene.vuStyle === "dotMatrix" || scene.vuStyle === "spectrumLine" || scene.vuStyle === "albumGlow"
        ? scene.vuStyle
        : "bars";
    const motion = scene.motion === "static" || scene.motion === "medium" ? scene.motion : "slow";
    const density = this.clampNumber(scene.density, 0, 100, 55);
    const intensity = this.clampNumber(scene.intensity, 0, 100, 60);
    const logoMode = scene.logoMode === "off" || scene.logoMode === "prominent" ? scene.logoMode : "small";
    const captionMode = scene.captionMode === "off" || scene.captionMode === "full" ? scene.captionMode : "minimal";
    const albumArtMode = scene.albumArtMode === "off" || scene.albumArtMode === "hero" || scene.albumArtMode === "ambient" ? scene.albumArtMode : "corner";

    // Guardrails: keep the output bounded and "TV safe" (no strobe/blink fields exist here).
    return { backgroundStyle, visualizerStyle, vuStyle, motion, density, intensity, logoMode, captionMode, albumArtMode };
  }
}
