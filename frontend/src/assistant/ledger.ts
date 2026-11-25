/** What a reply changed in the app, and what a chat used — for the changes list and the ledger. */
import { METHODS } from "../sdk-host/spec";
import { AGENT_TOOL } from "./agents";
import { sourcesOf } from "./sources";
import { toolHint, toolLabel } from "./tools";
import type { Chat, ChatMessage, ToolPart } from "./types";

export interface Change {
  id: string;
  method: string;
  label: string;
  hint: string;
  /** A page the change made or touched, to open from the list. */
  pageId?: string;
  area: "content" | "app";
}

const NOT_CHANGES = /^(ui\.|navigation\.|tabs\.|clipboard\.|web\.|search\.)/;

function pageIdOf(part: ToolPart): string | undefined {
  const args = part.args as Record<string, unknown>;
  for (const key of ["pageId", "databaseId", "parentId"]) if (typeof args[key] === "string" && args[key]) return args[key] as string;
  if (part.name.startsWith("pages.") || part.name.startsWith("databases.")) {
    try {
      const result = JSON.parse(part.result ?? "") as { id?: unknown; page?: { id?: unknown } };
      const id = result?.id ?? result?.page?.id;
      if (typeof id === "string" && id) return id;
    } catch {
      // not JSON
    }
    if (typeof args.id === "string" && args.id) return args.id;
  }
  return undefined;
}

/** Calls in a reply that changed something (done, not read-only). */
export function changesOf(message: ChatMessage): Change[] {
  const out: Change[] = [];
  for (const part of message.parts) {
    if (part.type !== "tool" || part.status !== "done" || NOT_CHANGES.test(part.name) || part.name === AGENT_TOOL) continue;
    const spec = METHODS.find((method) => method.name === part.name);
    if (!spec || spec.tier === "read") continue;
    out.push({
      id: part.id,
      method: part.name,
      label: toolLabel(part.name, true),
      hint: toolHint(part.name, part.args),
      pageId: pageIdOf(part),
      area: spec.tier === "content" ? "content" : "app",
    });
  }
  return out;
}

export interface Ledger {
  steps: number;
  changes: Change[];
  agents: { id: string; title: string; status: string; steps: number; ms: number }[];
  sources: number;
  input: number;
  output: number;
  /** Time spent working across replies. */
  ms: number;
}

/** Everything a chat did, summed over its replies. */
export function ledgerOf(chat: Chat, now = Date.now()): Ledger {
  const ledger: Ledger = { steps: 0, changes: [], agents: [], sources: 0, input: 0, output: 0, ms: 0 };
  for (const message of chat.messages) {
    if (message.role !== "assistant") continue;
    ledger.changes.push(...changesOf(message));
    ledger.sources += sourcesOf(message).length;
    ledger.input = Math.max(ledger.input, message.usage?.input ?? 0);
    ledger.output += message.usage?.output ?? 0;
    if (message.createdAt) ledger.ms += Math.max(0, (message.endedAt ?? now) - message.createdAt);
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      ledger.steps += 1 + (part.agent?.steps.length ?? 0);
      if (part.agent) {
        ledger.agents.push({
          id: part.id,
          title: part.agent.title,
          status: part.agent.status,
          steps: part.agent.steps.length,
          ms: Math.max(0, (part.agent.endedAt ?? now) - part.agent.startedAt),
        });
      }
    }
  }
  return ledger;
}
