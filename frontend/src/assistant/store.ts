/**
 * Assistant state and the agent loop: stream a completion, run the tools it asks
 * for (asking the user where needed), feed the results back, repeat.
 *
 * Each chat runs on its own: switching or starting chats doesn't stop a running
 * one, and several chats can work at once. Within a turn, read-only lookups and
 * sub-agents (agents.run) run in parallel.
 */
import { Events } from "@wailsio/runtime";
import { create } from "zustand";
import { api, errorMessage, list } from "../lib/api";
import type { ChatSummary, ProviderInput, ProviderView } from "../lib/api";
import { callMethod } from "../sdk-host/host";
import type { ActivePage, AppInfo } from "../sdk-host/types";
import type { AskAnswer } from "../lib/dialogs";
import { AGENT_TOOL, agentSystemPrompt, agentTitle, agentToolDef, agentTools } from "./agents";
import { resolveMentions } from "./mentions";
import type { Mention } from "./mentions";
import { effectiveThinking, modelKey, resolveModel } from "./models";
import { useAppStore } from "../store";
import { activeHistory, contextUsage, SUMMARY_PROMPT, transcriptOf } from "./context";
import { buildBody, leanHistory, newId, StreamParser } from "./protocol";
import { presetFor } from "./providers";
import { canContinue, isOutputLimit, NOT_RUN, retryLabel, retryReason, trimToLastStep } from "./retry";
import type { ProviderKind } from "./providers";
import { systemPrompt } from "./prompt";
import { sourcesOfCall } from "./sources";
import { LOAD_TOOL, canRunInParallel, chatToolDefs, needsApproval, resolveLoad, runLimited, runTool, toolCatalog } from "./tools";
import { DEFAULT_SETTINGS } from "./types";
import type { AgentRun, AgentStep, AssistantMode, Attachment, AssistantSettings, Chat, ChatMessage, Part, ToolPart, Usage } from "./types";

export type AssistantView = "chat" | "history" | "providers";

/** A chat that is working right now. */
export interface RunInfo {
  messageId: string;
  startedAt: number;
  title: string;
}

interface AssistantState {
  ready: boolean;
  providers: ProviderView[];
  settings: AssistantSettings;
  chats: ChatSummary[];
  /** The open chat. */
  chat: Chat;
  /** Chats that are working, by chat id. */
  runs: Record<string, RunInfo>;
  /** Tool ids waiting for the user, by chat id. */
  waiting: Record<string, string[]>;
  /** Mirrors for the open chat. */
  running: boolean;
  awaiting: string[];
  /** Methods the user allowed for the rest of the open chat. */
  allowed: string[];
  view: AssistantView;

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
  send(text: string, mentions?: Mention[], files?: Attachment[]): Promise<void>;
  /**
   * Retry the last reply. A reply that failed or was stopped after finishing some steps
   * continues from its last good step; otherwise (or with `fresh`) it runs again from
   * the user's message.
   */
  regenerate(options?: { fresh?: boolean }): Promise<void>;
  /** Stops the open chat (or the given one). */
  stop(chatId?: string): void;
  /** Skips the wait before an automatic retry of the open chat (or the given one). */
  retryNow(chatId?: string): void;
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

// ── per-chat run control ────────────────────────────────────────────────────

interface Control {
  stopped: boolean;
  /** In-flight stream ids (the main loop and any sub-agents). */
  requests: Set<string>;
  approvals: Map<string, (allow: boolean) => void>;
  answers: Map<string, (answer: AskAnswer) => void>;
  /** Pending waits before automatic retries; calling one ends that wait now. */
  waits: Set<() => void>;
}

const controls = new Map<string, Control>();
/** Chats kept in memory: the open one and any that are running. */
const live = new Map<string, Chat>();
/** Per-chat "allow for this chat" lists. */
const allowedByChat = new Map<string, string[]>();
const discoveredProviders = new Set<string>();
let settingsTimer: number | undefined;

function controlFor(chatId: string): Control {
  let control = controls.get(chatId);
  if (!control) {
    control = { stopped: false, requests: new Set(), approvals: new Map(), answers: new Map(), waits: new Set() };
    controls.set(chatId, control);
  }
  return control;
}

function releaseControl(chatId: string, control: Control) {
  for (const resolve of control.approvals.values()) resolve(false);
  control.approvals.clear();
  for (const resolve of control.answers.values()) resolve({ answer: "", choices: [], cancelled: true });
  control.answers.clear();
  for (const wake of [...control.waits]) wake();
  for (const id of control.requests) void api.cancelAIStream(id).catch(() => undefined);
  control.requests.clear();
  if (controls.get(chatId) === control) controls.delete(chatId);
}

function persistSettings(settings: AssistantSettings) {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => void api.saveAISettings(JSON.stringify(settings)).catch(() => undefined), 400);
}

