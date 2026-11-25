/**
 * Per-model knowledge: how big the context window is and which thinking levels a
 * model accepts. Defaults are guessed from the provider kind and model id; the user
 * can override both per model in Assistant settings → Models.
 */
import type { ProviderKind } from "./providers";

export type ThinkingLevel = "auto" | "off" | "low" | "medium" | "high" | "max";

export const THINKING_LEVELS: ThinkingLevel[] = ["auto", "off", "low", "medium", "high", "max"];

export const THINKING_INFO: Record<ThinkingLevel, { label: string; hint: string }> = {
  auto: { label: "Auto", hint: "The model's own default" },
  off: { label: "Off", hint: "Answer without reasoning first" },
  low: { label: "Low", hint: "Quick, light reasoning" },
  medium: { label: "Medium", hint: "Balanced" },
  high: { label: "High", hint: "Think longer on hard tasks" },
  max: { label: "Max", hint: "Deepest reasoning, slowest" },
};

export const DEFAULT_CONTEXT_WINDOW = 200_000;

export interface ModelConfig {
  /** Tokens the model can take in, including the reply. */
  contextWindow?: number;
  /** Thinking levels offered in the composer. Empty hides the selector. */
  thinking?: ThinkingLevel[];
  /** Max output tokens for this model (overrides the global setting). */
  maxOutput?: number;
  /** Temperature for this model (overrides the global setting; null = provider default). */
  temperature?: number | null;
  /** Whether it accepts images and PDFs. Unset = guessed from the model name. */
  vision?: boolean;
  /** Shown instead of the model id. */
  label?: string;
  /** Hidden from the model picker. */
  hidden?: boolean;
}

export const modelKey = (providerId: string, model: string) => `${providerId}/${model}`;

