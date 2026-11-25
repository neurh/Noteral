/**
 * Every SDK method implementation, merged from the handler modules. Built lazily so the
 * import cycle (handlers ↔ handlersUi → plugins/runtime → host → registry) never reads a
 * module's exports before it has finished evaluating.
 */
import { HANDLERS } from "./handlers";
import type { CallContext } from "./handlers";
import { DATABASE_HANDLERS } from "./handlersDatabase";
import { HOME_HANDLERS } from "./handlersHome";
import { SOURCE_HANDLERS } from "./handlersSource";
import { UI_HANDLERS } from "./handlersUi";

export type HandlerFn = (params: Record<string, unknown>, ctx: CallContext) => unknown;

let merged: Record<string, HandlerFn> | undefined;

export function allHandlers(): Record<string, HandlerFn> {
  merged ??= { ...HANDLERS, ...DATABASE_HANDLERS, ...HOME_HANDLERS, ...UI_HANDLERS, ...SOURCE_HANDLERS } as Record<string, HandlerFn>;
  return merged;
}

export function handlerFor(name: string): HandlerFn | undefined {
  return Object.prototype.hasOwnProperty.call(allHandlers(), name) ? allHandlers()[name] : undefined;
}
