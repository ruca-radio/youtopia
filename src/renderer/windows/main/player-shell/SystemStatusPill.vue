<script setup lang="ts">
import { computed, ref, watch, nextTick } from "vue";
import { RendererLightssAiMessage } from "~shared/player";

type StatusState = "idle" | "ok" | "busy" | "warn" | "bad";
type StatusItem = {
  label: string;
  state: StatusState;
};

const props = defineProps<{
  message: RendererLightssAiMessage | null;
  vuStatus: StatusItem;
  aiStatus: StatusItem;
  wledStatus: StatusItem;
  lightStatus: StatusItem;
  compact?: boolean;
}>();

const open = ref(false);
const title = computed(() => {
  const base = props.message?.title ?? "AI Lightshow";
  if (planPhase.value === "sketch") return `⚡ ${base}`;
  return base;
});
const body = computed(() => props.message?.message ?? "Waiting for playback and controller status.");
const provider = computed(() => props.message?.provider ?? "ollama");
const model = computed(() => props.message?.model ?? "kimi-k2.7-code:cloud");
const planPhase = computed(() => props.message?.planPhase ?? null);
const lightsStatus = computed<StatusItem>(() => {
  if (props.wledStatus.state === "bad" || props.lightStatus.state === "bad") {
    return { label: "Lights failed", state: "bad" };
  }

  if (props.lightStatus.state === "ok") {
    return { label: "Lights live", state: "ok" };
  }

  if (props.wledStatus.state === "ok") {
    return { label: "Lights online", state: "ok" };
  }

  return { label: "Lights unknown", state: "idle" };
});

// Chat Interface State
const chatMessages = ref<Array<{ role: "user" | "assistant" | "system"; content: string }>>([]);
const userMessage = ref("");
const isSending = ref(false);
const chatError = ref<string | null>(null);
const historyEl = ref<HTMLDivElement | null>(null);

const chatProvider = ref<string>("gemini");
const chatModel = ref<string>("gemini-2.5-flash");
const availableModels = ref<string[]>(["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"]);

function scrollToBottom() {
  nextTick(() => {
    if (historyEl.value) {
      historyEl.value.scrollTop = historyEl.value.scrollHeight;
    }
  });
}

async function onProviderChanged() {
  try {
    if (window.ytmd.ai && typeof window.ytmd.ai.fetchModels === "function") {
      const models = await window.ytmd.ai.fetchModels(chatProvider.value);
      if (models && models.length > 0) {
        availableModels.value = models;
        chatModel.value = models[0];
        return;
      }
    }
  } catch (err) {
    console.error("Failed to load models in chat:", err);
  }
  const fallbacks: Record<string, string[]> = {
    ollama: ["kimi-k2.7-code:cloud", "llama3", "mistral", "gemma2", "phi3"],
    gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash", "gemini-1.5-pro"],
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
    openrouter: ["google/gemini-2.5-flash", "google/gemini-2.5-pro", "openai/gpt-4o", "meta-llama/llama-3-70b-instruct"]
  };
  availableModels.value = fallbacks[chatProvider.value] || [];
  chatModel.value = availableModels.value[0] || "";
}

async function sendMessage() {
  if (!userMessage.value.trim() || isSending.value) return;
  chatError.value = null;
  const msgText = userMessage.value.trim();
  userMessage.value = "";

  chatMessages.value.push({ role: "user", content: msgText });
  isSending.value = true;
  scrollToBottom();

  try {
    if (!window.ytmd.ai || typeof window.ytmd.ai.chat !== "function") {
      throw new Error("AI chat API not available");
    }

    const response = await window.ytmd.ai.chat({
      provider: chatProvider.value,
      model: chatModel.value,
      systemPrompt:
        "You are the Youtopia assistant. Help the user configure their lightshow, TV canvas, and audio visualizer. Answer questions, write javascript visualizer scripts if requested, or chat about music.",
      messages: chatMessages.value
    });

    chatMessages.value.push({ role: "assistant", content: response });
  } catch (err) {
    console.error("Chat error:", err);
    chatError.value = err instanceof Error ? err.message : "Failed to get response";
    chatMessages.value.push({ role: "assistant", content: `Error: ${chatError.value}` });
  } finally {
    isSending.value = false;
    scrollToBottom();
  }
}

