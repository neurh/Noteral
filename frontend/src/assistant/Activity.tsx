/**
 * How a reply shows its work: a live timeline of thinking and tool steps that
 * collapses into "Worked for 34s · 6 steps" when the answer is ready, sub-agent
 * cards, the sources it read, what it changed, and the approval / question cards.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleAlert,
  Hand,
  CircleHelp,
  Compass,
  Database,
  FileText,
  FolderTree,
  Globe,
  LoaderCircle,
  Palette,
  PanelsTopLeft,
  PencilLine,
  Puzzle,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { AskForm } from "../components/AskForm";
import { openMarkdownLink } from "../lib/links";
import { Markdown } from "../lib/markdownView";
import { useAppStore } from "../store";
import { AGENT_TOOL } from "./agents";
import { useFollow } from "./follow";
import { changesOf } from "./ledger";
import type { Change } from "./ledger";
import { hostOf, searchResults, sourcesOf } from "./sources";
import type { Source } from "./sources";
import { useAssistant } from "./store";
import { toolHint, toolLabel, toolSpec } from "./tools";
import type { AgentRun, AgentStep, ChatMessage, Part, ToolPart, ToolStatus } from "./types";

// ── time ───────────────────────────────────────────────────────────────────

/** Re-renders every `interval` ms while `active`. */
export function useNow(active: boolean, interval = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), interval);
    return () => window.clearInterval(timer);
  }, [active, interval]);
  return active ? now : Date.now();
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

// ── model → timeline ───────────────────────────────────────────────────────

export type Step =
  | { kind: "thinking"; key: string; text: string; startedAt?: number; endedAt?: number }
  | { kind: "note"; key: string; text: string }
  | { kind: "tools"; key: string; name: string; tools: ToolPart[] }
  | { kind: "agent"; key: string; tool: ToolPart }
  | { kind: "answered"; key: string; tool: ToolPart };

export interface ReplyLayout {
  steps: Step[];
  /** The answer: the text after the last step. */
  answer: string;
  /** Approval and question cards waiting for the user. */
  pending: ToolPart[];
}

const isWaiting = (status: ToolStatus) => status === "awaiting" || status === "asking";

export function layoutReply(parts: Part[]): ReplyLayout {
  let lastWork = -1;
  parts.forEach((part, index) => {
    if (part.type === "tool" || (part.type === "thinking" && (part.text.trim() || part.redacted))) lastWork = index;
  });
  const steps: Step[] = [];
  const pending: ToolPart[] = [];
  let answer = "";
  parts.forEach((part, index) => {
    if (part.type === "text") {
      if (!part.text.trim()) return;
      if (index > lastWork) {
        answer += part.text;
        return;
      }
      const last = steps[steps.length - 1];
      if (last?.kind === "note") last.text += part.text;
      else steps.push({ kind: "note", key: `n${index}`, text: part.text });
      return;
    }
    if (part.type === "thinking") {
      if (!part.text.trim() && !part.redacted) return;
      const last = steps[steps.length - 1];
      if (last?.kind === "thinking" && !last.endedAt) {
        last.text += part.text;
        last.endedAt = part.endedAt;
      } else steps.push({ kind: "thinking", key: `t${index}`, text: part.text, startedAt: part.startedAt, endedAt: part.endedAt });
      return;
    }
    if (isWaiting(part.status)) {
      pending.push(part);
      return;
    }
    if (part.name === "ui.ask") {
      steps.push({ kind: "answered", key: part.id, tool: part });
      return;
    }
    if (part.name === AGENT_TOOL) {
      steps.push({ kind: "agent", key: part.id, tool: part });
      return;
    }
    // Runs of the same tool ("Read 5 pages") fold into one step.
    const last = steps[steps.length - 1];
    if (last?.kind === "tools" && last.name === part.name) last.tools.push(part);
    else steps.push({ kind: "tools", key: part.id, name: part.name, tools: [part] });
  });
  return { steps, answer, pending };
}

