/**
 * Provider presets. Every preset maps onto one of three wire formats the Go side
 * knows how to stream: OpenAI-compatible chat completions, Anthropic Messages and
 * Gemini generateContent. Anything else that speaks the OpenAI format works through
 * "Custom".
 */
export type ProviderKind = "openai" | "anthropic" | "gemini";

export interface ProviderPreset {
  id: string;
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** Suggestions shown before the model list is fetched. */
  models: string[];
  needsKey: boolean;
  /** Where to get a key. */
  keyUrl?: string;
  /** One line shown in the picker. */
  note: string;
  local?: boolean;
}

export const PRESETS: ProviderPreset[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"],
    needsKey: true,
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Claude models. Strong at tool use and long edits.",
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o-mini"],
    needsKey: true,
    keyUrl: "https://platform.openai.com/api-keys",
    note: "GPT models through the Chat Completions API.",
  },
  {
    id: "gemini",
    name: "Google Gemini",
    kind: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
    note: "Gemini models. AI Studio keys include a free tier.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: ["openrouter/auto", "deepseek/deepseek-chat-v3-0324:free", "meta-llama/llama-3.3-70b-instruct:free"],
    needsKey: true,
    keyUrl: "https://openrouter.ai/keys",
    note: "Hundreds of models behind one key, including free ones (:free).",
  },
  {
    id: "groq",
    name: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "qwen/qwen3-32b"],
    needsKey: true,
    keyUrl: "https://console.groq.com/keys",
    note: "Very fast open models with a free tier.",
  },
  {
    id: "mistral",
    name: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    models: ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
    needsKey: true,
    keyUrl: "https://console.mistral.ai/api-keys",
    note: "Mistral models. Free experiment tier available.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"],
    needsKey: true,
    keyUrl: "https://platform.deepseek.com/api_keys",
    note: "Low-cost chat and reasoning models.",
  },
  {
    id: "xai",
    name: "xAI",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4", "grok-3-mini"],
    needsKey: true,
    keyUrl: "https://console.x.ai",
    note: "Grok models.",
  },
  {
    id: "together",
    name: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
    needsKey: true,
    keyUrl: "https://api.together.ai/settings/api-keys",
    note: "Open models, hosted.",
  },
  {
    id: "ollama",
    name: "Ollama",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    models: ["llama3.2", "qwen2.5", "mistral"],
    needsKey: false,
    note: "Runs models on this computer. Free and private.",
    local: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    models: [],
    needsKey: false,
    note: "Local models served by LM Studio.",
    local: true,
  },
  {
    id: "custom",
    name: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    models: [],
    needsKey: false,
    note: "Any server that speaks the OpenAI chat completions API.",
  },
];

export const PRESET_MAP = new Map(PRESETS.map((preset) => [preset.id, preset]));

export function presetFor(id: string | undefined): ProviderPreset | undefined {
  return id ? PRESET_MAP.get(id) : undefined;
}
