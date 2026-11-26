/**
 * One-shot model calls for small in-place helpers (e.g. "Ask AI" in the
 * formula editor): one system prompt + one user message → text, streamed,
 * cancellable, no chat history, no tools. Uses the assistant's chosen
 * provider and model.
 */
import { Events } from "@wailsio/runtime";
import { api, errorMessage, list } from "../lib/api";
import type { ProviderView } from "../lib/api";
import { buildBody, newId, StreamParser } from "./protocol";
import { presetFor } from "./providers";
import type { ProviderKind } from "./providers";
import { useAssistant } from "./store";
import { DEFAULT_SETTINGS } from "./types";
import type { AssistantSettings, ChatMessage } from "./types";

interface Handlers {
  lines(lines: string[]): void;
  done(event: { error?: string; cancelled?: boolean }): void;
}

const streams = new Map<string, Handlers>();
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
      const data = event.data as { id: string; error: string; cancelled: boolean };
      const handler = streams.get(data?.id);
      streams.delete(data?.id);
      handler?.done(data);
    });
  } catch {
    listening = false;
  }
}

/** The assistant's provider + model, loading settings if the panel was never opened. */
async function target(): Promise<{ provider: ProviderView; model: string; settings: AssistantSettings } | { error: string }> {
  const state = useAssistant.getState();
  let settings = state.settings;
  let providers = state.providers;
  if (!state.ready) {
    try {
      const raw = await api.getAISettings();
      if (raw) settings = { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AssistantSettings>) };
    } catch {
      // defaults
    }
    providers = list<ProviderView>(await api.listAIProviders().catch((): ProviderView[] => []));
  }
  const provider = providers.find((p) => p.id === settings.providerId && p.enabled) ?? providers.find((p) => p.enabled);
  if (!provider) return { error: "Set up an AI provider in the assistant panel first." };
  const model =
    (provider.id === settings.providerId && settings.model) ||
    provider.defaultModel ||
    provider.models?.[0] ||
    presetFor(provider.preset)?.models[0] ||
    "";
  if (!model) return { error: "Choose a model for your AI provider first." };
  return { provider, model, settings };
}

export interface OneShot {
  /** Resolves with the full text, or an error / cancelled flag. Never rejects. */
  result: Promise<{ text: string; error?: string; cancelled?: boolean }>;
  cancel(): void;
}

/** Ask the configured model once. `onText` gets the text so far while it streams. */
export function askOnce(options: { system: string; prompt: string; maxTokens?: number; onText?: (text: string) => void }): OneShot {
  let requestId = "";
  let cancelled = false;
  const result = (async () => {
    listen();
    const chosen = await target();
    if ("error" in chosen) return { text: "", error: chosen.error };
    if (cancelled) return { text: "", cancelled: true };
    const kind = chosen.provider.kind as ProviderKind;
    const message: ChatMessage = { id: newId("msg"), role: "user", createdAt: Date.now(), parts: [{ type: "text", text: options.prompt }] };
    const body = buildBody({
      kind,
      model: chosen.model,
      system: options.system,
      messages: [message],
      tools: [],
      maxTokens: Math.min(options.maxTokens ?? 2048, chosen.settings.maxTokens || 8192),
      temperature: null,
      preset: chosen.provider.preset,
    });
    return await new Promise<{ text: string; error?: string; cancelled?: boolean }>((resolve) => {
      requestId = newId("req");
      const parser = new StreamParser(kind);
      const textOf = () => parser.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
      streams.set(requestId, {
        lines(lines) {
          for (const line of lines) parser.push(line);
          options.onText?.(textOf());
        },
        done(event) {
          const parsed = parser.result();
          const text = parsed.parts.map((part) => (part.type === "text" ? part.text : "")).join("");
          if (event.cancelled || cancelled) return resolve({ text, cancelled: true });
          const error = parser.error || event.error || (text.trim() ? undefined : "The model returned nothing.");
          resolve({ text, error });
        },
      });
      api.startAIStream(requestId, chosen.provider.id, chosen.model, JSON.stringify(body)).catch((error: unknown) => {
        streams.delete(requestId);
        resolve({ text: "", error: errorMessage(error) });
      });
      if (cancelled) void api.cancelAIStream(requestId).catch(() => undefined);
    });
  })();
  return {
    result,
    cancel() {
      cancelled = true;
      if (requestId) void api.cancelAIStream(requestId).catch(() => undefined);
    },
  };
}
