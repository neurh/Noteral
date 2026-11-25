/**
 * Slash commands for the assistant composer. Actions run right away; prompts fill
 * the input with a ready-made request (and switch to the mode it needs).
 */
import {
  AlignLeft, Brain, Cpu, Globe, Hammer, History, House, Languages, LayoutPanelLeft, Lightbulb, ListTodo, ListTree,
  MessageCircleQuestion, Palette, PencilLine, Puzzle, Replace, RotateCcw, Search, Shrink, Slash, SlidersHorizontal,
  SpellCheck, SquarePen, Table2, type LucideIcon,
} from "lucide-react";
import type { ThinkingLevel } from "./models";
import type { AssistantMode } from "./types";

export interface SlashContext {
  newChat(): void;
  setMode(mode: AssistantMode): void;
  setView(view: "history" | "providers"): void;
  toggleWeb(): void;
  openModels(): void;
  setThinking(level: ThinkingLevel): void;
  thinkingLevels: ThinkingLevel[];
  regenerate(): void;
  compact(): void;
  canRetry: boolean;
  canCompact: boolean;
}

export interface SlashCommand {
  name: string;
  /** Shown after the name, e.g. "<language>". */
  args?: string;
  description: string;
  /** Shown in the slash menu; commands without one get the generic slash icon. */
  icon?: LucideIcon;
  group: "Chat" | "Prompt" | "Mode";
  /** A prompt template; `{input}` is replaced by what was typed after the command. */
  prompt?: string;
  /** Mode the prompt needs. */
  mode?: AssistantMode;
  /** Runs instead of filling a prompt. Return false to keep the menu text. */
  run?: (ctx: SlashContext, arg: string) => void;
  available?: (ctx: SlashContext) => boolean;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "new", icon: SquarePen, description: "Start a new chat", group: "Chat", run: (ctx) => ctx.newChat() },
  { name: "compact", icon: Shrink, description: "Summarize this chat into a fresh one to free up context", group: "Chat", run: (ctx) => ctx.compact(), available: (ctx) => ctx.canCompact },
  { name: "retry", icon: RotateCcw, description: "Continue the last reply from its last step, or run it again", group: "Chat", run: (ctx) => ctx.regenerate(), available: (ctx) => ctx.canRetry },
  { name: "model", icon: Cpu, description: "Choose a model", group: "Chat", run: (ctx) => ctx.openModels() },
  {
    name: "think", icon: Brain,
    args: "<level>",
    description: "Set the thinking level",
    group: "Chat",
    run: (ctx, arg) => {
      const level = arg.trim().toLowerCase() as ThinkingLevel;
      if (ctx.thinkingLevels.includes(level)) ctx.setThinking(level);
      else ctx.openModels();
    },
    available: (ctx) => ctx.thinkingLevels.length > 0,
  },
  { name: "web", icon: Globe, description: "Turn web search and reading on or off", group: "Chat", run: (ctx) => ctx.toggleWeb() },
  { name: "history", icon: History, description: "Open saved chats", group: "Chat", run: (ctx) => ctx.setView("history") },
  { name: "settings", icon: SlidersHorizontal, description: "Providers, models and behaviour", group: "Chat", run: (ctx) => ctx.setView("providers") },

  { name: "ask", icon: MessageCircleQuestion, description: "Ask mode: reads notes and the web, changes nothing", group: "Mode", run: (ctx) => ctx.setMode("ask") },
  { name: "edit", icon: PencilLine, description: "Edit mode: writes pages and databases", group: "Mode", run: (ctx) => ctx.setMode("edit") },
  { name: "creator", icon: Hammer, description: "Creator mode: also changes the app itself", group: "Mode", run: (ctx) => ctx.setMode("creator") },

  { name: "summarize", icon: AlignLeft, description: "Summarize the open page", group: "Prompt", prompt: "Summarize the open page in a few short bullet points. {input}" },
  { name: "explain", icon: Lightbulb, args: "<topic>", description: "Explain something plainly", group: "Prompt", prompt: "Explain {input} plainly, with one short example." },
  { name: "search", icon: Search, args: "<query>", description: "Search the web and answer with sources", group: "Prompt", prompt: "Search the web for: {input}\nAnswer briefly and cite the sources you used." },
  { name: "todos", icon: ListTodo, description: "Pull action items out of the open page", group: "Prompt", prompt: "List every action item in the open page as a checklist, with owners and dates when they're mentioned. {input}" },
  { name: "fix", icon: SpellCheck, description: "Fix spelling and grammar in the selection", group: "Prompt", mode: "edit", prompt: "Fix spelling, grammar and punctuation in my selection without changing its meaning or tone. {input}" },
  { name: "rewrite", icon: Replace, args: "<how>", description: "Rewrite the selection", group: "Prompt", mode: "edit", prompt: "Rewrite my selection to be {input}. Keep the facts." },
  { name: "translate", icon: Languages, args: "<language>", description: "Translate the selection or page", group: "Prompt", mode: "edit", prompt: "Translate my selection (or the open page if nothing is selected) into {input}, keeping the formatting." },
  { name: "outline", icon: ListTree, args: "<topic>", description: "Draft an outline into the page", group: "Prompt", mode: "edit", prompt: "Write an outline for {input} and insert it at the cursor." },
  { name: "table", icon: Table2, args: "<what>", description: "Create a database", group: "Prompt", mode: "edit", prompt: "Create a database for {input}, with sensible properties, a couple of useful views and a few example rows." },
  { name: "theme", icon: Palette, args: "<look>", description: "Restyle the app", group: "Prompt", mode: "creator", prompt: "Restyle the app: {input}. Change colors, fonts and component styles so it looks consistent in light and dark." },
  { name: "plugin", icon: Puzzle, args: "<idea>", description: "Build and test a plugin", group: "Prompt", mode: "creator", prompt: "Build a plugin that {input}. Test it before installing and tell me how to use it." },
  { name: "widget", icon: LayoutPanelLeft, args: "<idea>", description: "Add a status bar widget or sidebar tab", group: "Prompt", mode: "creator", prompt: "Add {input} to the app as a status bar widget or a sidebar tab, whichever fits better." },
  { name: "home", icon: House, args: "<idea>", description: "Design a Home view", group: "Prompt", mode: "creator", prompt: "Design a Home view: {input}. Choose widgets, layout and background that fit." },
];

/** The `/word` being typed at the start of the input, if any. */
export function slashQuery(draft: string): { name: string; arg: string } | null {
  const match = /^\/([a-z-]*)(?:\s+([\s\S]*))?$/i.exec(draft);
  if (!match) return null;
  return { name: match[1].toLowerCase(), arg: match[2] ?? "" };
}

export function matchCommands(name: string, ctx: SlashContext): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => (!command.available || command.available(ctx)) && command.name.startsWith(name));
}

/** The icon to draw for a command, falling back to a generic one. */
export function commandIcon(command: SlashCommand): LucideIcon {
  return command.icon ?? Slash;
}

/** Fills a prompt command's template. */
export function fillPrompt(command: SlashCommand, arg: string): string {
  const text = (command.prompt ?? "").replace("{input}", arg.trim());
  return text.replace(/\s+$/, "").replace(/ \.$/, ".");
}