// Sync settings when opened
watch(open, newOpen => {
  if (newOpen) {
    if (props.message?.provider) {
      chatProvider.value = props.message.provider;
      chatModel.value = props.message.model ?? "";
      onProviderChanged();
    }
  }
});
</script>

<template>
  <div class="system-status" :class="{ compact }">
    <button class="pill" :title="title" @click="open = !open">
      <span class="material-symbols-outlined">auto_awesome</span>
      <span class="dots">
        <i :class="aiStatus.state" title="AI"></i>
        <i :class="lightsStatus.state" title="Lights"></i>
      </span>
      <span v-if="!compact" class="material-symbols-outlined chat-indicator-icon">forum</span>
    </button>

    <div v-if="open && !compact" class="popover">
      <div class="popover-header">
        <strong>{{ title }}</strong>
        <div class="chips">
          <span :class="['chip', vuStatus.state]">{{ vuStatus.label }}</span>
          <span :class="['chip', aiStatus.state]">{{ aiStatus.label }}</span>
          <span :class="['chip', lightsStatus.state]">{{ lightsStatus.label }}</span>
        </div>
      </div>

      <div class="status-msg-section">
        <p class="status-body">{{ body }}</p>
        <span class="meta">
          {{ provider }} / {{ model }}
          <template v-if="message?.genre || message?.mood || message?.bpm"> · {{ message.genre }} · {{ message.mood }} · {{ message.bpm }} BPM </template>
        </span>
      </div>

      <!-- Chat Inference Interface -->
      <div class="chat-section">
        <div class="chat-controls">
          <select v-model="chatProvider" @change="onProviderChanged" class="chat-select">
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="ollama">Ollama</option>
          </select>
          <select v-model="chatModel" class="chat-select model-select">
            <option v-for="m in availableModels" :key="m" :value="m">{{ m }}</option>
          </select>
        </div>

        <div class="chat-history" ref="historyEl">
          <div v-if="chatMessages.length === 0" class="chat-placeholder">Start a direct conversation with {{ chatModel }}...</div>
          <div v-for="(msg, idx) in chatMessages" :key="idx" :class="['chat-msg', msg.role]">
            <span class="role-label">{{ msg.role === "user" ? "You" : chatModel }}</span>
            <p class="msg-content">{{ msg.content }}</p>
          </div>
          <div v-if="isSending" class="chat-msg assistant typing">
            <span class="role-label">{{ chatModel }}</span>
            <p class="msg-content">Thinking...</p>
          </div>
        </div>

        <div class="chat-input-row">
          <input v-model="userMessage" type="text" placeholder="Ask anything..." @keydown.enter="sendMessage" class="chat-input" />
          <button @click="sendMessage" :disabled="isSending" class="chat-send-btn">
            <span class="material-symbols-outlined">send</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system-status {
  position: relative;
  min-width: 0;
  -webkit-app-region: no-drag;
}

.pill {
  width: 100%;
  height: 32px;
  min-width: 0;
  border: 1px solid #303030;
  border-radius: 8px;
  padding: 0 9px;
  display: grid;
  grid-template-columns: auto auto auto;
  align-items: center;
  gap: 7px;
  color: #dddddd;
  background: #171717;
  cursor: pointer;
}

.compact .pill {
  width: 34px;
  grid-template-columns: auto;
  place-items: center;
  padding: 0;
}

.pill:hover {
  border-color: #4a4a4a;
  background: #1f1f1f;
}

.pill .material-symbols-outlined {
  font-size: 18px;
}

.chat-indicator-icon {
  font-size: 16px;
  color: #888888;
  margin-left: 2px;
  display: flex;
  align-items: center;
}

.pill:hover .chat-indicator-icon {
  color: #d72b2b;
}

