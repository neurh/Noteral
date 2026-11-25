import type { Mention } from "./mentions";
import type { ModelConfig, ThinkingLevel } from "./models";

export type AssistantMode = "ask" | "edit" | "creator";

/** "awaiting": waiting for approval. "asking": the assistant asked the user a question (ui.ask). */
export type ToolStatus = "pending" | "awaiting" | "asking" | "running" | "done" | "error" | "declined";

export interface TextPart {
  type: "text";
  text: string;
}

/** Model reasoning shown collapsed; never sent back to the provider. */
export interface ThinkingPart {
  type: "thinking";
  text: string;
  /** Claude: signature that must accompany the block when it is sent back during tool use. */
  signature?: string;
  /** Claude: encrypted reasoning (redacted_thinking), echoed back as is. */
  redacted?: string;
  /** When the model started and stopped thinking (stamped by the app, for the timer). */
  startedAt?: number;
  endedAt?: number;
}

export interface ToolPart {
  type: "tool";
  /** Provider tool-call id (generated for providers that don't send one). */
  id: string;
  /** App API method name, e.g. "pages.create". */
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  /** JSON (or text) returned to the model. */
  result?: string;
  error?: string;
  /** Opaque provider data that must be echoed back (Gemini thought signatures). */
  signature?: string;
  startedAt?: number;
  endedAt?: number;
  /** agents.run: the sub-agent's progress and report. */
  agent?: AgentRun;
}

/** One tool call a sub-agent made (what the timeline shows of it). */
export interface AgentStep {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  error?: string;
  startedAt?: number;
  endedAt?: number;
  /** web.search: sources it found, for the source list. */
  sources?: { title: string; url: string }[];
}

/** A sub-agent started with agents.run: an independent read-only worker. */
export interface AgentRun {
  title: string;
  task: string;
  status: "running" | "done" | "error" | "stopped";
  steps: AgentStep[];
  /** What it is writing right now (live), then its final report. */
  text: string;
  startedAt: number;
  endedAt?: number;
  usage?: Usage;
}

export type Part = TextPart | ThinkingPart | ToolPart;

export interface Usage {
  input: number;
  output: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: Part[];
  createdAt: number;
  /** Assistant messages: which model answered. */
  model?: string;
  providerId?: string;
  usage?: Usage;
  error?: string;
  /** Set when the user stopped the response. */
  stopped?: boolean;
  /** When the response finished (for "worked for …"). */
  endedAt?: number;
  /** Older chats: the open page and selection sent with the message. */
  context?: { pageId?: string; pageTitle?: string; selection?: string };
  /** User messages: things the user mentioned with @ or by dragging, with the content read at send time. */
  mentions?: Mention[];
}

export interface Chat {
  id: string;
  title: string;
  mode: AssistantMode;
  createdAt: number;
  updatedAt: number;
  providerId?: string;
  model?: string;
  messages: ChatMessage[];
}

export interface AssistantSettings {
  providerId: string;
  model: string;
  mode: AssistantMode;
  /** Let the assistant search and read the web. */
  webAccess: boolean;
  /** "destructive": ask only for risky actions. "writes": ask before every change. */
  approval: "destructive" | "writes";
  maxSteps: number;
  maxTokens: number;
  temperature: number | null;
  /** Extra instructions appended to every system prompt. */
  instructions: string;
  /** Reasoning effort; models that don't offer the chosen level use their closest default. */
  thinking: ThinkingLevel;
  /** Per-model overrides keyed by "<providerId>/<model>". */
  models: Record<string, ModelConfig>;
  /** Context windows reported by providers, keyed like `models`. */
  discovered: Record<string, number>;
  /** Let the assistant start read-only sub-agents (agents.run) that work in parallel. */
  agents: boolean;
  /** How many sub-agents (and read-only lookups) run at the same time. */
  parallel: number;
}

export const DEFAULT_SETTINGS: AssistantSettings = {
  providerId: "",
  model: "",
  mode: "ask",
  webAccess: true,
  approval: "destructive",
  maxSteps: 24,
  maxTokens: 8192,
  temperature: null,
  instructions: "",
  thinking: "auto",
  models: {},
  discovered: {},
  agents: true,
  parallel: 4,
};

/** A tool in provider-neutral form. */
export interface ToolDef {
  /** Wire name (dots replaced), e.g. "pages__create". */
  wireName: string;
  method: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** What one streamed completion produced. */
export interface StepResult {
  parts: Part[];
  usage?: Usage;
  finish?: string;
}