const PLURALS: Record<string, [string, string]> = {
  "web.search": ["Searching the web", "Searched the web"],
  "web.fetch": ["Reading {n} web pages", "Read {n} web pages"],
  "pages.read": ["Reading {n} pages", "Read {n} pages"],
  "search.query": ["Running {n} searches", "Searched notes {n} times"],
  "pages.create": ["Creating {n} pages", "Created {n} pages"],
  "pages.write": ["Writing {n} pages", "Wrote {n} pages"],
  "pages.append": ["Appending to {n} pages", "Appended to {n} pages"],
  "editor.insertMarkdown": ["Writing", "Wrote {n} sections"],
  "editor.updateBlock": ["Editing {n} blocks", "Edited {n} blocks"],
  "databases.addRow": ["Adding {n} rows", "Added {n} rows"],
  "databases.updateRow": ["Updating {n} rows", "Updated {n} rows"],
  "databases.queryRows": ["Querying databases", "Queried {n} databases"],
};

function stepStatus(tools: ToolPart[]): ToolStatus {
  if (tools.some((tool) => tool.status === "running" || tool.status === "pending")) return "running";
  if (tools.every((tool) => tool.status === "declined")) return "declined";
  if (tools.every((tool) => tool.status === "error" || tool.status === "declined")) return "error";
  return "done";
}

function toolsLabel(name: string, tools: ToolPart[]): string {
  const status = stepStatus(tools);
  const plain = (toolSpec(name)?.summary ?? name).replace(/\.$/, "");
  if (status === "declined") return `Declined · ${plain}`;
  if (status === "error") return tools.length > 1 ? `${tools.length} calls failed · ${plain}` : `Failed · ${plain}`;
  const done = status === "done";
  if (tools.length > 1) {
    const plural = PLURALS[name];
    if (plural) return plural[done ? 1 : 0].replace("{n}", String(tools.length));
    return `${toolLabel(name, done)} ×${tools.length}`;
  }
  return toolLabel(name, done);
}

function toolsHint(tools: ToolPart[]): string {
  const hints = [...new Set(tools.map((tool) => toolHint(tool.name, tool.args)).filter(Boolean))];
  if (!hints.length) return "";
  if (tools[0].name === "web.search" || tools[0].name === "search.query") return hints.map((hint) => `“${hint}”`).join(", ");
  return hints.join(", ");
}

function ToolIcon({ name, size = 13 }: { name: string; size?: number }) {
  const props = { size, "aria-hidden": true } as const;
  if (name === AGENT_TOOL) return <Bot {...props} />;
  if (name === "web.search" || name === "web.fetch" || name.startsWith("network.")) return <Globe {...props} />;
  if (name.startsWith("search.")) return <Search {...props} />;
  if (/moveToTrash|remove|delete/i.test(name)) return <Trash2 {...props} />;
  if (name.startsWith("databases.")) return <Database {...props} />;
  if (name.startsWith("appearance.") || name.startsWith("home.")) return <Palette {...props} />;
  if (name.startsWith("layout.") || name.startsWith("tabs.") || name.startsWith("sidebar.")) return <PanelsTopLeft {...props} />;
  if (name.startsWith("plugins.") || name.startsWith("blocks.") || name.startsWith("nodes.") || name.startsWith("status.") || name.startsWith("menus.")) return <Puzzle {...props} />;
  if (name.startsWith("commands.")) return <SquareTerminal {...props} />;
  if (name.startsWith("navigation.")) return <Compass {...props} />;
  if (name.startsWith("preferences.") || name.startsWith("settings.")) return <Settings2 {...props} />;
  if (name === "pages.list" || name.startsWith("workspaces.")) return <FolderTree {...props} />;
  const tier = toolSpec(name)?.tier;
  if (tier && tier !== "read") return <PencilLine {...props} />;
  return <FileText {...props} />;
}

function stepDuration(tools: { startedAt?: number; endedAt?: number }[], now: number): number | null {
  const starts = tools.map((tool) => tool.startedAt).filter((value): value is number => typeof value === "number");
  if (!starts.length) return null;
  const ends = tools.map((tool) => tool.endedAt ?? now);
  return Math.max(...ends) - Math.min(...starts);
}