.dots {
  display: flex;
  gap: 3px;
}

.compact .dots {
  display: none;
}

.dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #666666;
}

.dots i.ok {
  background: #22c55e;
}

.dots i.busy,
.dots i.warn {
  background: #f59e0b;
}

.dots i.bad {
  background: #ef4444;
}

.popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 20;
  width: min(390px, calc(100vw - 36px));
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: #eeeeee;
  background: #000000;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
}

.popover-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #1a1a1a;
  padding-bottom: 8px;
}

.popover-header strong {
  font-size: 13px;
  color: #ffffff;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  max-width: 180px;
}

.status-msg-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.status-body {
  margin: 0;
  color: #d7d7d7;
  font-size: 11px;
  line-height: 1.35;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  min-height: 20px;
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  color: #d6d6d6;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.chip.ok {
  color: #bbf7d0;
  background: rgba(34, 197, 94, 0.16);
  border-color: rgba(34, 197, 94, 0.32);
}

.chip.busy,
.chip.warn {
  color: #fde68a;
  background: rgba(245, 158, 11, 0.16);
  border-color: rgba(245, 158, 11, 0.32);
}

.chip.bad {
  color: #fecaca;
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.34);
}

.meta {
  color: #a7a7a7;
  font-size: 10px;
  line-height: 1.2;
}

/* Chat Section Styles */
.chat-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px solid #1a1a1a;
  padding-top: 10px;
}

.chat-controls {
  display: flex;
  gap: 6px;
}

.chat-select {
  flex: 1;
  height: 26px;
  border-radius: 6px;
  background: #141414;
  border: 1px solid #2a2a2a;
  color: #eeeeee;
  font-size: 11px;
  padding: 0 4px;
  outline: none;
  cursor: pointer;
}

.chat-select:focus {
  border-color: #d72b2b;
}

.chat-history {
  height: 180px;
  overflow-y: auto;
  border: 1px solid #1a1a1a;
  border-radius: 8px;
  background: #050505;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chat-history::-webkit-scrollbar {
  width: 4px;
}
.chat-history::-webkit-scrollbar-track {
  background: #020202;
}
.chat-history::-webkit-scrollbar-thumb {
  background: #202020;
  border-radius: 2px;
}

.chat-placeholder {
  color: #555555;
  font-size: 10px;
  text-align: center;
  margin: auto;
  font-style: italic;
}

.chat-msg {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-width: 85%;
}

.chat-msg.user {
  align-self: flex-end;
  align-items: flex-end;
}

.chat-msg.assistant {
  align-self: flex-start;
  align-items: flex-start;
}

.role-label {
  font-size: 9px;
  color: #666666;
}

.chat-msg.user .role-label {
  color: #7289da;
}

.chat-msg.assistant .role-label {
  color: #d72b2b;
}

.msg-content {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  padding: 5px 8px;
  border-radius: 6px;
  word-break: break-word;
}

.chat-msg.user .msg-content {
  background: #1c1c2e;
  color: #d0d5ff;
  border-bottom-right-radius: 0;
}

.chat-msg.assistant .msg-content {
  background: #221818;
  color: #ffdada;
  border-bottom-left-radius: 0;
}

.chat-msg.assistant.typing .msg-content {
  color: #888888;
  font-style: italic;
}

.chat-input-row {
  display: flex;
  gap: 6px;
}

.chat-input {
  flex: 1;
  height: 28px;
  border-radius: 6px;
  background: #141414;
  border: 1px solid #2a2a2a;
  color: #eeeeee;
  font-size: 11px;
  padding: 0 8px;
  outline: none;
}

.chat-input:focus {
  border-color: #d72b2b;
}

.chat-send-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #1c1c1c;
  border: 1px solid #2a2a2a;
  color: #eeeeee;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  outline: none;
}

.chat-send-btn:hover:not(:disabled) {
  background: #282828;
  border-color: #d72b2b;
}

.chat-send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-send-btn .material-symbols-outlined {
  font-size: 14px;
}
</style>
