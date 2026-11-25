/**
 * Sub-agents: the assistant can hand a self-contained, read-only job to a worker
 * (agents.run). Several run at once; each gets its own context window, uses the
 * read-only tools, and returns a report that becomes the tool result.
 */
import { methodsFor, needsApproval, toolDefs } from "./tools";
import type { AssistantSettings, ToolDef } from "./types";

export const AGENT_TOOL = "agents.run";

/** Tools a sub-agent never gets: it can't ask the user, show UI or move the user around. */
const AGENT_EXCLUDED = /^(ui\.|navigation\.|tabs\.|layout\.|clipboard\.)|^editor\.(scrollToBlock|openFind)$/;

export function agentToolDef(): ToolDef {
  return {
    wireName: "agents__run",
    method: AGENT_TOOL,
    description: [
      "Start a sub-agent: an independent worker that researches one task with read-only tools (search notes, read pages and databases, search and read the web) and returns a written report.",
      "Call it several times in the same turn to run workers in parallel — e.g. one per source, topic or page group — then combine their reports.",
      "It can't see this conversation and can't change anything, so make the task self-contained: what to find, where to look, and what the report must contain.",
      "Use it for broad research or many independent lookups; do quick single lookups yourself.",
      "Returns the agent's report as text.",
    ].join(" "),
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name shown to the user, 2–5 words, e.g. “Compare pricing pages”.", maxLength: 60 },
        task: { type: "string", description: "Complete instructions for the agent, including the shape of the report you want back.", minLength: 8, maxLength: 6000 },
      },
      required: ["task"],
    },
  };
}

/** The read-only tools a sub-agent may call. */
export function agentTools(settings: AssistantSettings): ToolDef[] {
  const allowed = new Set(
    methodsFor("ask", settings)
      .filter((method) => !AGENT_EXCLUDED.test(method.name) && !needsApproval(method.name, settings))
      .map((method) => method.name),
  );
  return toolDefs("ask", settings).filter((tool) => allowed.has(tool.method));
}

export function agentSystemPrompt(ctx: { workspace: string | null; webAccess: boolean; title: string }): string {
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    `You are a research sub-agent inside Noteral, a local-first notes app. Another assistant gave you one task ("${ctx.title}"). Today is ${today}. Workspace: ${ctx.workspace ? `"${ctx.workspace}"` : "none open"}.`,
    `## How to work
- Work on your own: the user can't answer you and you can't change anything. Use the tools to look things up; never guess.
- search.query finds notes; pages.read reads a page; databases.queryRows reads a database.${ctx.webAccess ? "\n- web.search finds web pages; web.fetch reads one. Fetch the best results before relying on them." : "\n- Web access is off."}
- Make several independent lookups in one turn when you can. Stop as soon as you have enough.`,
    `## Your report
- Your final message is returned to the other assistant verbatim. Make it complete on its own: findings first, then details.
- Be dense and factual. Include page ids as [Title](noteral://page/<id>) and web sources as Markdown links.
- Say clearly what you couldn't find or verify.`,
  ].join("\n\n");
}

/** Title for an agents.run call, from its arguments. */
export function agentTitle(args: Record<string, unknown>): string {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (title) return title.slice(0, 60);
  const task = typeof args.task === "string" ? args.task.replace(/\s+/g, " ").trim() : "";
  return task.length > 48 ? `${task.slice(0, 46).trimEnd()}…` : task || "Sub-agent";
}
