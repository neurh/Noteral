import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { customPrimitive, type DatabaseRow, type Property } from "../../lib/database";
import { contributions, useContributions, type PropertyTypeContribution } from "../../lib/contributions";
import { TemplateError, renderTemplate, sanitizeCss, sanitizeFragment } from "../../lib/cellTemplate";
import { pluginRuntime } from "../../plugins/runtime";
import { ViewFrame } from "../ViewFrame";
import type { DatabaseApi } from "./useDatabase";
import { Popover } from "./Popover";

/** The registered type behind a "custom" property, if its plugin or layer is on. */
export function customTypeOf(property: Property): PropertyTypeContribution | undefined {
  return property.customType ? contributions.current().propertyTypeMap.get(property.customType) : undefined;
}

/** Per-property config with the type's field defaults filled in. */
export function customConfig(def: PropertyTypeContribution | undefined, property: Property): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of def?.config ?? []) if (field.default !== undefined) config[field.key] = field.default;
  return { ...config, ...(property.config ?? {}) };
}

function plainText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "";
  if (Array.isArray(value)) return value.map(plainText).filter(Boolean).join(", ");
  if (typeof value === "object" && "start" in (value as Record<string, unknown>)) return String((value as Record<string, unknown>).start ?? "");
  try { return JSON.stringify(value); } catch { return ""; }
}

/** What templates, renderers and editor views see. */
export function cellContext(def: PropertyTypeContribution | undefined, property: Property, row: DatabaseRow, compact = false) {
  const raw = row.values[property.id] ?? def?.defaultValue;
  const value = customPrimitive(raw);
  const empty = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
  return {
    value: value ?? null,
    raw: raw ?? null,
    text: plainText(value),
    empty,
    config: customConfig(def, property),
    property: { id: property.id, name: property.name, type: property.customType ?? "" },
    row: { id: row.id, title: row.meta.title },
    compact,
  };
}

const BASE_CSS = `:host{display:inline-flex;align-items:center;min-width:0;max-width:100%;font:inherit;color:inherit;line-height:1.35;vertical-align:middle}
:host([data-align=center]){justify-content:center;width:100%}:host([data-align=end]){justify-content:flex-end;width:100%}
*{box-sizing:border-box}[data-value],[data-edit]{cursor:pointer}button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
.err{color:var(--danger,#c33);font-size:11px}`;

// Worker-rendered cells: one request per distinct input, cached for the session.
const rendered = new Map<string, Promise<string>>();

function workerHtml(def: PropertyTypeContribution, context: ReturnType<typeof cellContext>): Promise<string> {
  const key = `${def.key}\u0000${JSON.stringify(context)}`;
  let hit = rendered.get(key);
  if (!hit) {
    if (rendered.size > 2000) rendered.clear();
    hit = pluginRuntime.invoke(def.owner.id, `__cell:${def.type}`, context, 4000).then((html) => (typeof html === "string" ? html : ""));
    hit.catch(() => rendered.delete(key));
    rendered.set(key, hit);
  }
  return hit;
}

