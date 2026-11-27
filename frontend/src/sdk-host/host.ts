/**
 * The single entry point to the App API.
 *
 * Plugins (through the iframe runtime) and the assistant (through its tools)
 * both call `callMethod`. It enforces who may call what, checks permissions,
 * validates params against the schema in ./spec.ts, fills defaults, asks for
 * confirmation where a plugin does something destructive, then runs the handler.
 */
import { dialogs } from "../lib/dialogs";
import { handlerFor } from "./registry";
import type { CallContext } from "./handlers";
import { validate } from "./schema";
import type { JsonSchema } from "./schema";
import { METHOD_MAP, PERMISSIONS, callersOf } from "./spec";
import type { MethodSpec, Tier } from "./spec";

export type { CallContext, PluginSurface } from "./handlers";
export { SDK_VERSION } from "./handlers";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: "unknown_method" | "not_allowed" | "permission" | "invalid_params" | "cancelled" | "failed",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Older plugins asked for broader permissions; these still satisfy the new ones. */
const LEGACY_EQUIVALENTS: Record<string, string[]> = {
  "workspaces.read": ["pages.read"],
  navigation: ["pages.read"],
  // Local network access includes the internet.
  network: ["network.local"],
};

export function hasPermission(granted: readonly string[] | undefined, permission: string | null): boolean {
  if (!permission) return true;
  if (!granted) return false;
  if (granted.includes(permission)) return true;
  return (LEGACY_EQUIVALENTS[permission] ?? []).some((alt) => granted.includes(alt));
}

function withDefaults(schema: JsonSchema, params: Record<string, unknown>): Record<string, unknown> {
  if (!("type" in schema) || schema.type !== "object") return params;
  const out = { ...params };
  for (const [key, property] of Object.entries(schema.properties)) {
    if (out[key] === undefined && "default" in property && property.default !== undefined) out[key] = property.default;
  }
  return out;
}

export interface CallOptions {
  /** Assistant mode: only methods in these tiers may run. */
  tiers?: readonly Tier[];
}

export function specFor(name: string): MethodSpec | undefined {
  return METHOD_MAP.get(name);
}

export async function callMethod(name: string, rawParams: unknown, ctx: CallContext, options: CallOptions = {}): Promise<unknown> {
  const spec = METHOD_MAP.get(name);
  const handler = handlerFor(name);
  if (!spec || !handler) throw new ApiError(`Unknown method "${name}".`, "unknown_method");

  if (!callersOf(spec).includes(ctx.caller)) {
    const who = ctx.caller === "plugin" ? "plugins" : "the assistant";
    throw new ApiError(`"${name}" is not available to ${who}.`, "not_allowed");
  }
  if (options.tiers && !options.tiers.includes(spec.tier)) {
    throw new ApiError(`"${name}" is not allowed in this mode.`, "not_allowed");
  }
  if (ctx.caller === "plugin" && !hasPermission(ctx.permissions, spec.permission)) {
    const title = PERMISSIONS.find((item) => item.id === spec.permission)?.title ?? spec.permission;
    throw new ApiError(`"${name}" needs the "${spec.permission}" permission (${title}). Add it to manifest.json "permissions".`, "permission");
  }

  const params = rawParams === undefined || rawParams === null ? {} : rawParams;
  if (typeof params !== "object" || Array.isArray(params)) throw new ApiError(`${name}: params must be an object.`, "invalid_params");
  const problem = validate(spec.params, params);
  if (problem) throw new ApiError(`${name}: ${problem}`, "invalid_params");
  const filled = withDefaults(spec.params, params as Record<string, unknown>);

  if (spec.confirm && ctx.caller === "plugin") {
    const ok = await dialogs.confirm({
      title: `Allow ${ctx.pluginName ?? "a plugin"} to continue?`,
      message: `It wants to: ${spec.summary}`,
      details: [{ label: name, description: JSON.stringify(filled).slice(0, 300) }],
      confirmLabel: "Allow",
      danger: true,
      source: ctx.pluginName,
    });
    if (!ok) throw new ApiError("The user declined.", "cancelled");
  }

  try {
    const result = await handler(filled, ctx);
    return result === undefined ? null : result;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error instanceof Error ? error.message : String(error), "failed");
  }
}
