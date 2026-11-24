/**
 * Assistant state and the agent loop: stream a completion, run the tools it asks
 * for (asking the user where needed), feed the results back, repeat.
 */
import { Events } from "@wailsio/runtime";
import { create } from "zustand";
import { api, errorMessage, list } from "../lib/api";
import type { ChatSummary, ProviderInput, ProviderView } from "../lib/api";
import { callMethod } from "../sdk-host/host";
import type { ActivePage, AppInfo } from "../sdk-host/types";
import type { AskAnswer } from "../lib/dialogs";
import { resolveMentions } from "./mentions";
import type { Mention } from "./mentions";
import { effectiveThinking, modelKey, resolveModel } from "./models";
import { useAppStore } from "../store";
import { buildBody, newId, StreamParser } from "./protocol";
import { presetFor } from "./providers";
import type { ProviderKind } from "./providers";
import { systemPrompt } from "./prompt";
import { needsApproval, runTool, toolDefs } from "./tools";
import { DEFAULT_SETTINGS } from "./types";
import type { AssistantMode, AssistantSettings, Chat, ChatMessage, Part, ToolPart } from "./types";

export type AssistantView = "chat" | "history" | "providers";

interface AssistantState {
  ready: boolean;
  providers: ProviderView[];
  settings: AssistantSettings;
  chats: ChatSummary[];
  chat: Chat;
  running: boolean;
  view: AssistantView;
  /** Tool ids waiting for the user. */
  awaiting: string[];
  /** Methods the user allowed for the rest of this chat. */
  allowed: string[];

  init(): Promise<void>;
  setView(view: AssistantView): void;
  updateSettings(patch: Partial<AssistantSettings>): void;
  setMode(mode: AssistantMode): void;
  selectModel(providerId: string, model: string): void;
  saveProvider(input: ProviderInput): Promise<ProviderView>;
  deleteProvider(id: string): Promise<void>;
  refreshProviders(): Promise<void>;
  newChat(): void;
  openChat(id: string): Promise<void>;
  deleteChat(id: string): Promise<void>;
  refreshChats(): Promise<void>;
  send(text: string, mentions?: Mention[]): Promise<void>;
  regenerate(): Promise<void>;
  stop(): void;
  respond(toolId: string, allow: boolean, always?: boolean): void;
  /** Answer a question the assistant asked with ui.ask. */
  answer(toolId: string, answer: AskAnswer): void;
  /** Replace the chat with a summary of it, to free the context window. */
  compact(): Promise<void>;
  /** Ask the provider for its models (and their context windows). */
  discoverModels(providerId: string): Promise<string[]>;
}

function emptyChat(mode: AssistantMode): Chat {
  const now = Date.now();
  return { id: newId("chat"), title: "", mode, createdAt: now, updatedAt: now, messages: [] };
}

// ── streaming bridge ────────────────────────────────────────────────────────

interface StreamHandlers {
  lines(lines: string[]): void;
  done(event: { error?: string; cancelled?: boolean; status?: number }): void;
}

const streams = new Map<string, StreamHandlers>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  try {
    Events.On("ai:stream", (event: { data: unknown }) => {
      const data = event.data as { id: string; lines: string[] | null };
      streams.get(data?.id)?.lines(data.lines ?? []);
    });
    Events.On("ai:done", (event: { data: unknown }) => {
      const data = event.data as { id: string; error: string; cancelled: boolean; status: number };
      const handler = streams.get(data?.id);
      streams.delete(data?.id);
      handler?.done(data);
    });
  } catch {
    listening = false;
  }
}

// ── loop control (module-level: one run at a time) ─────────────────────────

let activeRequest: string | null = null;
let stopRequested = false;
const approvals = new Map<string, (allow: boolean) => void>();
const answers = new Map<string, (answer: AskAnswer) => void>();
const discoveredProviders = new Set<string>();
let settingsTimer: number | undefined;

function persistSettings(settings: AssistantSettings) {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => void api.saveAISettings(JSON.stringify(settings)).catch(() => undefined), 400);
}

function chatTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 58).trimEnd()}…` : line || "New chat";
}

async function promptContext(webAccess: boolean, toolCount: number) {
  const info = (await callMethod("app.info", {}, { caller: "assistant" }).catch(() => null)) as AppInfo | null;
  const page = (await callMethod("editor.getActive", {}, { caller: "assistant" }).catch(() => null)) as ActivePage | null;
  return {
    appVersion: info?.appVersion ?? "",
    workspace: useAppStore.getState().workspace?.name ?? null,
    page: page ? { id: page.id, title: page.title, kind: page.kind, editable: page.editable } : null,
    theme: info?.theme ?? "light",
    toolCount,
    webAccess,
  };
}

export const useAssistant = create<AssistantState>((set, get) => {
  /** Replaces one message in the current chat (by id) — only if that chat is still open. */
  const patchMessage = (chatId: string, messageId: string, patch: (message: ChatMessage) => ChatMessage) => {
    const { chat } = get();
    if (chat.id !== chatId) return;
    set({ chat: { ...chat, messages: chat.messages.map((message) => (message.id === messageId ? patch(message) : message)) } });
  };

  const patchTool = (chatId: string, messageId: string, toolId: string, patch: Partial<ToolPart>) =>
    patchMessage(chatId, messageId, (message) => ({
      ...message,
      parts: message.parts.map((part) => (part.type === "tool" && part.id === toolId ? { ...part, ...patch } : part)),
    }));

  const currentMessage = (messageId: string) => get().chat.messages.find((message) => message.id === messageId);

  const saveChat = async (chat: Chat) => {
    if (!chat.messages.length) return;
    try {
      await api.saveAIChat(JSON.stringify(chat));
      await get().refreshChats();
    } catch (error) {
      useAppStore.getState().notify(`Couldn't save the chat: ${errorMessage(error)}`, "error");
    }
  };

  /** One streamed completion. Resolves with what the model produced. */
  const streamStep = (kind: ProviderKind, providerId: string, model: string, body: Record<string, unknown>, onParts: (parts: Part[]) => void) =>
    new Promise<{ parts: Part[]; usage?: { input: number; output: number }; error?: string; cancelled?: boolean; finish?: string }>((resolve) => {
      const requestId = newId("req");
      const parser = new StreamParser(kind);
      activeRequest = requestId;
      streams.set(requestId, {
        lines(lines) {
          for (const line of lines) parser.push(line);
          onParts(parser.parts.map((part) => ({ ...part })));
        },
        done(event) {
          if (activeRequest === requestId) activeRequest = null;
          const result = parser.result();
          resolve({ ...result, parts: result.parts.map((part) => ({ ...part })), error: parser.error || event.error || undefined, cancelled: event.cancelled });
        },
      });
      api.startAIStream(requestId, providerId, model, JSON.stringify(body)).catch((error: unknown) => {
        streams.delete(requestId);
        if (activeRequest === requestId) activeRequest = null;
        resolve({ parts: [], error: errorMessage(error) });
      });
    });

  const waitForAnswer = (toolId: string) =>
    new Promise<AskAnswer>((resolve) => {
      answers.set(toolId, resolve);
      set({ awaiting: [...get().awaiting, toolId] });
    });

  const waitForApproval = (toolId: string) =>
    new Promise<boolean>((resolve) => {
      approvals.set(toolId, resolve);
      set({ awaiting: [...get().awaiting, toolId] });
    });

  /** Runs the agent loop for an (empty or partial) assistant message. */
  const runLoop = async (chatId: string, messageId: string) => {
    const { settings, providers } = get();
    const provider = providers.find((item) => item.id === settings.providerId && item.enabled);
    if (!provider || !settings.model) {
      patchMessage(chatId, messageId, (message) => ({ ...message, error: "Choose a provider and model first." }));
      return;
    }
    const kind = provider.kind as ProviderKind;
    const mode = get().chat.mode;
    const tools = toolDefs(mode, settings);
    const system = systemPrompt(mode, settings, await promptContext(settings.webAccess, tools.length));
    const resolved = resolveModel(settings.models, settings.discovered, provider.id, kind, settings.model);
    const thinking = effectiveThinking(settings.thinking, resolved.thinking);
    stopRequested = false;
    set({ running: true });
    patchMessage(chatId, messageId, (message) => ({ ...message, model: settings.model, providerId: provider.id }));

    let outputTokens = 0;
    try {
      for (let step = 0; step < Math.max(1, settings.maxSteps); step++) {
        const before = currentMessage(messageId);
        if (!before || get().chat.id !== chatId) return;
        const history = get().chat.messages.slice(0, get().chat.messages.findIndex((message) => message.id === messageId) + 1);
        const body = buildBody({
          kind,
          model: settings.model,
          system,
          messages: history,
          tools,
          maxTokens: settings.maxTokens,
          temperature: settings.temperature,
          preset: provider.preset,
          thinking,
        });
        const baseParts = before.parts;
        const result = await streamStep(kind, provider.id, settings.model, body, (parts) =>
          patchMessage(chatId, messageId, (message) => ({ ...message, parts: [...baseParts, ...parts] })),
        );
        outputTokens += result.usage?.output ?? 0;
        patchMessage(chatId, messageId, (message) => ({
          ...message,
          parts: [...baseParts, ...result.parts],
          usage: result.usage ? { input: result.usage.input, output: outputTokens } : message.usage,
        }));
        if (result.cancelled || stopRequested) {
          patchMessage(chatId, messageId, (message) => ({ ...message, stopped: true }));
          return;
        }
        if (result.error) {
          patchMessage(chatId, messageId, (message) => ({ ...message, error: result.error }));
          return;
        }
        const calls = result.parts.filter((part): part is ToolPart => part.type === "tool");
        if (!calls.length) {
          if (result.finish === "length" || result.finish === "max_tokens" || result.finish === "MAX_TOKENS") {
            patchMessage(chatId, messageId, (message) => ({ ...message, error: "The reply hit the output limit. Ask it to continue, or raise Max output in settings." }));
          }
          return;
        }

        for (const call of calls) {
          if (stopRequested) break;
          if (needsApproval(call.name, get().settings) && !get().allowed.includes(call.name)) {
            patchTool(chatId, messageId, call.id, { status: "awaiting" });
            const allow = await waitForApproval(call.id);
            set({ awaiting: get().awaiting.filter((id) => id !== call.id) });
            if (stopRequested) break;
            if (!allow) {
              patchTool(chatId, messageId, call.id, { status: "declined", endedAt: Date.now() });
              continue;
            }
          }
          if (call.name === "ui.ask") {
            patchTool(chatId, messageId, call.id, { status: "asking", startedAt: Date.now() });
            const reply = await waitForAnswer(call.id);
            set({ awaiting: get().awaiting.filter((id) => id !== call.id) });
            if (stopRequested) break;
            patchTool(chatId, messageId, call.id, { status: "done", result: JSON.stringify(reply), endedAt: Date.now() });
            continue;
          }
          patchTool(chatId, messageId, call.id, { status: "running", startedAt: Date.now() });
          try {
            const chat = get().chats.find((item) => item.id === chatId);
            const output = await runTool(call.name, call.args, mode, { id: chatId, title: chat?.title ?? "" });
            patchTool(chatId, messageId, call.id, { status: "done", result: output, endedAt: Date.now() });
          } catch (error) {
            patchTool(chatId, messageId, call.id, { status: "error", error: errorMessage(error), endedAt: Date.now() });
          }
        }
        if (stopRequested) {
          patchMessage(chatId, messageId, (message) => ({ ...message, stopped: true }));
          return;
        }
        if (step === settings.maxSteps - 1) {
          patchMessage(chatId, messageId, (message) => ({ ...message, error: `Paused after ${settings.maxSteps} steps. Send “continue” to keep going.` }));
        }
      }
    } finally {
      // Anything never answered or never run is marked so the transcript stays valid.
      patchMessage(chatId, messageId, (message) => ({
        ...message,
        parts: message.parts.map((part) => (part.type === "tool" && (part.status === "pending" || part.status === "awaiting" || part.status === "asking" || part.status === "running") ? { ...part, status: "error", error: "Not run — the response was stopped." } : part)),
      }));
      for (const resolve of approvals.values()) resolve(false);
      approvals.clear();
      for (const resolve of answers.values()) resolve({ answer: "", choices: [], cancelled: true });
      answers.clear();
      activeRequest = null;
      set({ running: false, awaiting: [] });
      const chat = get().chat;
      if (chat.id === chatId) {
        const updated = { ...chat, updatedAt: Date.now() };
        set({ chat: updated });
        await saveChat(updated);
      }
    }
  };

  return {
    ready: false,
    providers: [],
    settings: DEFAULT_SETTINGS,
    chats: [],
    chat: emptyChat(DEFAULT_SETTINGS.mode),
    running: false,
    view: "chat",
    awaiting: [],
    allowed: [],

    async init() {
      if (get().ready) return;
      listen();
      let settings = DEFAULT_SETTINGS;
      try {
        const raw = await api.getAISettings();
        if (raw) settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AssistantSettings>) };
      } catch {
        // defaults
      }
      const providers = list<ProviderView>(await api.listAIProviders().catch((): ProviderView[] => []));
      // Fall back to the first usable provider when the saved one is gone.
      if (!providers.some((item) => item.id === settings.providerId && item.enabled)) {
        const first = providers.find((item) => item.enabled);
        settings = { ...settings, providerId: first?.id ?? "", model: first ? first.defaultModel || first.models?.[0] || presetFor(first.preset)?.models[0] || "" : "" };
      } else if (!settings.model) {
        const current = providers.find((item) => item.id === settings.providerId)!;
        settings = { ...settings, model: current.defaultModel || current.models?.[0] || presetFor(current.preset)?.models[0] || "" };
      }
      set({ ready: true, settings, providers, chat: emptyChat(settings.mode), view: providers.length ? "chat" : "providers" });
      await get().refreshChats();
    },

    setView: (view) => set({ view }),

    updateSettings(patch) {
      const settings = { ...get().settings, ...patch };
      set({ settings });
      persistSettings(settings);
    },

    setMode(mode) {
      get().updateSettings({ mode });
      set({ chat: { ...get().chat, mode } });
    },

    selectModel(providerId, model) {
      get().updateSettings({ providerId, model });
      const known = get().settings.discovered[modelKey(providerId, model)];
      if (!known && model && !discoveredProviders.has(providerId)) void get().discoverModels(providerId).catch(() => undefined);
    },

    async discoverModels(providerId) {
      discoveredProviders.add(providerId);
      const found = list(await api.listAIModels(providerId));
      const discovered = { ...get().settings.discovered };
      for (const key of Object.keys(discovered)) if (key.startsWith(`${providerId}/`)) delete discovered[key];
      for (const model of found) if (model.contextWindow > 0) discovered[modelKey(providerId, model.id)] = model.contextWindow;
      get().updateSettings({ discovered });
      return found.map((item) => item.id).sort();
    },

    async saveProvider(input) {
      const saved = await api.saveAIProvider(input);
      await get().refreshProviders();
      const { settings } = get();
      const pick = saved.defaultModel || saved.models?.[0] || "";
      const currentUsable = get().providers.some((item) => item.id === settings.providerId && item.enabled);
      // Adopt the provider when nothing usable is selected, or fill in a model
      // the selected provider was saved without.
      if (saved.enabled && (!currentUsable || (settings.providerId === saved.id && !settings.model))) get().selectModel(saved.id, pick);
      return saved;
    },

    async deleteProvider(id) {
      await api.deleteAIProvider(id);
      await get().refreshProviders();
      if (get().settings.providerId === id) {
        const next = get().providers.find((item) => item.enabled);
        get().selectModel(next?.id ?? "", next ? next.defaultModel || next.models?.[0] || "" : "");
      }
    },

    async refreshProviders() {
      set({ providers: list(await api.listAIProviders()) });
    },

    newChat() {
      if (get().running) get().stop();
      set({ chat: emptyChat(get().settings.mode), view: "chat", allowed: [] });
    },

    async openChat(id) {
      if (get().running) get().stop();
      try {
        const raw = await api.getAIChat(id);
        const chat = JSON.parse(raw) as Chat;
        set({ chat: { ...chat, messages: chat.messages ?? [], mode: chat.mode ?? "ask" }, view: "chat", allowed: [] });
      } catch (error) {
        useAppStore.getState().notify(errorMessage(error), "error");
      }
    },

    async deleteChat(id) {
      await api.deleteAIChat(id);
      if (get().chat.id === id) set({ chat: emptyChat(get().settings.mode) });
      await get().refreshChats();
    },

    async refreshChats() {
      try {
        set({ chats: list(await api.listAIChats()) });
      } catch {
        // keep the old list
      }
    },

    async send(text, mentions = []) {
      const trimmed = text.trim();
      if (!trimmed || get().running) return;
      const resolved = mentions.length ? await resolveMentions(mentions) : [];
      const user: ChatMessage = { id: newId("msg"), role: "user", parts: [{ type: "text", text: trimmed }], createdAt: Date.now(), ...(resolved.length ? { mentions: resolved } : {}) };
      const reply: ChatMessage = { id: newId("msg"), role: "assistant", parts: [], createdAt: Date.now() };
      const chat = get().chat;
      const next: Chat = {
        ...chat,
        title: chat.title || chatTitle(trimmed),
        mode: get().settings.mode,
        providerId: get().settings.providerId,
        model: get().settings.model,
        updatedAt: Date.now(),
        messages: [...chat.messages, user, reply],
      };
      set({ chat: next, view: "chat" });
      await runLoop(next.id, reply.id);
    },

    async regenerate() {
      if (get().running) return;
      const chat = get().chat;
      const last = chat.messages[chat.messages.length - 1];
      if (!last || last.role !== "assistant") return;
      const reply: ChatMessage = { id: newId("msg"), role: "assistant", parts: [], createdAt: Date.now() };
      set({ chat: { ...chat, messages: [...chat.messages.slice(0, -1), reply] } });
      await runLoop(chat.id, reply.id);
    },

    stop() {
      stopRequested = true;
      if (activeRequest) void api.cancelAIStream(activeRequest).catch(() => undefined);
      for (const resolve of approvals.values()) resolve(false);
      approvals.clear();
      for (const resolve of answers.values()) resolve({ answer: "", choices: [], cancelled: true });
      answers.clear();
    },

    answer(toolId, reply) {
      const resolve = answers.get(toolId);
      answers.delete(toolId);
      resolve?.(reply);
    },

    async compact() {
      const { chat, settings, providers, running } = get();
      if (running || chat.messages.length < 2) return;
      const provider = providers.find((item) => item.id === settings.providerId && item.enabled);
      if (!provider || !settings.model) return;
      const kind = provider.kind as ProviderKind;
      const request: ChatMessage = {
        id: newId("msg"),
        role: "user",
        createdAt: Date.now(),
        parts: [{ type: "text", text: "Summarize our conversation so far so a fresh chat can continue it: the goal, decisions, what was changed (with page ids and names), open questions and next steps. Be complete but brief. Reply with the summary only." }],
      };
      set({ running: true });
      stopRequested = false;
      try {
        const body = buildBody({ kind, model: settings.model, system: "You write precise, compact summaries of work sessions.", messages: [...chat.messages, request], tools: [], maxTokens: Math.min(4096, settings.maxTokens), temperature: null, preset: provider.preset });
        const result = await streamStep(kind, provider.id, settings.model, body, () => undefined);
        const summary = result.parts.map((part) => (part.type === "text" ? part.text : "")).join("").trim();
        if (result.error || !summary) {
          useAppStore.getState().notify(result.error ? `Couldn't compact: ${result.error}` : "The model returned an empty summary.", "error");
          return;
        }
        const fresh = emptyChat(chat.mode);
        const note: ChatMessage = {
          id: newId("msg"),
          role: "user",
          createdAt: Date.now(),
          parts: [{ type: "text", text: "Continue from this summary of our earlier conversation." }],
          mentions: [{ kind: "text", id: chat.id, label: `Summary of “${chat.title || "earlier chat"}”`, content: summary }],
        };
        const reply: ChatMessage = { id: newId("msg"), role: "assistant", createdAt: Date.now(), parts: [{ type: "text", text: "Got it — I have the summary and can pick up from there." }], model: settings.model, providerId: provider.id };
        const next: Chat = { ...fresh, title: chat.title ? `${chat.title} (continued)` : "Continued chat", messages: [note, reply] };
        set({ chat: next, view: "chat", allowed: [] });
        await saveChat(next);
      } finally {
        set({ running: false });
      }
    },

    respond(toolId, allow, always) {
      if (allow && always) {
        const call = get()
          .chat.messages.flatMap((message) => message.parts)
          .find((part): part is ToolPart => part.type === "tool" && part.id === toolId);
        if (call) set({ allowed: [...new Set([...get().allowed, call.name])] });
      }
      const resolve = approvals.get(toolId);
      approvals.delete(toolId);
      resolve?.(allow);
    },
  };
});
