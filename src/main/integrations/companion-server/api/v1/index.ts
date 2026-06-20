import { BrowserView, BrowserWindow, ipcMain } from "electron";
import Conf from "conf";
import { FastifyPluginCallback, FastifyPluginOptions } from "fastify";
import { StoreSchema } from "~shared/store/schema";
import playerStateStore, { PlayerState, RepeatMode } from "../../../../player-state-store";
import { createAuthToken, getIsTemporaryAuthCodeValidAndRemove, getTemporaryAuthCode, isAuthValid, isAuthValidMiddleware } from "../../api-shared/auth";
import { fastifyRateLimit } from "@fastify/rate-limit";
import crypto from "crypto";
import {
  APIV1AudioDirectorPlanRequestBody,
  APIV1AudioDirectorPlanRequestBodyType,
  APIV1CommandRequestBody,
  APIV1CommandRequestBodyType,
  APIV1RequestCodeBody,
  APIV1RequestCodeBodyType,
  APIV1RequestTokenBody,
  APIV1RequestTokenBodyType
} from "../../api-shared/schemas";
import {
  AuthorizationDeniedError,
  AuthorizationDisabledError,
  AuthorizationInvalidError,
  AuthorizationTimeOutError,
  AuthorizationTooManyError,
  InvalidPositionError,
  InvalidQueueIndexError,
  InvalidRepeatModeError,
  InvalidChangeVideoRequestError,
  InvalidVolumeError,
  UnauthenticatedError,
  YouTubeMusicTimeOutError,
  YouTubeMusicUnavailableError
} from "../../api-shared/errors";
import path from "node:path";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type AudioDirectorAction = {
  type: "fadeVolume" | "setVolume" | "play" | "pause" | "next" | "previous" | "shuffle" | "playQueueIndex" | "searchSongs" | "buildPlaylist";
  reason: string;
  volume?: number;
  durationMs?: number;
  query?: string;
  count?: number;
  queueIndex?: number;
  playlistName?: string;
};

type AudioDirectorPlan = {
  title: string;
  summary: string;
  actions: AudioDirectorAction[];
  backgroundTasks: string[];
};

const DEFAULT_AUDIO_DIRECTOR_MODEL = "gpt-5.5";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string;

const transformPlayerState = (state: PlayerState) => {
  return {
    player: {
      trackState: state.trackState,
      videoProgress: state.videoProgress,
      volume: state.volume,
      muted: state.muted,
      adPlaying: state.adPlaying,
      queue: state.queue
        ? {
            autoplay: state.queue.autoplay,
            items: state.queue.items,
            automixItems: state.queue.automixItems,
            isGenerating: state.queue.isGenerating,
            isInfinite: state.queue.isInfinite,
            repeatMode: state.queue.repeatMode,
            selectedItemIndex: state.queue.selectedItemIndex
          }
        : null
    },
    video: state.videoDetails
      ? {
          author: state.videoDetails.author,
          channelId: state.videoDetails.channelId,
          title: state.videoDetails.title,
          album: state.videoDetails.album,
          albumId: state.videoDetails.albumId,
          likeStatus: state.videoDetails.likeStatus,
          thumbnails: state.videoDetails.thumbnails,
          durationSeconds: state.videoDetails.durationSeconds,
          id: state.videoDetails.id,
          isLive: state.videoDetails.isLive,
          videoType: state.videoDetails.videoType,
          // API Users: In YTM the initial player response for a song may not contain filled out metadata is fetched via another requests. This indicates that is complete.
          //            For context you can refer to YTM playing a song but the player bar not displaying the information for the song yet. This is that behavior.
          metadataFilled: state.hasFullMetadata
        }
      : null,
    // API Users:
    // WARNING! WARNING! WARNING! WARNING!
    // playlistId may not be what you expect it to be.
    // - If the song playing comes from a randomly generated radio queue then this will be the id of that random queue (YTM does not persist these, pretend these IDs don't exist on the YTM backend)
    // - If you add an album/playlist to queue once those songs start playing then playlistId will be the id of that album/playlist
    // - Play Next for individual songs have a null playlistId when reached in a queue. Does not apply for Play Next to an entire album/playlist.
    // In summary, this property doesn't reliably tell you this video belongs to the specified playlistId. Do not treat it as such. Use it as a state if something may be playing from a known playlistId
    playlistId: state.playlistId
  };
};

