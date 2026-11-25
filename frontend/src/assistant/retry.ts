/**
 * Retrying failed replies: which stream failures are worth retrying automatically,
 * and how a failed or stopped reply is trimmed back to its last good step so Retry
 * can continue from there instead of starting over.
 */
import type { ChatMessage, Part, ToolPart } from "./types";

/** Error put on tool calls that never ran because the reply ended first. */
export const NOT_RUN = "Not run — the response was stopped.";
/** Errors that mean a tool was cut off rather than failing on its own. */
const CUT_OFF = new Set([NOT_RUN, "Stopped.", "Not run."]);

/** How one streamed request ended (what the retry decision looks at). */
export interface StreamOutcome {
  error?: string;
  cancelled?: boolean;
  /** HTTP status of the provider response (0 or missing when it never answered). */
  status?: number;
  finish?: string;
  /** Parts the model produced. */
  parts?: Part[];
  /** The request couldn't be started at all (bad provider, body too large…). */
  fatal?: boolean;
}

export type RetryReason = "network" | "busy" | "empty";

export const isOutputLimit = (finish?: string) => finish === "length" || finish === "max_tokens" || finish === "MAX_TOKENS";

const PERMANENT = /\b(invalid|unauthori[sz]ed|forbidden|api[ _-]?key|permission|not found|does not exist|unsupported|context (length|window)|too long|too large|maximum context|prompt is too|content (policy|filter)|safety|blocked|billing|quota exceeded|insufficient)/i;
const BUSY = /overload|rate[ _-]?limit|too many requests|capacity|resource[ _-]?exhausted|unavailable|try again|internal (server )?error|server error|bad gateway|gateway/i;
const NETWORK = /network error|stream interrupted|timed? ?out|timeout|deadline|connection|could not connect|could not resolve|econn|eof|broken pipe|socket|temporar/i;

/**
 * Why a failed request is worth retrying, or null when it isn't: the user stopped it,
 * the request itself is wrong (400/401/403/404…), or the reply hit the output limit.
 */
export function retryReason(outcome: StreamOutcome): RetryReason | null {
  if (outcome.cancelled || outcome.fatal) return null;
  if (isOutputLimit(outcome.finish)) return null;
  const status = outcome.status ?? 0;
  const error = (outcome.error ?? "").trim();
  if (!error) {
    // A stream that ended without a single part or a finish reason was cut off.
    return !outcome.parts?.length && !outcome.finish ? "empty" : null;
  }
  if (status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599)) return status === 408 ? "network" : "busy";
  if (status >= 400) return null;
  if (PERMANENT.test(error) && !BUSY.test(error)) return null;
  if (BUSY.test(error)) return "busy";
  if (NETWORK.test(error)) return "network";
  return null;
}

export const isRetryable = (outcome: StreamOutcome) => retryReason(outcome) !== null;

/** The short status line shown while waiting to retry. */
export function retryLabel(reason: RetryReason): string {
  if (reason === "busy") return "The provider is busy";
  if (reason === "empty") return "The reply came back empty";
  return "Connection lost";
}

/** A tool call that ran to an answer the model should see (not one cut off by the failure). */
function settled(part: ToolPart): boolean {
  if (part.status === "done" || part.status === "declined") return true;
  return part.status === "error" && !CUT_OFF.has(part.error ?? "");
}

/**
 * Trims a failed or stopped reply back to its last good step: everything up to the
 * last tool call that finished, without calls that never ran. The result always ends
 * with a finished tool round, so it serializes like any mid-turn step (assistant tool
 * calls, then their results) and the next request is valid for every provider.
 * Returns null when there's no finished step to keep (start over instead).
 */
export function trimToLastStep(parts: Part[]): Part[] | null {
  let last = -1;
  parts.forEach((part, index) => {
    if (part.type === "tool" && settled(part)) last = index;
  });
  if (last < 0) return null;
  return parts.slice(0, last + 1).filter((part) => part.type !== "tool" || settled(part));
}

/** Whether Retry can continue this reply from its last step rather than run it again. */
export function canContinue(message: ChatMessage | undefined): boolean {
  if (!message || message.role !== "assistant") return false;
  if (!message.error && !message.stopped) return false;
  return trimToLastStep(message.parts) !== null;
}