/** Model id without routing prefixes ("models/gemini-2.5-pro", "anthropic/claude-…"). */
export function displayModel(model: string): string {
  return model.replace(/^models\//, "").replace(/^[a-z0-9-]+\/(?=[^/]+$)/i, "");
}

/** Claude models that take adaptive thinking with an effort level (4.6 and later). */
export function claudeAdaptive(model: string): boolean {
  const id = displayModel(model).toLowerCase();
  if (/fable|mythos/.test(id)) return true;
  const match = /claude-(?:opus|sonnet|haiku)-(\d+)(?:[-.](\d+))?/.exec(id);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major >= 5 || (major === 4 && minor >= 6 && minor < 100);
}

const REASONING = /(^|[/-])(o[1-9]|gpt-5|gpt-oss|r1|qwq|qwen3|deepseek-(?:r|reason)|reason|think|magistral|grok-[3-9]|phi-4-reasoning|kimi-k2-thinking)/i;

export function defaultContextWindow(kind: ProviderKind | string, model: string): number {
  const id = displayModel(model).toLowerCase();
  if (kind === "gemini" || id.startsWith("gemini")) return 1_048_576;
  if (/gpt-4\.1/.test(id)) return 1_047_576;
  if (/gpt-5/.test(id)) return 400_000;
  if (/^o[1-9]/.test(id)) return 200_000;
  if (/gpt-4o|gpt-4-turbo/.test(id)) return 128_000;
  if (/claude/.test(id) || kind === "anthropic") return 200_000;
  if (/llama-?3|mistral-large|deepseek|qwen/.test(id)) return 128_000;
  return DEFAULT_CONTEXT_WINDOW;
}

export function defaultThinkingLevels(kind: ProviderKind | string, model: string): ThinkingLevel[] {
  const id = displayModel(model).toLowerCase();
  if (kind === "anthropic" || /claude/.test(id)) {
    if (claudeAdaptive(model)) return ["auto", "low", "medium", "high", "max"];
    if (/claude-(3-7|sonnet-4|opus-4|haiku-4)/.test(id)) return ["off", "low", "medium", "high"];
    return [];
  }
  if (kind === "gemini" || id.startsWith("gemini")) {
    if (/gemini-(2\.5|[3-9])/.test(id)) return ["auto", "off", "low", "medium", "high"];
    return [];
  }
  if (REASONING.test(id)) return ["auto", "low", "medium", "high"];
  return [];
}

export interface ResolvedModel {
  contextWindow: number;
  thinking: ThinkingLevel[];
  /** True when the window came from the user or the provider rather than a guess. */
  knownWindow: boolean;
  maxOutput?: number;
  temperature?: number | null;
  vision: boolean;
  label: string;
}

/** Guess whether a model reads images/PDFs from its name (most current chat models do). */
export function guessVision(kind: ProviderKind | string, model: string): boolean {
  const id = model.toLowerCase();
  if (kind === "anthropic" || kind === "gemini") return true;
  if (/(gpt-4o|gpt-4\.1|gpt-5|o3|o4|vision|llava|gemma-?3|qwen.*vl|pixtral|llama-?3\.2.*vision|claude|gemini|grok-(2-vision|4))/.test(id)) return true;
  return false;
}

export function resolveModel(
  configs: Record<string, ModelConfig> | undefined,
  discovered: Record<string, number> | undefined,
  providerId: string,
  kind: ProviderKind | string,
  model: string,
): ResolvedModel {
  const key = modelKey(providerId, model);
  const config = configs?.[key];
  const found = discovered?.[key];
  const window = config?.contextWindow || found || defaultContextWindow(kind, model);
  return {
    contextWindow: window,
    thinking: config?.thinking ?? defaultThinkingLevels(kind, model),
    knownWindow: Boolean(config?.contextWindow || found),
    ...(config?.maxOutput ? { maxOutput: config.maxOutput } : {}),
    ...(config && "temperature" in config ? { temperature: config.temperature ?? null } : {}),
    vision: config?.vision ?? guessVision(kind, model),
    label: config?.label?.trim() || displayModel(model),
  };
}

/** The level actually used: the chosen one when the model offers it, otherwise its first. */
export function effectiveThinking(chosen: ThinkingLevel, offered: ThinkingLevel[]): ThinkingLevel | null {
  if (!offered.length) return null;
  return offered.includes(chosen) ? chosen : offered.includes("auto") ? "auto" : offered[0];
}

const BUDGET: Record<"low" | "medium" | "high" | "max", number> = { low: 2048, medium: 8192, high: 16384, max: 32000 };

/**
 * Request-body changes for a thinking level, per wire format. Returns the fields to
 * merge into the body plus whether temperature must be dropped (Claude only allows
 * the default temperature while thinking).
 */
export function thinkingPatch(
  kind: ProviderKind,
  model: string,
  level: ThinkingLevel | null,
  maxTokens: number,
  preset?: string,
): { body: Record<string, unknown>; dropTemperature: boolean; maxTokens: number } {
  const none = { body: {}, dropTemperature: false, maxTokens };
  if (!level) return none;
  const id = displayModel(model).toLowerCase();

  if (kind === "anthropic") {
    if (claudeAdaptive(model)) {
      if (level === "off") return /opus-5-5|fable|mythos/.test(id) ? none : { ...none, body: { thinking: { type: "disabled" } } };
      const body: Record<string, unknown> = { thinking: { type: "adaptive", display: "summarized" } };
      if (level !== "auto") body.output_config = { effort: level };
      return { body, dropTemperature: true, maxTokens };
    }
    if (level === "off" || level === "auto") return none;
    const budget = BUDGET[level];
    return { body: { thinking: { type: "enabled", budget_tokens: budget } }, dropTemperature: true, maxTokens: Math.max(maxTokens, budget + 4096) };
  }

  if (kind === "gemini") {
    if (level === "auto") return { ...none, body: { thinkingConfig: { includeThoughts: true } } };
    if (/gemini-[3-9]/.test(id)) {
      const thinkingLevel = level === "off" || level === "low" ? "low" : "high";
      return { ...none, body: { thinkingConfig: { includeThoughts: level !== "off", thinkingLevel } } };
    }
    const budget = level === "off" ? 0 : level === "low" ? 1024 : level === "medium" ? 8192 : 24576;
    return { ...none, body: { thinkingConfig: { includeThoughts: level !== "off", thinkingBudget: budget } } };
  }

  // OpenAI-compatible.
  if (level === "auto") return none;
  const effort = level === "max" ? "high" : level === "off" ? (/gpt-5/.test(id) ? "minimal" : "low") : level;
  if (preset === "openrouter") return { ...none, body: { reasoning: level === "off" ? { enabled: false } : { effort } } };
  return { ...none, body: { reasoning_effort: effort } };
}

/** Rough token count for text (≈ 4 characters per token). */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);