interface CompanionServerAPIv1Options extends FastifyPluginOptions {
  getStore: () => Conf<StoreSchema>;
  getYtmView: () => BrowserView;
}

type Playlist = {
  id: string;
  title: string;
};

const authorizationWindows: BrowserWindow[] = [];

function getOpenAIApiKey(store: Conf<StoreSchema>): string | null {
  const storeKey = (store.get("integrations.lightssOpenAIApiKey") as string | null)?.trim();
  return storeKey || process.env.OPENAI_API_KEY?.trim() || null;
}

function extractJsonObject(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return extractJsonObject(fenced[1]);
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function extractOpenAIOutputText(response: JsonValue): string | null {
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

async function postJson<T>(url: URL, payload: JsonValue, timeoutMs: number, headers: Record<string, string> = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const responseBody = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${responseBody}`);
    }
    return responseBody ? (JSON.parse(responseBody) as T) : (null as T);
  } finally {
    clearTimeout(timer);
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numberValue)));
}

function sanitizeAudioDirectorPlan(value: unknown, maxActions: number): AudioDirectorPlan {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<AudioDirectorPlan>) : {};
  const rawActions = Array.isArray(source.actions) ? source.actions : [];
  const actions = rawActions.slice(0, maxActions).flatMap(action => {
    if (!action || typeof action !== "object" || Array.isArray(action)) return [];
    const src = action as Partial<AudioDirectorAction>;
    const allowedTypes = ["fadeVolume", "setVolume", "play", "pause", "next", "previous", "shuffle", "playQueueIndex", "searchSongs", "buildPlaylist"];
    if (!allowedTypes.includes(String(src.type))) return [];
    return [
      {
        type: src.type as AudioDirectorAction["type"],
        reason: typeof src.reason === "string" && src.reason.trim() ? src.reason.trim() : "Audio director action",
        volume: clampNumber(src.volume, 0, 100, 50),
        durationMs: clampNumber(src.durationMs, 500, 12000, 2500),
        query: typeof src.query === "string" ? src.query.slice(0, 160) : "",
        count: clampNumber(src.count, 1, 25, 8),
        queueIndex: clampNumber(src.queueIndex, 0, 200, 0),
        playlistName: typeof src.playlistName === "string" ? src.playlistName.slice(0, 80) : ""
      }
    ];
  });

  return {
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Audio director plan",
    summary: typeof source.summary === "string" && source.summary.trim() ? source.summary.trim() : "Prepared a bounded playback plan.",
    actions,
    backgroundTasks: Array.isArray(source.backgroundTasks) ? source.backgroundTasks.filter(task => typeof task === "string").slice(0, 6) : []
  };
}

function getAudioDirectorPlanSchema(maxActions: number): JsonValue {
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "summary", "actions", "backgroundTasks"],
    properties: {
      title: { type: "string" },
      summary: { type: "string" },
      actions: {
        type: "array",
        minItems: 0,
        maxItems: maxActions,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "reason", "volume", "durationMs", "query", "count", "queueIndex", "playlistName"],
          properties: {
            type: {
              type: "string",
              enum: ["fadeVolume", "setVolume", "play", "pause", "next", "previous", "shuffle", "playQueueIndex", "searchSongs", "buildPlaylist"]
            },
            reason: { type: "string" },
            volume: { type: "integer", minimum: 0, maximum: 100 },
            durationMs: { type: "integer", minimum: 500, maximum: 12000 },
            query: { type: "string" },
            count: { type: "integer", minimum: 1, maximum: 25 },
            queueIndex: { type: "integer", minimum: 0 },
            playlistName: { type: "string" }
          }
        }
      },
      backgroundTasks: {
        type: "array",
        maxItems: 6,
        items: { type: "string" }
      }
    }
  };
}

const CompanionServerAPIv1: FastifyPluginCallback<CompanionServerAPIv1Options> = async (fastify, options) => {
  const sendCommand = (commandRequest: APIV1CommandRequestBodyType) => {
    const ytmView = options.getYtmView();
    if (ytmView) {
      switch (commandRequest.command) {
        case "playPause": {
          ytmView.webContents.send("remoteControl:execute", "playPause");
          break;
        }

        case "play": {
          ytmView.webContents.send("remoteControl:execute", "play");
          break;
        }

        case "pause": {
          ytmView.webContents.send("remoteControl:execute", "pause");
          break;
        }

        case "volumeUp": {
          ytmView.webContents.send("remoteControl:execute", "volumeUp");
          break;
        }

        case "volumeDown": {
          ytmView.webContents.send("remoteControl:execute", "volumeDown");
          break;
        }

        case "setVolume": {
          const volume = commandRequest.data;
          // Check if Volume is a number and between 0 and 100
          if (isNaN(volume) || volume < 0 || volume > 100) {
            throw new InvalidVolumeError(volume);
          }

          ytmView.webContents.send("remoteControl:execute", "setVolume", volume);
          break;
        }

        case "mute": {
          ytmView.webContents.send("remoteControl:execute", "mute");
          break;
        }

        case "unmute": {
          ytmView.webContents.send("remoteControl:execute", "unmute");
          break;
        }

        case "seekTo": {
          const position = commandRequest.data;
          if (isNaN(position) || position < 0 || position > playerStateStore.getState().videoDetails.durationSeconds) {
            throw new InvalidPositionError(position);
          }
          ytmView.webContents.send("remoteControl:execute", "seekTo", position);
          break;
        }

        case "changeVideo": {
          const videoId = commandRequest.data.videoId;
          const playlistId = commandRequest.data.playlistId;
          if (videoId == null && playlistId == null) {
            throw new InvalidChangeVideoRequestError();
          }
          ytmView.webContents.send("remoteControl:execute", "navigate", {
            watchEndpoint: {
              videoId: videoId,
              playlistId: playlistId
            }
          });
          break;
        }

        case "next": {
          ytmView.webContents.send("remoteControl:execute", "next");
          break;
        }

        case "previous": {
          ytmView.webContents.send("remoteControl:execute", "previous");
          break;
        }

        case "repeatMode": {
          const repeatMode = commandRequest.data;
          switch (repeatMode) {
            case RepeatMode.None: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "NONE");
              break;
            }
            case RepeatMode.All: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ALL");
              break;
            }
            case RepeatMode.One: {
              ytmView.webContents.send("remoteControl:execute", "repeatMode", "ONE");
              break;
            }
            default: {
              throw new InvalidRepeatModeError(repeatMode);
            }
          }
          break;
        }

        case "shuffle": {
          ytmView.webContents.send("remoteControl:execute", "shuffle");
          break;
        }

        case "playQueueIndex": {
          const index = commandRequest.data;
          const state = playerStateStore.getState();

          if (isNaN(index) || index > state.queue.items.length + state.queue.automixItems.length - 1) {
            throw new InvalidQueueIndexError(index);
          }

          ytmView.webContents.send("remoteControl:execute", "playQueueIndex", index);
          break;
        }

        case "toggleLike": {
          ytmView.webContents.send("remoteControl:execute", "toggleLike");
          break;
        }

        case "toggleDislike": {
          ytmView.webContents.send("remoteControl:execute", "toggleDislike");
          break;
        }
      }
    }
  };

  const executeAudioDirectorAction = async (action: AudioDirectorAction): Promise<string> => {
    if (action.type === "fadeVolume") {
      const startVolume = playerStateStore.getState().volume;
      const targetVolume = clampNumber(action.volume, 0, 100, startVolume);
      const durationMs = clampNumber(action.durationMs, 500, 12000, 2500);
      const steps = Math.max(2, Math.min(24, Math.round(durationMs / 350)));
      for (let step = 1; step <= steps; step += 1) {
        const volume = Math.round(startVolume + ((targetVolume - startVolume) * step) / steps);
        sendCommand({ command: "setVolume", data: volume });
        await new Promise(resolve => setTimeout(resolve, Math.round(durationMs / steps)));
      }
      return `Faded volume to ${targetVolume}`;
    }

    if (action.type === "setVolume") {
      const volume = clampNumber(action.volume, 0, 100, playerStateStore.getState().volume);
      sendCommand({ command: "setVolume", data: volume });
      return `Set volume to ${volume}`;
    }

    if (action.type === "play" || action.type === "pause" || action.type === "next" || action.type === "previous" || action.type === "shuffle") {
      sendCommand({ command: action.type });
      return `Sent ${action.type}`;
    }

    if (action.type === "playQueueIndex") {
      const queueIndex = clampNumber(action.queueIndex, 0, 200, 0);
      sendCommand({ command: "playQueueIndex", data: queueIndex });
      return `Played queue index ${queueIndex}`;
    }

    return `${action.type} planned for background execution`;
  };

  const buildAudioDirectorContext = () => {
    const state = playerStateStore.getState();
    return {
      nowPlaying: transformPlayerState(state),
      capabilities: {
        immediate: ["fadeVolume", "setVolume", "play", "pause", "next", "previous", "shuffle", "playQueueIndex"],
        backgroundPlanning: ["searchSongs", "buildPlaylist"],
        note: "Search and playlist building should be planned as background tasks until a verified YouTube Music search/add pipeline is available."
      },
      personality:
        "The user was a radio DJ for years. Act like a sharp assistant program director: musical, tasteful, concise, and good at segues, fades, sets, energy arcs, and keeping the room moving.",
      safety:
        "Do not make abrupt volume jumps unless asked. Prefer fades between 1500ms and 6000ms. Do not interrupt playback for background discovery unless execute is true and the action is immediate."
    };
  };

  await fastify.register(fastifyRateLimit, {
    global: true,
    max: 100,
    timeWindow: 1000 * 60
  });

  fastify.post<{ Body: APIV1RequestCodeBodyType }>(
    "/auth/requestcode",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60
        }
      },
      schema: {
        body: APIV1RequestCodeBody
      }
    },
    async (request, response) => {
      const companionServerAuthWindowEnabled = options.getMemoryStore().get("companionServerAuthWindowEnabled") ?? false;

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      const code = await getTemporaryAuthCode(request.body.appId, request.body.appVersion, request.body.appName);
      if (code) {
        response.send({
          code
        });
      } else {
        throw new AuthorizationTimeOutError();
      }
    }
  );

  fastify.post<{ Body: APIV1RequestTokenBodyType }>(
    "/auth/request",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: 1000 * 60
        }
      },
      schema: {
        body: APIV1RequestTokenBody
      }
    },
    async (request, response) => {
      const companionServerAuthWindowEnabled = options.getMemoryStore().get("companionServerAuthWindowEnabled") ?? false;

      // There's too many authorization windows open and we have to reject this request for now (this is unlikely to occur but this prevents malicious use of spamming auth windows)
      // API Users: Show a friendly feedback that too many applications are trying to authorize at the same time
      if (authorizationWindows.length >= 5) {
        throw new AuthorizationTooManyError();
      }

      // API Users: The user has companion server authorization disabled, show a feedback error accordingly
      if (!companionServerAuthWindowEnabled) {
        throw new AuthorizationDisabledError();
      }

      // API Users: Make sure you /requestcode above
      const authData = getIsTemporaryAuthCodeValidAndRemove(request.body.appId, request.body.code);
      if (!authData) {
        throw new AuthorizationInvalidError();
      }

      const requestId = crypto.randomUUID();

      let authorizationWindowClosed = false;

      // Create the authorization browser window.
      const authorizationWindow = new BrowserWindow({
        width: 640,
        height: 480,
        minimizable: false,
        maximizable: false,
        resizable: false,
        frame: false,
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#000000",
          symbolColor: "#BBBBBB",
          height: 36
        },
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          preload: path.join(__dirname, `../renderer/windows/authorize-companion/preload.js`),
          additionalArguments: [requestId, authData.appName, request.body.code]
        }
      });
      if (ALL_WINDOWS_VITE_DEV_SERVER_URL) authorizationWindow.loadURL(ALL_WINDOWS_VITE_DEV_SERVER_URL + "/windows/authorize-companion/index.html");
      else authorizationWindow.loadFile(path.join(__dirname, `../renderer/windows/authorize-companion/index.html`));
      authorizationWindow.show();
      authorizationWindow.flashFrame(true);

      authorizationWindow.webContents.setWindowOpenHandler(() => {
        return {
          action: "deny"
        };
      });

      authorizationWindow.webContents.on("will-navigate", event => {
        if (process.env.NODE_ENV === "development") if (event.url.startsWith("http://localhost")) return;

        event.preventDefault();
      });

      authorizationWindows.push(authorizationWindow);

      try {
        // Open the DevTools.
        if (process.env.NODE_ENV === "development") {
          authorizationWindow.webContents.openDevTools({
            mode: "detach"
          });
        }

        let promiseResolve: (value: boolean | PromiseLike<boolean>) => void;
        let promiseInterval: string | number | NodeJS.Timeout;

        const resultListener = (event: Electron.IpcMainEvent, authorized: boolean) => {
          if (event.sender !== authorizationWindow.webContents) return;

          clearInterval(promiseInterval);
          promiseResolve(authorized);
        };

        const closeListener = (event: Electron.IpcMainEvent) => {
          if (event && event.sender !== authorizationWindow.webContents) return;

          clearInterval(promiseInterval);
          promiseResolve(false);
        };

        const startTime = Date.now();
        const authorized = await new Promise<boolean>(resolve => {
          promiseResolve = resolve;
          promiseInterval = setInterval(() => {
            if (request.socket.destroyed) {
              clearInterval(promiseInterval);
              resolve(false);
            }

            if (Date.now() - startTime > 30 * 1000) {
              clearInterval(promiseInterval);
              resolve(false);
            }
          }, 250);

          ipcMain.once(`companionAuthorization:result:${requestId}`, resultListener);
          ipcMain.once(`companionWindow:close:${requestId}`, closeListener);
          authorizationWindow.once("closed", () => {
            authorizationWindowClosed = true;
            closeListener(null);
          });
        });

        if (!authorizationWindowClosed) {
          authorizationWindow.removeAllListeners();
          authorizationWindow.close();
        }
        ipcMain.removeListener(`companionAuthorization:result:${requestId}`, resultListener);
        ipcMain.removeListener(`companionWindow:close:${requestId}`, closeListener);

        if (authorized) {
          const token = createAuthToken(options.getStore(), authData.appId, authData.appVersion, authData.appName);

          response.send({
            token
          });
          options.getMemoryStore().set("companionServerAuthWindowEnabled", false);
        } else {
          throw new AuthorizationDeniedError();
        }
      } finally {
        const index = authorizationWindows.indexOf(authorizationWindow);
        if (index > -1) {
          authorizationWindows.splice(index, 1);
        }
      }
    }
  );

  fastify.get(
    "/playlists",
    {
      config: {
        // This endpoint sends a real API request to YTM which allows to fetch playlists.
        // API users: Please cache playlists, they are unlikely to change often. A websocket event will be emitted if a playlist is created or deleted
        rateLimit: {
          hook: "preHandler",
          max: 1,
          timeWindow: 1000 * 30,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    async (request, response) => {
      const ytmView = options.getYtmView();
      if (ytmView) {
        const requestId = crypto.randomUUID();

        const playlistsResponseListener = (event: Electron.IpcMainEvent, playlists: Playlist[]) => {
          if (event.sender !== ytmView.webContents) return;
          response.send(playlists);
        };
        ipcMain.once(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);

        ytmView.webContents.send(`ytmView:getPlaylists`, requestId);

        await new Promise((_resolve, reject) =>
          setTimeout(() => {
            ipcMain.removeListener(`ytmView:getPlaylists:response:${requestId}`, playlistsResponseListener);
            reject(new YouTubeMusicTimeOutError());
          }, 1000 * 30)
        );
      } else {
        throw new YouTubeMusicUnavailableError();
      }
    }
  );

  fastify.get(
    "/state",
    {
      config: {
        // API users: Please utilize the realtime websocket to get the state. Request this endpoint as necessary, such as initial state fetching.
        rateLimit: {
          hook: "preHandler",
          max: 1,
          timeWindow: 1000 * 5,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      response.send(transformPlayerState(playerStateStore.getState()));
    }
  );

  fastify.post<{ Body: APIV1CommandRequestBodyType }>(
    "/command",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 2,
          timeWindow: 1000 * 1,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      schema: {
        body: APIV1CommandRequestBody
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    (request, response) => {
      sendCommand(request.body);
      response.code(204).send();
    }
  );

  fastify.post<{ Body: APIV1AudioDirectorPlanRequestBodyType }>(
    "/audio-director/plan",
    {
      config: {
        rateLimit: {
          hook: "preHandler",
          max: 6,
          timeWindow: 1000 * 60,
          keyGenerator: request => {
            return request.authId || request.ip;
          }
        }
      },
      schema: {
        body: APIV1AudioDirectorPlanRequestBody
      },
      preHandler: (request, response, next) => {
        return isAuthValidMiddleware(options.getStore(), request, response, next);
      }
    },
    async (request, response) => {
      const apiKey = getOpenAIApiKey(options.getStore());
      if (!apiKey) {
        response.code(503).send({
          error: "OpenAI API key is required for the audio director"
        });
        return;
      }

      const model =
        (options.getStore().get("integrations.lightssOpenAIAudioDirectorModel") || DEFAULT_AUDIO_DIRECTOR_MODEL).trim() || DEFAULT_AUDIO_DIRECTOR_MODEL;
      const maxActions = clampNumber(request.body.maxActions, 1, 8, 5);
      const context = buildAudioDirectorContext();
      const openAiResponse = await postJson<JsonValue>(
        new URL(OPENAI_RESPONSES_URL),
        {
          model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: "You are DJ-GPT's audio director for Youtopia. Build practical radio-DJ style playback plans: tasteful fades, energy-aware sequencing, queue choices, song-search ideas, and playlist-building tasks. Return JSON only. Use immediate actions only from the provided immediate capability list. Put searchSongs and buildPlaylist actions in the plan as background tasks; do not claim they were executed."
                }
              ]
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    request: request.body.prompt,
                    execute: Boolean(request.body.execute),
                    context
                  })
                }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "audio_director_plan",
              strict: true,
              schema: getAudioDirectorPlanSchema(maxActions)
            }
          },
          max_output_tokens: 1200
        },
        20000,
        {
          Authorization: `Bearer ${apiKey}`
        }
      );

      const outputText = extractOpenAIOutputText(openAiResponse);
      const plan = sanitizeAudioDirectorPlan(outputText ? JSON.parse(extractJsonObject(outputText)) : null, maxActions);
      const executed: string[] = [];
      if (request.body.execute) {
        for (const action of plan.actions) {
          if (action.type === "searchSongs" || action.type === "buildPlaylist") continue;
          executed.push(await executeAudioDirectorAction(action));
        }
      }

      response.send({
        model,
        plan,
        executed
      });
    }
  );

  fastify.ready().then(() => {
    fastify.io.of("/api/v1/realtime").use((socket, next) => {
      const token = socket.handshake.auth.token;
      const [validSession, tokenId] = isAuthValid(options.getStore(), token);
      if (validSession) {
        socket.data.tokenId = tokenId;
        next();
      } else {
        next(new UnauthenticatedError());
      }
    });
    // Will look into enabling sending commands/requests over the websocket at a later point in time
    /*fastify.io.of("/api/v1/realtime").on("connection", socket => {
      socket.on("command", (command: RemoteCommand) => {
        sendCommand(command);
      });
    });*/

    const stateStoreListener = (state: PlayerState) => {
      fastify.io.of("/api/v1/realtime").emit("state-update", transformPlayerState(state));
    };
    playerStateStore.addEventListener(stateStoreListener);

    const createPlaylistObservedListener = (event: Electron.IpcMainEvent, playlist: Playlist) => {
      const ytmView = options.getYtmView();
      if (event.sender !== ytmView.webContents) return;

      fastify.io.of("/api/v1/realtime").emit("playlist-created", playlist);
    };
    ipcMain.on("ytmView:createPlaylistObserved", createPlaylistObservedListener);

    const deletePlaylistObservedListener = (event: Electron.IpcMainEvent, playlistId: string) => {
      const ytmView = options.getYtmView();
      if (event.sender !== ytmView.webContents) return;

      fastify.io.of("/api/v1/realtime").emit("playlist-deleted", playlistId);
    };
    ipcMain.on("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);

    fastify.addHook("onClose", () => {
      // This should normally close on its own but we'll make sure it's closed out
      fastify.io.close();
      playerStateStore.removeEventListener(stateStoreListener);
      ipcMain.off("ytmView:createPlaylistObserved", createPlaylistObservedListener);
      ipcMain.off("ytmView:deletePlaylistObserved", deletePlaylistObservedListener);
    });
  });
};

export default CompanionServerAPIv1;