function parseValue(text: string): unknown {
  if (text === "") return undefined;
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * A custom property's cell: the type's template (or its plugin's renderer) in a shadow root.
 * Elements with data-value="…" set the value when clicked; data-edit opens the editor.
 */
export function CustomCellDisplay({ property, row, compact, db, onEdit }: { property: Property; row: DatabaseRow; compact?: boolean; db?: DatabaseApi; onEdit?: (anchor: HTMLElement) => void }) {
  const { propertyTypeMap } = useContributions();
  const def = property.customType ? propertyTypeMap.get(property.customType) : undefined;
  const context = useMemo(() => cellContext(def, property, row, compact), [def, property, row, compact]);
  const [workerResult, setWorkerResult] = useState<{ key: string; html: string } | null>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const latest = useRef({ db, row, property, onEdit });
  latest.current = { db, row, property, onEdit };
  const contextKey = JSON.stringify(context);

  const html = useMemo(() => {
    if (!def) return null;
    if (def.render) {
      try {
        return renderTemplate(def.render, context);
      } catch (error) {
        return `<span class="err">${error instanceof TemplateError ? error.message.replace(/[<>&]/g, "") : "Template error"}</span>`;
      }
    }
    return workerResult?.key === contextKey ? workerResult.html : null;
  }, [def, context, contextKey, workerResult]);

  useEffect(() => {
    if (!def || def.render || !def.renderer || def.owner.kind !== "plugin") return;
    let live = true;
    workerHtml(def, context)
      .then((result) => live && setWorkerResult({ key: contextKey, html: result }))
      .catch(() => live && setWorkerResult({ key: contextKey, html: "" }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, contextKey]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || html === null) return;
    const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `${BASE_CSS}\n${def?.css ? sanitizeCss(def.css) : ""}`;
    root.replaceChildren(style, sanitizeFragment(html));
  }, [html, def?.css]);

  const ready = html !== null && Boolean(def);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const target = (event: Event) => {
      for (const node of event.composedPath()) {
        if (node === host) return null;
        if (node instanceof Element && (node.hasAttribute("data-value") || node.hasAttribute("data-edit"))) return node;
      }
      return null;
    };
    const stop = (event: Event) => {
      const { db: api } = latest.current;
      if (target(event) && api && !api.locked) event.stopPropagation();
    };
    const click = (event: Event) => {
      const element = target(event);
      const { db: api, row: current, property: prop, onEdit: edit } = latest.current;
      if (!element || !api || api.locked) return;
      event.preventDefault();
      event.stopPropagation();
      if (element.hasAttribute("data-edit")) {
        edit?.(host);
        return;
      }
      const next = parseValue(element.getAttribute("data-value") ?? "");
      const now = customPrimitive(current.values[prop.id]);
      // Clicking the value that's already set clears it (e.g. the active star) when asked.
      const clear = element.hasAttribute("data-toggle") && JSON.stringify(now) === JSON.stringify(next);
      api.setValue(current.id, prop.id, clear ? undefined : next);
    };
    host.addEventListener("click", click);
    host.addEventListener("mousedown", stop);
    host.addEventListener("pointerdown", stop);
    return () => {
      host.removeEventListener("click", click);
      host.removeEventListener("mousedown", stop);
      host.removeEventListener("pointerdown", stop);
    };
  }, [ready]);

  if (!def) {
    const text = plainText(customPrimitive(row.values[property.id]));
    return (
      <span className="db-text is-muted db-custom-missing" title={`${property.customType || "Custom"} type isn't available — its plugin or layer is off. Values are kept.`}>
        <Puzzle size={12} aria-hidden="true" /> {text}
      </span>
    );
  }
  if (html === null) return <span className="db-text is-muted">{context.text}</span>;
  return <span ref={hostRef} className={`db-custom-cell ${compact ? "is-compact" : ""}`} data-type={def.type} data-align={def.align} />;
}

/** Edits a custom cell in the type's own editor view (a popover next to the cell). */
export function CustomViewEditor({ def, property, row, db, anchor, onClose }: { def: PropertyTypeContribution; property: Property; row: DatabaseRow; db: DatabaseApi; anchor: HTMLElement; onClose: () => void }) {
  const props = useMemo(() => ({ ...cellContext(def, property, row), locked: db.locked }), [def, property, row, db.locked]);
  return (
    <Popover anchor={anchor} onClose={onClose} placement="bottom-start" width={def.editorWidth ?? 280} className="db-cell-popover is-panel db-custom-editor" label={`Edit ${property.name}`}>
      <ViewFrame
        surface="popover"
        viewKey={`cell:${def.key}:${row.id}:${property.id}`}
        html={def.editor!}
        owner={def.owner}
        permissions={def.permissions}
        props={props}
        initialHeight={def.editorHeight ?? 120}
        minHeight={32}
        maxHeight={720}
        onData={db.locked ? undefined : (value) => db.setValue(row.id, property.id, value === null ? undefined : value)}
        onClose={(value) => {
          if (value !== undefined && value !== null && !db.locked) db.setValue(row.id, property.id, value);
          onClose();
        }}
        title={def.title}
      />
    </Popover>
  );
}