function chatTitle(text: string) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 58).trimEnd()}…` : line || "New chat";
}

async function promptContext(webAccess: boolean, toolCount: number, catalog = "") {
  const info = (await callMethod("app.info", {}, { caller: "assistant" }).catch(() => null)) as AppInfo | null;
  const page = (await callMethod("editor.getActive", {}, { caller: "assistant" }).catch(() => null)) as ActivePage | null;
  return {
    appVersion: info?.appVersion ?? "",
    workspace: useAppStore.getState().workspace?.name ?? null,
    page: page ? { id: page.id, title: page.title, kind: page.kind, editable: page.editable } : null,
    theme: info?.theme ?? "light",
    toolCount,
    webAccess,
    catalog,
  };
}

type StreamResult = { parts: Part[]; usage?: Usage; error?: string; cancelled?: boolean; finish?: string; status?: number; fatal?: boolean };

/**
 * Stamps thinking parts with when they started and ended, so the timeline can show
 * "Thought for 12s". A thinking part ends when anything follows it or the stream ends.
 */
function thinkingClock() {
  const stamps: { startedAt?: number; endedAt?: number }[] = [];
  return (parts: Part[], finished = false): Part[] => {
    const now = Date.now();
    return parts.map((part, index) => {
      if (part.type !== "thinking") return part;
      const stamp = (stamps[index] ??= {});
      stamp.startedAt ??= now;
      if (!stamp.endedAt && (finished || index < parts.length - 1)) stamp.endedAt = now;
      return { ...part, startedAt: stamp.startedAt, ...(stamp.endedAt ? { endedAt: stamp.endedAt } : {}) };
    });
  };
}

/** One streamed completion. Resolves with what the model produced. */
function streamStep(control: Control, kind: ProviderKind, providerId: string, model: string, body: Record<string, unknown>, onParts: (parts: Part[]) => void) {
  return new Promise<StreamResult>((resolve) => {
    const requestId = newId("req");
    const parser = new StreamParser(kind);
    const clock = thinkingClock();
    control.requests.add(requestId);
    streams.set(requestId, {
      lines(lines) {
        for (const line of lines) parser.push(line);
        onParts(clock(parser.parts.map((part) => ({ ...part }))));
      },
      done(event) {
        control.requests.delete(requestId);
        const result = parser.result();
        resolve({ ...result, parts: clock(result.parts.map((part) => ({ ...part })), true), error: parser.error || event.error || undefined, cancelled: event.cancelled, status: event.status });
      },
    });
    api.startAIStream(requestId, providerId, model, JSON.stringify(body)).catch((error: unknown) => {
      streams.delete(requestId);
      control.requests.delete(requestId);
      resolve({ parts: [], error: errorMessage(error), fatal: true });
    });
    // Stopped before the stream registered: cancel it right away.
    if (control.stopped) void api.cancelAIStream(requestId).catch(() => undefined);
  });
}

type RetryWait = NonNullable<ChatMessage["retrying"]>;

interface RetryPolicy {
  retries: number;
  /** Seconds between attempts. */
  delay: number;
  /** Called when a wait starts (with its details) and when it ends (null). */
  onWait?: (wait: RetryWait | null) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));

/** Waits `ms`, or less when the chat is stopped or the user asks to retry now. */
function pause(control: Control, ms: number) {
  return new Promise<void>((resolve) => {
    const wake = () => {
      window.clearTimeout(timer);
      control.waits.delete(wake);
      resolve();
    };
    const timer = window.setTimeout(wake, ms);
    control.waits.add(wake);
  });
}

/**
 * streamStep, retried after a pause when it fails for a passing reason (network,
 * rate limit, overloaded or 5xx provider, empty stream). Each attempt sends the same body.
 */
async function streamWithRetry(control: Control, kind: ProviderKind, providerId: string, model: string, body: Record<string, unknown>, onParts: (parts: Part[]) => void, policy: RetryPolicy): Promise<StreamResult> {
  const retries = clamp(policy.retries, 0, 10);
  for (let attempt = 0; ; attempt++) {
    const result = await streamStep(control, kind, providerId, model, body, onParts);
    const reason = control.stopped ? null : retryReason(result);
    if (!reason || attempt >= retries) return result;
    const delay = clamp(policy.delay, 1, 120) * 1000;
    policy.onWait?.({ attempt: attempt + 1, of: retries, at: Date.now() + delay, reason, error: result.error || retryLabel(reason) });
    await pause(control, delay);
    policy.onWait?.(null);
    if (control.stopped) return { parts: [], cancelled: true };
  }
}
const AGENT_MAX_STEPS = 12;

export const useAssistant = create<AssistantState>((set, get) => {
  /** Recomputes the open chat's mirrors. */
  const mirrors = (chatId: string, runs = get().runs, waiting = get().waiting) => ({
    running: Boolean(runs[chatId]),
    awaiting: waiting[chatId] ?? [],
    allowed: allowedByChat.get(chatId) ?? [],
  });

  /** Makes `chat` the open chat. */
  const showChat = (chat: Chat, extra: Partial<AssistantState> = {}) => {
    const previous = get().chat;
    if (previous.id !== chat.id && !get().runs[previous.id]) live.delete(previous.id);
    live.set(chat.id, chat);
    set({ chat, ...mirrors(chat.id), ...extra });
  };

  const retryPolicy = (onWait?: RetryPolicy["onWait"]): RetryPolicy => ({ retries: get().settings.retries, delay: get().settings.retryDelay, onWait });

  const chatById = (chatId: string) => live.get(chatId) ?? (get().chat.id === chatId ? get().chat : undefined);

  /** Writes a chat (running or open); updates the view when it's the open one. */
  const commit = (chat: Chat) => {
    live.set(chat.id, chat);
    if (get().chat.id === chat.id) set({ chat });
  };

  const patchMessage = (chatId: string, messageId: string, patch: (message: ChatMessage) => ChatMessage) => {
    const chat = chatById(chatId);
    if (!chat) return;
    commit({ ...chat, messages: chat.messages.map((message) => (message.id === messageId ? patch(message) : message)) });
  };

  const patchTool = (chatId: string, messageId: string, toolId: string, patch: Partial<ToolPart> | ((part: ToolPart) => Partial<ToolPart>)) =>
    patchMessage(chatId, messageId, (message) => ({
      ...message,
      parts: message.parts.map((part) => (part.type === "tool" && part.id === toolId ? { ...part, ...(typeof patch === "function" ? patch(part) : patch) } : part)),
    }));

  const messageOf = (chatId: string, messageId: string) => chatById(chatId)?.messages.find((message) => message.id === messageId);

  const setRun = (chatId: string, info: RunInfo | null) => {
    const runs = { ...get().runs };
    if (info) runs[chatId] = info;
    else delete runs[chatId];
    const waiting = { ...get().waiting };
    if (!info) delete waiting[chatId];
    set({ runs, waiting, ...(get().chat.id === chatId ? mirrors(chatId, runs, waiting) : {}) });
  };

  const setWaiting = (chatId: string, update: (ids: string[]) => string[]) => {
    const waiting = { ...get().waiting, [chatId]: update(get().waiting[chatId] ?? []) };
    set({ waiting, ...(get().chat.id === chatId ? { awaiting: waiting[chatId] } : {}) });
  };

  const saveChat = async (chat: Chat) => {
    if (!chat.messages.length) return;
    try {
      await api.saveAIChat(JSON.stringify(chat));
      await get().refreshChats();
    } catch (error) {
      useAppStore.getState().notify(`Couldn't save the chat: ${errorMessage(error)}`, "error");
    }
  };

  const waitFor = <T,>(chatId: string, toolId: string, register: (resolve: (value: T) => void) => void) =>
    new Promise<T>((resolve) => {
      register(resolve);
      setWaiting(chatId, (ids) => [...ids, toolId]);
    }).finally(() => setWaiting(chatId, (ids) => ids.filter((id) => id !== toolId)));

  /** Asks the model for a summary of `messages` (as a plain transcript). Returns "" on failure. */
  const summarize = async (control: Control, provider: ProviderView, model: string, messages: ChatMessage[]): Promise<{ text: string; error?: string }> => {
    const kind = provider.kind as ProviderKind;
    const request: ChatMessage = { id: newId("msg"), role: "user", createdAt: Date.now(), parts: [{ type: "text", text: `${SUMMARY_PROMPT}\n\n<conversation>\n${transcriptOf(messages)}\n</conversation>` }] };
    const body = buildBody({ kind, model, system: "You write precise, compact summaries of work sessions.", messages: [request], tools: [], maxTokens: Math.min(4096, get().settings.maxTokens), temperature: null, preset: provider.preset });
    const result = await streamWithRetry(control, kind, provider.id, model, body, () => undefined, retryPolicy());
    if (result.cancelled) return { text: "", error: "Stopped." };
    const text = result.parts.map((part) => (part.type === "text" ? part.text : "")).join("").trim();
    return result.error || !text ? { text: "", error: result.error || "The model returned an empty summary." } : { text };
  };

  const summaryMessage = (text: string, count: number, auto: boolean): ChatMessage => ({
    id: newId("msg"),
    role: "user",
    createdAt: Date.now(),
    summary: { messages: count, at: Date.now(), auto },
    parts: [{ type: "text", text: `Summary of the earlier conversation (${count} messages, compacted to save context):\n\n${text}` }],
  });

  /**
   * Auto-compact: summarizes everything before the current user message into one summary
   * message placed just before it. Earlier messages stay visible but are no longer sent.
   */
  const compactBefore = async (control: Control, chatId: string, messageId: string, provider: ProviderView, model: string): Promise<boolean> => {
    const chat = chatById(chatId);
    if (!chat) return false;
    const replyIndex = chat.messages.findIndex((message) => message.id === messageId);
    const userIndex = replyIndex - 1;
    if (userIndex < 0 || chat.messages[userIndex].role !== "user") return false;
    const start = chat.messages.length - activeHistory(chat.messages).length;
    const older = chat.messages.slice(start, userIndex);
    if (older.length < 2) return false;
    patchMessage(chatId, messageId, (message) => ({ ...message, compacting: true }));
    const result = await summarize(control, provider, model, older);
    patchMessage(chatId, messageId, (message) => ({ ...message, compacting: undefined }));
    if (!result.text) return false;
    const latest = chatById(chatId)!;
    const at = latest.messages.findIndex((message) => message.id === chat.messages[userIndex].id);
    if (at < 0) return false;
    commit({ ...latest, messages: [...latest.messages.slice(0, at), summaryMessage(result.text, older.length, true), ...latest.messages.slice(at)] });
    return true;
  };

  /** Runs one sub-agent to completion; its progress is mirrored into the parent tool part. */
  const runAgent = async (
    control: Control,
    chatId: string,
    messageId: string,
    call: ToolPart,
    env: { kind: ProviderKind; provider: ProviderView; model: string; settings: AssistantSettings; thinking: ReturnType<typeof effectiveThinking>; workspace: string | null },
  ): Promise<string> => {
    const title = agentTitle(call.args);
    const task = typeof call.args.task === "string" ? call.args.task : "";
    if (!task.trim()) throw new Error("agents.run needs a task.");
    const startedAt = Date.now();
    let run: AgentRun = { title, task, status: "running", steps: [], text: "", startedAt };
    const publish = (patch: Partial<AgentRun>) => {
      run = { ...run, ...patch };
      patchTool(chatId, messageId, call.id, { agent: run });
    };
    publish({});

    const tools = agentTools(env.settings);
    const system = agentSystemPrompt({ workspace: env.workspace, webAccess: env.settings.webAccess, title });
    const chatTitleText = chatById(chatId)?.title ?? "";
    const user: ChatMessage = { id: newId("msg"), role: "user", parts: [{ type: "text", text: task }], createdAt: startedAt };
    let reply: ChatMessage = { id: newId("msg"), role: "assistant", parts: [], createdAt: startedAt };
    const usage: Usage = { input: 0, output: 0 };
    const textOf = (parts: Part[]) => parts.map((part) => (part.type === "text" ? part.text : "")).join("").trim();

    for (let step = 0; step < AGENT_MAX_STEPS; step++) {
      if (control.stopped) break;
      const body = buildBody({
        kind: env.kind,
        model: env.model,
        system,
        messages: [user, reply],
        tools: step === AGENT_MAX_STEPS - 1 ? [] : tools,
        maxTokens: env.settings.maxTokens,
        temperature: env.settings.temperature,
        preset: env.provider.preset,
        thinking: env.thinking,
      });
      const base = reply.parts;
      const result = await streamWithRetry(
        control,
        env.kind,
        env.provider.id,
        env.model,
        body,
        (parts) => {
          const text = textOf(parts);
          if (text && text !== run.text) publish({ text });
        },
        retryPolicy((wait) => publish({ text: wait ? `${retryLabel(wait.reason)} — retrying (${wait.attempt} of ${wait.of})…` : "" })),
      );
      usage.input = Math.max(usage.input, result.usage?.input ?? 0);
      usage.output += result.usage?.output ?? 0;
      reply = { ...reply, parts: [...base, ...result.parts] };
      if (result.cancelled || control.stopped) break;
      if (result.error) {
        publish({ status: "error", text: result.error, endedAt: Date.now(), usage });
        throw new Error(`The sub-agent failed: ${result.error}`);
      }
      const calls = result.parts.filter((part): part is ToolPart => part.type === "tool");
      if (!calls.length) {
        const report = textOf(result.parts) || textOf(reply.parts);
        publish({ status: "done", text: report, endedAt: Date.now(), usage });
        return report || "(The sub-agent finished without a report.)";
      }
      publish({
        text: "",
        steps: [...run.steps, ...calls.map((item): AgentStep => ({ id: item.id, name: item.name, args: item.args, status: "pending" }))],
      });
      const patchStep = (id: string, patch: Partial<AgentStep>) => publish({ steps: run.steps.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
      const results = new Map<string, Partial<ToolPart>>();
      await runLimited(
        calls.map((item) => async () => {
          if (control.stopped) return;
          if (!tools.some((tool) => tool.method === item.name)) {
            const error = `${item.name} isn't available to sub-agents (read-only tools only).`;
            results.set(item.id, { status: "error", error });
            patchStep(item.id, { status: "error", error, endedAt: Date.now() });
            return;
          }
          patchStep(item.id, { status: "running", startedAt: Date.now() });
          try {
            const output = await runTool(item.name, item.args, "ask", { id: chatId, title: chatTitleText });
            results.set(item.id, { status: "done", result: output });
            const sources = sourcesOfCall(item.name, item.args, output).map(({ title: name, url }) => ({ title: name, url }));
            patchStep(item.id, { status: "done", endedAt: Date.now(), ...(sources.length ? { sources } : {}) });
          } catch (error) {
            results.set(item.id, { status: "error", error: errorMessage(error) });
            patchStep(item.id, { status: "error", error: errorMessage(error), endedAt: Date.now() });
          }
        }),
        env.settings.parallel,
      );
      reply = {
        ...reply,
        parts: reply.parts.map((part) => (part.type === "tool" && results.has(part.id) ? { ...part, ...results.get(part.id) } : part.type === "tool" && part.status === "pending" ? { ...part, status: "error", error: "Not run." } : part)),
      };
    }
    publish({ status: "stopped", endedAt: Date.now(), usage, steps: run.steps.map((item) => (item.status === "running" || item.status === "pending" ? { ...item, status: "error", error: "Stopped." } : item)) });
    const partial = textOf(reply.parts);
    if (control.stopped) throw new Error("Stopped.");
    return partial || `The sub-agent stopped after ${AGENT_MAX_STEPS} steps without a final report.`;
  };

  /** tools.load: adds methods to the chat's loaded set; returns what the model sees. */
  const loadTools = (chatId: string, mode: AssistantMode, settings: AssistantSettings, requested: unknown): string => {
    const { methods, unknown } = resolveLoad(mode, settings, requested);
    const chat = chatById(chatId);
    if (chat && methods.length) commit({ ...chat, tools: [...new Set([...(chat.tools ?? []), ...methods])] });
    if (!methods.length) throw new Error(`Nothing to load${unknown.length ? ` for ${unknown.join(", ")}` : ""}. Use namespaces or method names from the catalog; some tools need another mode.`);
    return JSON.stringify({ loaded: methods, ...(unknown.length ? { unknown } : {}), note: "These tools are available from your next call." });
  };

  /** Runs the agent loop for an (empty or partial) assistant message of a chat. */
  const runLoop = async (chatId: string, messageId: string) => {
    const { settings, providers } = get();
    const provider = providers.find((item) => item.id === settings.providerId && item.enabled);
    if (!provider || !settings.model) {
      patchMessage(chatId, messageId, (message) => ({ ...message, error: "Choose a provider and model first." }));
      return;
    }
    const chat = chatById(chatId);
    if (!chat) return;
    const control = controlFor(chatId);
    control.stopped = false;
    const startedAt = Date.now();
    setRun(chatId, { messageId, startedAt, title: chat.title });

    const kind = provider.kind as ProviderKind;
    const mode = chat.mode;
    const model = settings.model;
    const lazy = settings.toolLoading !== "all";
    const toolsFor = () => {
      const defs = chatToolDefs(mode, settings, lazy ? chatById(chatId)?.tools ?? [] : "all");
      if (settings.agents) defs.push(agentToolDef());
      return defs;
    };
    let tools = toolsFor();
    const resolved = resolveModel(settings.models, settings.discovered, provider.id, kind, model);
    const maxTokens = resolved.maxOutput ?? settings.maxTokens;
    const temperature = resolved.temperature !== undefined ? resolved.temperature : settings.temperature;
    let compacted = false;
    const thinking = effectiveThinking(settings.thinking, resolved.thinking);
    const workspace = useAppStore.getState().workspace?.name ?? null;
    patchMessage(chatId, messageId, (message) => ({ ...message, model, providerId: provider.id, endedAt: undefined }));

    let outputTokens = messageOf(chatId, messageId)?.usage?.output ?? 0;
    const markStopped = () => patchMessage(chatId, messageId, (message) => ({ ...message, stopped: true }));

    try {
      // The catalog lists every non-core tool and doesn't change as tools load, so the
      // system prompt stays byte-identical across steps (prompt caching).
      const system = systemPrompt(mode, settings, await promptContext(settings.webAccess, tools.length, lazy ? toolCatalog(mode, settings, []) : ""));
      for (let step = 0; step < Math.max(1, settings.maxSteps); step++) {
        const before = messageOf(chatId, messageId);
        const current = chatById(chatId);
        if (!before || !current || control.stopped) {
          if (control.stopped) markStopped();
          return;
        }
        let history = activeHistory(current.messages.slice(0, current.messages.findIndex((message) => message.id === messageId) + 1));
        // Auto-compact once per run when the context is fuller than the user's threshold.
        if (!compacted && settings.autoCompact > 0 && contextUsage(history, 0).used >= (resolved.contextWindow * settings.autoCompact) / 100) {
          compacted = true;
          if (await compactBefore(control, chatId, messageId, provider, model)) {
            const fresh = chatById(chatId)!;
            history = activeHistory(fresh.messages.slice(0, fresh.messages.findIndex((message) => message.id === messageId) + 1));
          }
          if (control.stopped) {
            markStopped();
            return;
          }
        }
        const body = buildBody({ kind, model, system, messages: leanHistory(history), tools, maxTokens, temperature, preset: provider.preset, thinking, vision: resolved.vision });
        const baseParts = before.parts;
        const result = await streamWithRetry(
          control,
          kind,
          provider.id,
          model,
          body,
          (parts) => patchMessage(chatId, messageId, (message) => ({ ...message, parts: [...baseParts, ...parts] })),
          // While waiting, drop what the failed attempt streamed and show the countdown.
          retryPolicy((wait) => patchMessage(chatId, messageId, (message) => ({ ...message, parts: wait ? baseParts : message.parts, retrying: wait ?? undefined }))),
        );
        outputTokens += result.usage?.output ?? 0;
        patchMessage(chatId, messageId, (message) => ({
          ...message,
          parts: [...baseParts, ...result.parts],
          usage: result.usage ? { input: result.usage.input, output: outputTokens } : message.usage,
        }));
        if (result.cancelled || control.stopped) {
          markStopped();
          return;
        }
        if (result.error) {
          patchMessage(chatId, messageId, (message) => ({ ...message, error: result.error }));
          return;
        }
        if (retryReason(result) === "empty") {
          patchMessage(chatId, messageId, (message) => ({ ...message, error: "The model sent an empty reply. Retry, or try another model." }));
          return;
        }
        const calls = result.parts.filter((part): part is ToolPart => part.type === "tool");
        if (!calls.length) {
          if (isOutputLimit(result.finish)) {
            patchMessage(chatId, messageId, (message) => ({ ...message, error: "The reply hit the output limit. Ask it to continue, or raise Max output in settings." }));
          }
          return;
        }

        const execute = async (call: ToolPart) => {
          if (control.stopped) return;
          patchTool(chatId, messageId, call.id, { status: "running", startedAt: Date.now() });
          try {
            const output =
              call.name === LOAD_TOOL
                ? loadTools(chatId, mode, settings, call.args.tools)
                : call.name === AGENT_TOOL
                  ? await runAgent(control, chatId, messageId, call, { kind, provider, model, settings, thinking, workspace })
                  : await runTool(call.name, call.args, mode, { id: chatId, title: chatById(chatId)?.title ?? "" });
            patchTool(chatId, messageId, call.id, { status: "done", result: output, endedAt: Date.now() });
          } catch (error) {
            patchTool(chatId, messageId, call.id, { status: "error", error: errorMessage(error), endedAt: Date.now() });
          }
        };

        // Consecutive read-only calls (and sub-agents) run together; anything that
        // changes the app, asks the user or needs approval runs on its own, in order.
        for (let index = 0; index < calls.length && !control.stopped; ) {
          const call = calls[index];
          const gated = needsApproval(call.name, get().settings) && !(allowedByChat.get(chatId) ?? []).includes(call.name);
          if (!gated && canRunInParallel(call.name)) {
            const batch: ToolPart[] = [];
            while (index < calls.length && canRunInParallel(calls[index].name) && !needsApproval(calls[index].name, get().settings)) batch.push(calls[index++]);
            await runLimited(batch.map((item) => () => execute(item)), get().settings.parallel);
            continue;
          }
          index++;
          if (gated) {
            patchTool(chatId, messageId, call.id, { status: "awaiting" });
            const allow = await waitFor<boolean>(chatId, call.id, (resolve) => control.approvals.set(call.id, resolve));
            control.approvals.delete(call.id);
            if (control.stopped) break;
            if (!allow) {
              patchTool(chatId, messageId, call.id, { status: "declined", endedAt: Date.now() });
              continue;
            }
          }
          if (call.name === "ui.ask") {
            patchTool(chatId, messageId, call.id, { status: "asking", startedAt: Date.now() });
            const reply = await waitFor<AskAnswer>(chatId, call.id, (resolve) => control.answers.set(call.id, resolve));
            control.answers.delete(call.id);
            if (control.stopped) break;
            patchTool(chatId, messageId, call.id, { status: "done", result: JSON.stringify(reply), endedAt: Date.now() });
            continue;
          }
          await execute(call);
        }
        if (control.stopped) {
          markStopped();
          return;
        }
        if (calls.some((call) => call.name === LOAD_TOOL)) tools = toolsFor();
        if (step === settings.maxSteps - 1) {
          patchMessage(chatId, messageId, (message) => ({ ...message, error: `Paused after ${settings.maxSteps} steps. Send “continue” to keep going.` }));
        }
      }
    } catch (error) {
      patchMessage(chatId, messageId, (message) => ({ ...message, error: errorMessage(error) }));
    } finally {
      // Anything never answered or never run is marked so the transcript stays valid.
      const now = Date.now();
      patchMessage(chatId, messageId, (message) => ({
        ...message,
        endedAt: now,
        retrying: undefined,
        parts: message.parts.map((part) => {
          if (part.type === "thinking" && !part.endedAt) return { ...part, endedAt: now };
          if (part.type !== "tool" || !(part.status === "pending" || part.status === "awaiting" || part.status === "asking" || part.status === "running")) return part;
          const agent = part.agent && part.agent.status === "running" ? { ...part.agent, status: "stopped" as const, endedAt: now } : part.agent;
          return { ...part, status: "error", error: NOT_RUN, endedAt: now, ...(agent ? { agent } : {}) };
        }),
      }));
      releaseControl(chatId, control);
      setRun(chatId, null);
      const finished = chatById(chatId);
      if (finished) {
        const updated = { ...finished, updatedAt: Date.now() };
        commit(updated);
        if (get().chat.id !== chatId) live.delete(chatId);
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
    runs: {},
    waiting: {},
    running: false,
    awaiting: [],
    allowed: [],
    view: "chat",

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
      set({ ready: true, settings, providers, view: providers.length ? "chat" : "providers" });
      showChat(emptyChat(settings.mode));
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
      if (!get().running) commit({ ...get().chat, mode });
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
      // A running chat keeps working in the background.
      showChat(emptyChat(get().settings.mode), { view: "chat" });
    },

    async openChat(id) {
      const running = live.get(id);
      if (running) {
        showChat(running, { view: "chat" });
        return;
      }
      try {
        const raw = await api.getAIChat(id);
        const chat = JSON.parse(raw) as Chat;
        showChat({ ...chat, messages: chat.messages ?? [], mode: chat.mode ?? "ask" }, { view: "chat" });
      } catch (error) {
        useAppStore.getState().notify(errorMessage(error), "error");
      }
    },

    async deleteChat(id) {
      if (get().runs[id]) get().stop(id);
      await api.deleteAIChat(id);
      live.delete(id);
      allowedByChat.delete(id);
      if (get().chat.id === id) showChat(emptyChat(get().settings.mode));
      await get().refreshChats();
    },

    async refreshChats() {
      try {
        set({ chats: list(await api.listAIChats()) });
      } catch {
        // keep the old list
      }
    },

    async send(text, mentions = [], files = []) {
      const trimmed = text.trim() || (files.length ? (files.length === 1 ? "Look at the attached file." : "Look at the attached files.") : "");
      if (!trimmed || get().running) return;
      const chatId = get().chat.id;
      const resolved = mentions.length ? await resolveMentions(mentions) : [];
      const user: ChatMessage = { id: newId("msg"), role: "user", parts: [{ type: "text", text: trimmed }], createdAt: Date.now(), ...(resolved.length ? { mentions: resolved } : {}), ...(files.length ? { attachments: files } : {}) };
      const reply: ChatMessage = { id: newId("msg"), role: "assistant", parts: [], createdAt: Date.now() };
      const chat = chatById(chatId) ?? get().chat;
      const next: Chat = {
        ...chat,
        title: chat.title || chatTitle(trimmed),
        mode: get().settings.mode,
        providerId: get().settings.providerId,
        model: get().settings.model,
        updatedAt: Date.now(),
        messages: [...chat.messages, user, reply],
      };
      commit(next);
      if (get().chat.id === chatId) set({ view: "chat" });
      await runLoop(next.id, reply.id);
    },

    async regenerate(options = {}) {
      if (get().running) return;
      const chat = get().chat;
      const last = chat.messages[chat.messages.length - 1];
      if (!last || last.role !== "assistant") return;
      const kept = !options.fresh && canContinue(last) ? trimToLastStep(last.parts) : null;
      if (kept) {
        // Continue on the same message: the model sees everything up to the last finished step.
        const resumed: ChatMessage = { ...last, parts: kept, error: undefined, stopped: undefined, endedAt: undefined, retrying: undefined };
        commit({ ...chat, messages: [...chat.messages.slice(0, -1), resumed] });
        await runLoop(chat.id, last.id);
        return;
      }
      const reply: ChatMessage = { id: newId("msg"), role: "assistant", parts: [], createdAt: Date.now() };
      commit({ ...chat, messages: [...chat.messages.slice(0, -1), reply] });
      await runLoop(chat.id, reply.id);
    },

    stop(chatId) {
      const id = chatId ?? get().chat.id;
      const control = controls.get(id);
      if (!control) return;
      control.stopped = true;
      for (const request of control.requests) void api.cancelAIStream(request).catch(() => undefined);
      for (const resolve of control.approvals.values()) resolve(false);
      control.approvals.clear();
      for (const resolve of control.answers.values()) resolve({ answer: "", choices: [], cancelled: true });
      control.answers.clear();
      for (const wake of [...control.waits]) wake();
    },

    retryNow(chatId) {
      const control = controls.get(chatId ?? get().chat.id);
      if (control) for (const wake of [...control.waits]) wake();
    },

    answer(toolId, reply) {
      for (const control of controls.values()) {
        const resolve = control.answers.get(toolId);
        if (!resolve) continue;
        control.answers.delete(toolId);
        resolve(reply);
        return;
      }
    },

    async compact() {
      const { chat, settings, providers, running } = get();
      if (running) return;
      const history = activeHistory(chat.messages);
      if (history.length < 2) return;
      const provider = providers.find((item) => item.id === settings.providerId && item.enabled);
      if (!provider || !settings.model) return;
      const control = controlFor(chat.id);
      control.stopped = false;
      setRun(chat.id, { messageId: "", startedAt: Date.now(), title: chat.title });
      try {
        const result = await summarize(control, provider, settings.model, history);
        if (control.stopped) return;
        if (!result.text) {
          useAppStore.getState().notify(`Couldn't compact: ${result.error}`, "error");
          return;
        }
        const latest = chatById(chat.id) ?? chat;
        const next: Chat = { ...latest, updatedAt: Date.now(), messages: [...latest.messages, summaryMessage(result.text, history.length, false)] };
        commit(next);
        await saveChat(next);
      } finally {
        releaseControl(chat.id, control);
        setRun(chat.id, null);
      }
    },

    respond(toolId, allow, always) {
      for (const [chatId, control] of controls) {
        const resolve = control.approvals.get(toolId);
        if (!resolve) continue;
        if (allow && always) {
          const call = chatById(chatId)
            ?.messages.flatMap((message) => message.parts)
            .find((part): part is ToolPart => part.type === "tool" && part.id === toolId);
          if (call) {
            const allowed = [...new Set([...(allowedByChat.get(chatId) ?? []), call.name])];
            allowedByChat.set(chatId, allowed);
            if (get().chat.id === chatId) set({ allowed });
          }
        }
        control.approvals.delete(toolId);
        resolve(allow);
        return;
      }
    },
  };
});