// ── the timeline ───────────────────────────────────────────────────────────

const VISIBLE_STEPS = 6;

/** What the header says while the reply is working. */
function liveLabel(steps: Step[], now: number): string {
  const last = steps[steps.length - 1];
  if (!last) return "Thinking";
  if (last.kind === "thinking") return last.endedAt ? "Working" : "Thinking";
  if (last.kind === "agent") {
    const running = steps.filter((step) => step.kind === "agent" && step.tool.agent?.status === "running").length;
    return running > 1 ? `${running} agents working` : (last.tool.agent?.title ?? "Agent working");
  }
  if (last.kind === "tools") {
    const status = stepStatus(last.tools);
    if (status === "running") return toolsLabel(last.name, last.tools);
  }
  void now;
  return "Working";
}

export const Timeline = memo(function Timeline({
  message,
  steps,
  live,
  waiting = false,
  answering = false,
}: {
  message: ChatMessage;
  steps: Step[];
  /** The run is still going (it may be writing text between steps). */
  live: boolean;
  /** The run is paused on an approval or a question below the timeline. */
  waiting?: boolean;
  /** Text after the last step is streaming below the timeline. */
  answering?: boolean;
}) {
  const [open, setOpen] = useState(live);
  const [showAll, setShowAll] = useState(false);
  const wasLive = useRef(live);
  // Once the user opens or closes it by hand, stop moving it for them.
  const pinned = useRef(false);
  const now = useNow(live);

  // Open while the run works and fold once it has finished. Text streaming between two
  // steps doesn't fold it: that text may turn into a step a moment later, and folding then
  // reopening is the flicker this avoids.
  useEffect(() => {
    if (!pinned.current) {
      if (live && !wasLive.current) setOpen(true);
      if (!live && wasLive.current) setOpen(false);
    }
    wasLive.current = live;
  }, [live]);

  const sources = useMemo(() => sourcesOf(message).length, [message]);
  if (!steps.length) return null;

  const started = message.createdAt;
  const elapsed = Math.max(0, (live ? now : (message.endedAt ?? lastEnd(steps) ?? started)) - started);
  const count = steps.reduce((sum, step) => sum + (step.kind === "tools" ? step.tools.length : step.kind === "note" ? 0 : 1), 0);
  const onlyThinking = steps.every((step) => step.kind === "thinking");
  const failed = steps.some((step) => step.kind === "tools" && stepStatus(step.tools) === "error");
  const agents = steps.filter((step) => step.kind === "agent").length;

  const summary = waiting
    ? "Waiting for you"
    : live && answering
      ? "Writing"
      : live
    ? liveLabel(steps, now)
    : onlyThinking
      ? `Thought for ${formatDuration(elapsed)}`
      : `Worked for ${formatDuration(elapsed)}`;
  const meta = [
    !onlyThinking && count ? `${count} step${count === 1 ? "" : "s"}` : "",
    agents && !live ? `${agents} agent${agents === 1 ? "" : "s"}` : "",
    sources ? `${sources} source${sources === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  const hidden = !showAll && steps.length > VISIBLE_STEPS + 1 ? steps.length - VISIBLE_STEPS : 0;
  const visible = hidden ? steps.slice(hidden) : steps;

  return (
    <section className={`activity${live && !waiting ? " is-live" : ""}${waiting ? " is-waiting" : ""}${open ? " is-open" : ""}`} aria-label="How the assistant worked">
      <button
        type="button"
        className="activity-head"
        onClick={() => {
          pinned.current = true;
          setOpen((value) => !value);
        }}
        aria-expanded={open}
      >
        <span className="activity-head-icon" aria-hidden="true">
          {waiting ? <Hand size={13} /> : live ? <span className="activity-pulse" /> : failed ? <CircleAlert size={13} /> : <Check size={13} />}
        </span>
        <span className={`activity-head-label${live && !waiting ? " shimmer" : ""}`}>{summary}</span>
        {live ? <span className="activity-timer">{formatDuration(elapsed)}</span> : null}
        {meta.length ? <span className="activity-head-meta">{meta.join(" · ")}</span> : null}
        <ChevronDown size={13} className="activity-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ol className="activity-steps">
          {hidden ? (
            <li className="activity-more">
              <button type="button" onClick={() => setShowAll(true)}>
                {hidden} earlier step{hidden === 1 ? "" : "s"}
              </button>
            </li>
          ) : null}
          {visible.map((step, index) => (
            <StepRow key={step.key} step={step} now={now} live={live && index === visible.length - 1} />
          ))}
        </ol>
      ) : null}
    </section>
  );
});

function lastEnd(steps: Step[]): number | undefined {
  let end: number | undefined;
  for (const step of steps) {
    const value =
      step.kind === "thinking" ? step.endedAt : step.kind === "tools" ? Math.max(0, ...step.tools.map((tool) => tool.endedAt ?? 0)) : step.kind === "agent" ? step.tool.endedAt : undefined;
    if (value && (!end || value > end)) end = value;
  }
  return end;
}

function StepRow({ step, now, live }: { step: Step; now: number; live: boolean }) {
  switch (step.kind) {
    case "thinking":
      return <ThinkingStep step={step} now={now} live={live && !step.endedAt} />;
    case "note":
      return (
        <li className="activity-step is-note">
          <span className="activity-rail" aria-hidden="true"><span className="activity-dot" /></span>
          <div className="activity-body">
            <Markdown source={step.text} className="assistant-md activity-note" onLink={openMarkdownLink} />
          </div>
        </li>
      );
    case "answered":
      return <AnsweredStep tool={step.tool} />;
    case "agent":
      return <AgentStepRow tool={step.tool} now={now} />;
    default:
      return <ToolStep name={step.name} tools={step.tools} now={now} />;
  }
}

function ThinkingStep({ step, now, live }: { step: Extract<Step, { kind: "thinking" }>; now: number; live: boolean }) {
  const [open, setOpen] = useState(false);
  const ms = step.startedAt ? (step.endedAt ?? now) - step.startedAt : null;
  const label = live ? "Thinking" : ms !== null && ms >= 1000 ? `Thought for ${formatDuration(ms)}` : "Thought";
  const text = step.text.trim();
  const preview = live ? text.slice(-400) : "";
  const fullRef = useFollow<HTMLParagraphElement>(live && open ? text : open);
  const previewRef = useFollow<HTMLParagraphElement>(preview, true);
  return (
    <li className={`activity-step is-thinking${live ? " is-running" : ""}`}>
      <span className="activity-rail" aria-hidden="true">
        <Brain size={13} />
      </span>
      <div className="activity-body">
        <button type="button" className="activity-row" onClick={() => text && setOpen((value) => !value)} aria-expanded={open} disabled={!text}>
          <span className={`activity-label${live ? " shimmer" : ""}`}>{label}</span>
          {live && ms !== null ? <span className="activity-time">{formatDuration(ms)}</span> : null}
          {text ? <ChevronDown size={12} className="activity-caret" aria-hidden="true" /> : null}
        </button>
        {open ? (
          <p ref={fullRef} className="activity-reasoning">
            {text}
          </p>
        ) : preview ? (
          <p ref={previewRef} className="activity-reasoning is-preview">
            {preview}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function ToolStep({ name, tools, now }: { name: string; tools: ToolPart[]; now: number }) {
  const [open, setOpen] = useState(false);
  const status = stepStatus(tools);
  const ms = stepDuration(tools, now);
  const hint = toolsHint(tools);
  const results = name === "web.search" ? tools.flatMap((tool) => (tool.status === "done" ? searchResults(tool.result) : [])) : [];
  const fetched = name === "web.fetch" ? tools.filter((tool) => tool.status === "done").map((tool) => String(tool.args.url ?? "")) : [];
  const hosts = [...new Set([...results.map((item) => item.url), ...fetched].map(hostOf))].filter(Boolean);
  return (
    <li className={`activity-step status-${status}${status === "running" ? " is-running" : ""}`}>
      <span className="activity-rail" aria-hidden="true">
        {status === "running" ? <LoaderCircle size={13} className="spin" /> : status === "error" ? <CircleAlert size={13} /> : status === "declined" ? <X size={13} /> : <ToolIcon name={name} />}
      </span>
      <div className="activity-body">
        <button type="button" className="activity-row" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          <span className={`activity-label${status === "running" ? " shimmer" : ""}`}>{toolsLabel(name, tools)}</span>
          {hint ? <span className="activity-hint" title={hint}>{hint}</span> : null}
          {ms !== null && (status === "running" || ms >= 1000) ? <span className="activity-time">{formatDuration(ms)}</span> : null}
          <ChevronDown size={12} className="activity-caret" aria-hidden="true" />
        </button>
        {!open && hosts.length ? <SourceHosts hosts={hosts} /> : null}
        {open ? (
          <div className="activity-detail">
            {tools.map((tool) => (
              <CallDetail key={tool.id} tool={tool} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SourceHosts({ hosts }: { hosts: string[] }) {
  const shown = hosts.slice(0, 4);
  return (
    <div className="activity-hosts">
      {shown.map((host) => (
        <span key={host} className="source-chip is-small">
          <SourceMark host={host} />
          {host}
        </span>
      ))}
      {hosts.length > shown.length ? <span className="activity-hosts-more">+{hosts.length - shown.length}</span> : null}
    </div>
  );
}

function CallDetail({ tool }: { tool: ToolPart }) {
  const sources = tool.name === "web.search" && tool.status === "done" ? searchResults(tool.result) : [];
  return (
    <div className="activity-call">
      {sources.length ? (
        <ul className="activity-results">
          {sources.map((item) => (
            <li key={item.url}>
              <button type="button" onClick={() => openMarkdownLink(item.url)} title={item.url}>
                <SourceMark host={hostOf(item.url)} />
                <span className="activity-result-title">{item.title}</span>
                <small>{hostOf(item.url)}</small>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="assistant-tool-io">
        <span>{tool.name}</span>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
      </div>
      {tool.error ? (
        <div className="assistant-tool-io error">
          <span>Error</span>
          <pre>{tool.error}</pre>
        </div>
      ) : null}
      {tool.result && !sources.length ? (
        <div className="assistant-tool-io">
          <span>Result</span>
          <pre>{prettyResult(tool.result)}</pre>
        </div>
      ) : null}
    </div>
  );
}

function prettyResult(result: string) {
  try {
    const text = JSON.stringify(JSON.parse(result), null, 2);
    return text.length > 4000 ? `${text.slice(0, 4000)}\n…` : text;
  } catch {
    return result.length > 4000 ? `${result.slice(0, 4000)}\n…` : result;
  }
}

// ── sub-agents ─────────────────────────────────────────────────────────────

function AgentStepRow({ tool, now }: { tool: ToolPart; now: number }) {
  const [open, setOpen] = useState(false);
  const run: AgentRun = tool.agent ?? {
    title: typeof tool.args.title === "string" ? tool.args.title : "Sub-agent",
    task: typeof tool.args.task === "string" ? tool.args.task : "",
    status: tool.status === "error" ? "error" : tool.status === "done" ? "done" : "running",
    steps: [],
    text: tool.result ?? "",
    startedAt: tool.startedAt ?? now,
    endedAt: tool.endedAt,
  };
  const running = run.status === "running";
  const ms = (run.endedAt ?? (running ? now : (tool.endedAt ?? now))) - run.startedAt;
  const current = [...run.steps].reverse().find((step) => step.status === "running");
  const activity = running
    ? current
      ? `${toolLabel(current.name, false)}${toolHint(current.name, current.args) ? ` · ${toolHint(current.name, current.args)}` : ""}`
      : run.text
        ? "Writing the report"
        : "Thinking"
    : run.status === "error"
      ? tool.error || "Failed"
      : run.status === "stopped"
        ? "Stopped"
        : `${run.steps.length} step${run.steps.length === 1 ? "" : "s"} · report ready`;
  const report = tool.status === "done" ? (tool.result ?? run.text) : run.text;
  const reportRef = useFollow<HTMLDivElement>(running && open ? report : open);
  return (
    <li className={`activity-step is-agent agent-${run.status}`}>
      <span className="activity-rail" aria-hidden="true">
        {running ? <LoaderCircle size={13} className="spin" /> : run.status === "done" ? <Bot size={13} /> : <CircleAlert size={13} />}
      </span>
      <div className="activity-body">
        <div className="agent-card">
          <button type="button" className="agent-card-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            <span className="agent-card-title">{run.title}</span>
            <span className="activity-time">{formatDuration(ms)}</span>
            <ChevronDown size={12} className="activity-caret" aria-hidden="true" />
          </button>
          <div className={`agent-card-status${running ? " shimmer" : ""}`}>{activity}</div>
          {running && run.steps.length ? (
            <div className="agent-card-progress" aria-hidden="true">
              {run.steps.slice(-12).map((step) => (
                <span key={step.id} className={`agent-tick status-${step.status}`} title={toolLabel(step.name, step.status === "done")} />
              ))}
            </div>
          ) : null}
          {open ? (
            <div className="agent-card-detail">
              <p className="agent-card-task">{run.task}</p>
              {run.steps.length ? (
                <ol className="agent-card-steps">
                  {run.steps.map((step) => (
                    <AgentStepLine key={step.id} step={step} />
                  ))}
                </ol>
              ) : null}
              {report ? (
                <div ref={reportRef} className="agent-card-report">
                  <Markdown source={report} className="assistant-md" onLink={openMarkdownLink} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AgentStepLine({ step }: { step: AgentStep }) {
  const hint = toolHint(step.name, step.args);
  return (
    <li className={`status-${step.status}`}>
      <span className="agent-step-icon" aria-hidden="true">
        {step.status === "running" || step.status === "pending" ? <LoaderCircle size={11} className="spin" /> : step.status === "error" ? <CircleAlert size={11} /> : <ToolIcon name={step.name} size={11} />}
      </span>
      <span className="agent-step-label">{step.status === "error" ? `Failed · ${toolLabel(step.name, false)}` : toolLabel(step.name, step.status === "done")}</span>
      {hint ? <span className="agent-step-hint">{hint}</span> : null}
    </li>
  );
}

// ── questions ──────────────────────────────────────────────────────────────

interface AskArgs {
  question?: string;
  options?: { label?: string; description?: string }[];
  multiple?: boolean;
  allowText?: boolean;
  placeholder?: string;
}

function AnsweredStep({ tool }: { tool: ToolPart }) {
  const args = (tool.args ?? {}) as AskArgs;
  let reply = "";
  let cancelled = false;
  try {
    const parsed = JSON.parse(tool.result ?? "{}") as { answer?: string; cancelled?: boolean };
    reply = parsed.answer ?? "";
    cancelled = Boolean(parsed.cancelled);
  } catch {
    reply = tool.result ?? "";
  }
  return (
    <li className="activity-step is-answered">
      <span className="activity-rail" aria-hidden="true">
        <CircleHelp size={13} />
      </span>
      <div className="activity-body">
        <div className="activity-answered">
          <span className="activity-answered-q">{args.question}</span>
          <span className={`activity-answered-a${cancelled ? " is-skipped" : ""}`}>{cancelled ? "Skipped" : reply || "—"}</span>
        </div>
      </div>
    </li>
  );
}

/** The assistant asked a question (ui.ask): answer it right in the chat. */
export function QuestionCard({ tool }: { tool: ToolPart }) {
  const answer = useAssistant((state) => state.answer);
  const args = (tool.args ?? {}) as AskArgs;
  const options = (args.options ?? []).filter((item) => item?.label).map((item, index) => ({ id: String(index), label: String(item.label), description: item.description ? String(item.description) : undefined }));
  return (
    <div className="assistant-question" role="group" aria-label="Question from the assistant">
      <div className="assistant-question-title">
        <CircleHelp size={13} aria-hidden /> <span>{args.question || "The assistant has a question"}</span>
      </div>
      <AskForm
        compact
        hideQuestion
        question={args.question ?? ""}
        options={options}
        multiple={Boolean(args.multiple)}
        allowText={args.allowText !== false || !options.length}
        placeholder={args.placeholder ?? (options.length ? "Or type your own answer…" : "Type your answer…")}
        onAnswer={(reply) => answer(tool.id, reply)}
        onCancel={() => answer(tool.id, { answer: "", choices: [], cancelled: true })}
        submitLabel="Send answer"
      />
    </div>
  );
}

// ── approval ───────────────────────────────────────────────────────────────

function shortValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const lines = value.split("\n").length;
    if (lines > 3) return `${lines} lines`;
    return value.length > 90 ? `${value.slice(0, 88)}…` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length <= 4 && value.every((item) => typeof item === "string") ? value.join(", ") : `${value.length} items`;
  const keys = Object.keys(value as object);
  return keys.length ? `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }` : "{}";
}

function humanKey(key: string) {
  return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** What an approval-gated call will do, in a sentence and a few fields. */
function describeCall(tool: ToolPart): { lead: ReactNode; fields: [string, string][] } {
  const args = (tool.args ?? {}) as Record<string, unknown>;
  if (tool.name === "plugins.create") {
    const manifest = (args.manifest ?? {}) as { name?: string; permissions?: string[]; description?: string; version?: string };
    const code = typeof args.code === "string" ? args.code : "";
    return {
      lead: (
        <>
          Install the plugin <strong>{manifest.name ?? "Untitled"}</strong>
          {manifest.description ? ` — ${manifest.description}` : ""}
        </>
      ),
      fields: [
        ["Permissions", (manifest.permissions ?? []).length ? (manifest.permissions ?? []).join(", ") : "None"],
        ["Code", `${code.split("\n").length} lines`],
        ...(manifest.version ? ([["Version", manifest.version]] as [string, string][]) : []),
      ],
    };
  }
  const page = typeof args.pageId === "string" ? useAppStore.getState().pages.find((item) => item.id === args.pageId) : undefined;
  const hint = toolHint(tool.name, tool.args);
  const lead = page ? (
    <>
      {toolLabel(tool.name, false)} in <strong>{page.title || "Untitled"}</strong>
    </>
  ) : hint ? (
    <>
      {toolLabel(tool.name, false)} · <strong>{hint}</strong>
    </>
  ) : (
    <>{toolLabel(tool.name, false)}</>
  );
  const fields = Object.entries(args)
    .filter(([key]) => key !== "pageId" || !page)
    .slice(0, 6)
    .map(([key, value]): [string, string] => [humanKey(key), shortValue(value)]);
  return { lead, fields };
}

export function ApprovalCard({ tool }: { tool: ToolPart }) {
  const respond = useAssistant((state) => state.respond);
  const [raw, setRaw] = useState(false);
  const spec = toolSpec(tool.name);
  const destructive = Boolean(spec?.confirm);
  const { lead, fields } = describeCall(tool);
  const title = (spec?.summary ?? tool.name).replace(/\.$/, "");
  return (
    <div
      className={`approval${destructive ? " is-danger" : ""}`}
      role="alertdialog"
      aria-label={`Allow: ${title}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          respond(tool.id, false);
        }
      }}
    >
      <div className="approval-head">
        <span className="approval-icon" aria-hidden="true">
          {destructive ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
        </span>
        <div className="approval-heading">
          <span className="approval-kicker">{destructive ? "Can't be undone easily" : "Needs your OK"}</span>
          <strong className="approval-title">{title}</strong>
        </div>
        <span className="approval-method">
          <ToolIcon name={tool.name} size={11} /> {tool.name}
        </span>
      </div>
      <p className="approval-lead">{lead}</p>
      {fields.length ? (
        <dl className="approval-fields">
          {fields.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {raw ? <pre className="approval-raw">{JSON.stringify(tool.args, null, 2)}</pre> : null}
      <div className="approval-actions">
        <button type="button" className={destructive ? "primary-button primary-danger" : "primary-button"} onClick={() => respond(tool.id, true)} autoFocus>
          Allow
        </button>
        {!destructive ? (
          <button type="button" className="secondary-button" onClick={() => respond(tool.id, true, true)} title={`Don't ask again for ${tool.name} in this chat`}>
            Always in this chat
          </button>
        ) : null}
        <button type="button" className="secondary-button" onClick={() => respond(tool.id, false)} title="Decline (Esc)">
          Decline
        </button>
        <button type="button" className="approval-raw-toggle" onClick={() => setRaw((value) => !value)} aria-pressed={raw}>
          {raw ? "Hide JSON" : "JSON"}
        </button>
      </div>
    </div>
  );
}

// ── sources & changes ──────────────────────────────────────────────────────

/** A letter mark tinted from the host name — no remote favicons, so nothing leaks. */
export function SourceMark({ host }: { host: string }) {
  let hash = 0;
  for (let index = 0; index < host.length; index++) hash = (hash * 31 + host.charCodeAt(index)) >>> 0;
  const letter = (host.replace(/^(www|m|en)\./, "")[0] ?? "?").toUpperCase();
  return (
    <span className="source-mark" style={{ ["--hue" as string]: String(hash % 360) }} aria-hidden="true">
      {letter}
    </span>
  );
}

export function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;
  const shown = open ? sources : sources.slice(0, 4);
  return (
    <div className="reply-sources">
      <div className="reply-sources-head">
        <Globe size={12} aria-hidden="true" />
        <span>
          {sources.length} source{sources.length === 1 ? "" : "s"}
        </span>
        {sources.length > 4 ? (
          <button type="button" className="reply-link" onClick={() => setOpen((value) => !value)}>
            {open ? "Show fewer" : "Show all"}
          </button>
        ) : null}
      </div>
      <ul className={`reply-sources-list${open ? " is-open" : ""}`}>
        {shown.map((source) => (
          <li key={source.url}>
            <button type="button" className="source-card" onClick={() => openMarkdownLink(source.url)} title={source.url}>
              <SourceMark host={source.host} />
              <span className="source-card-text">
                <span className="source-card-title">{source.title}</span>
                <span className="source-card-host">
                  {source.host}
                  {source.read ? " · read" : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChangeList({ changes }: { changes: Change[] }) {
  const [open, setOpen] = useState(false);
  if (!changes.length) return null;
  return (
    <div className={`reply-changes${open ? " is-open" : ""}`}>
      <button type="button" className="reply-changes-head" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <PencilLine size={12} aria-hidden="true" />
        <span>
          {changes.length} change{changes.length === 1 ? "" : "s"}
        </span>
        <span className="reply-changes-peek">{changes.slice(0, 3).map((change) => change.label).join(" · ")}</span>
        <ChevronDown size={12} className="activity-caret" aria-hidden="true" />
      </button>
      {open ? (
        <ul className="reply-changes-list">
          {changes.map((change) => (
            <li key={change.id}>
              <ToolIcon name={change.method} size={12} />
              <span className="reply-change-label">{change.label}</span>
              {change.hint ? <span className="reply-change-hint">{change.hint}</span> : null}
              {change.pageId && useAppStore.getState().pages.some((page) => page.id === change.pageId) ? (
                <button type="button" className="reply-link" onClick={() => openMarkdownLink(`noteral://page/${change.pageId}`)}>
                  Open
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Shown before anything streams: a quiet shimmer and the elapsed time. */
export function ThinkingLoader({ since }: { since: number }) {
  const now = useNow(true);
  return (
    <div className="thinking-loader" aria-live="polite">
      <span className="thinking-orbit" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="shimmer">Thinking</span>
      <span className="activity-timer">{formatDuration(now - since)}</span>
    </div>
  );
}

export { changesOf, sourcesOf };
