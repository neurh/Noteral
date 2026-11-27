import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useCustomizations } from "../lib/customizations";
import { devlog } from "../lib/devlog";
import { openMarkdownLink } from "../lib/links";
import { VIEW_PROTOCOL, currentTheme, themeTokens, viewHub, viewSrcdoc } from "../lib/viewFrame";
import type { MountedView, ViewSurface } from "../lib/viewFrame";
import { pluginRuntime } from "../plugins/runtime";
import { ApiError, callMethod, hasPermission } from "../sdk-host/host";
import { EVENTS } from "../sdk-host/spec";
import { useAppStore } from "../store";

export interface ViewOwner {
  kind: "plugin" | "layer" | "app";
  id: string;
  name: string;
}

/** What views made by the user (Home HTML widgets) may do without a plugin manifest. */
export const APP_VIEW_PERMISSIONS = [
  "editor.read",
  "pages.read",
  "databases.read",
  "navigation",
  "search.read",
  "workspaces.read",
  "ui.notify",
  "ui.modal",
] as const;

interface ViewFrameProps {
  /** Unique per mounted instance; messages from the owner can target it. */
  viewKey: string;
  html: string;
  owner: ViewOwner;
  permissions: readonly string[];
  /** Passed to the view as `noteral.props`; changes are posted without reloading. */
  props?: Record<string, unknown>;
  /** Fill the container's height instead of growing with the content. */
  fill?: boolean;
  /** Where the view is mounted; the kit adapts (e.g. the status bar is compact). */
  surface?: ViewSurface;
  initialHeight?: number;
  minHeight?: number;
  maxHeight?: number;
  /** The view called noteral.setData(data). */
  onData?: (data: unknown) => void;
  /** The view called noteral.post(name, payload) and isn't a plugin's (plugins get it in their worker). */
  onAction?: (name: string, payload: unknown) => void;
  /** The view called noteral.close(value) (modal and popover views). */
  onClose?: (value: unknown) => void;
  /** The content's natural width in px (status widgets report it, so "auto" width can fit them). */
  onContentWidth?: (width: number) => void;
  className?: string;
  title: string;
}

const MAX_MESSAGE = 4 * 1024 * 1024; // matches MESSAGE_LIMIT in plugins/runtime.ts

/** Methods whose x/y/anchor are positions inside the calling view. */
const POSITIONED = new Set(["ui.menu", "ui.popover", "ui.updatePopover"]);

function translateToWindow(params: Record<string, unknown>, frame: DOMRect) {
  // "self": next to the whole view (a status widget's frame, a sidebar card…).
  if (params.anchor === "self") {
    params.anchor = { x: frame.left, y: frame.top, width: frame.width, height: frame.height };
    return;
  }
  if (typeof params.x === "number") params.x = params.x + frame.left;
  if (typeof params.y === "number") params.y = params.y + frame.top;
  const anchor = params.anchor;
  if (isObject(anchor) && typeof anchor.x === "number" && typeof anchor.y === "number") {
    params.anchor = { ...anchor, x: anchor.x + frame.left, y: anchor.y + frame.top };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function ViewFrame({ viewKey, html, owner, permissions, props, fill, surface, initialHeight, minHeight = 0, maxHeight = 4000, onData, onAction, onClose, onContentWidth, className, title }: ViewFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(initialHeight ?? (fill ? 0 : 80));
  const [error, setError] = useState("");
  const theme = useAppStore((state) => state.resolvedTheme);
  const doc = useCustomizations();
  const latest = useRef({ props, permissions, owner, onData, onAction, onClose, onContentWidth, viewKey });
  latest.current = { props, permissions, owner, onData, onAction, onClose, onContentWidth, viewKey };

  // Rebuild the document only when the HTML changes; props travel by message.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcdoc = useMemo(() => viewSrcdoc({ html, props: props ?? {}, fill, surface }), [html, fill, surface]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const post = (message: Record<string, unknown>) => iframe.contentWindow?.postMessage({ __nv: VIEW_PROTOCOL, ...message }, "*");
    const logSource = owner.kind === "app" ? `view:${viewKey}` : `${owner.kind}:${owner.id}`;
    const view: MountedView = {
      key: viewKey,
      ownerKind: owner.kind,
      ownerId: owner.id,
      permissions,
      subscriptions: new Set(),
      post,
    };
    const remove = viewHub.add(view);

    const onMessage = async (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!isObject(data) || data.__nv !== VIEW_PROTOCOL) return;
      let size = 0;
      try {
        size = JSON.stringify(data).length;
      } catch {
        size = Infinity;
      }
      if (size > MAX_MESSAGE) {
        if (typeof data.id === "number") post({ type: "response", id: data.id, ok: false, error: "Message is larger than 4 MB." });
        return;
      }
      const current = latest.current;
      switch (data.type) {
        case "ready":
          setError("");
          return;
        case "resize":
          if (typeof data.width === "number" && Number.isFinite(data.width)) current.onContentWidth?.(Math.max(0, Math.round(data.width)));
          if (!fill && typeof data.height === "number") setHeight(Math.max(minHeight, Math.min(maxHeight, Math.round(data.height))));
          return;
        case "error": {
          const message = String(data.message ?? "error").slice(0, 400);
          devlog.add(logSource, "error", `[${title}] ${message}`);
          setError(message);
          return;
        }
        case "setData":
          current.onData?.(data.data);
          return;
        case "subscribe": {
          const name = String(data.event ?? "");
          const spec = EVENTS.find((item) => item.name === name);
          if (spec && hasPermission(current.permissions, spec.permission)) view.subscriptions.add(name);
          return;
        }
        case "post":
          if (current.owner.kind === "plugin") pluginRuntime.viewMessage(current.owner.id, { view: viewKey, name: String(data.name ?? ""), payload: data.payload ?? null });
          else current.onAction?.(String(data.name ?? ""), data.payload ?? null);
          return;
        case "close":
          current.onClose?.(data.value ?? null);
          return;
        case "open": {
          const target = String(data.target ?? "");
          const state = useAppStore.getState();
          if (state.pages.some((page) => page.id === target)) void state.selectPage(target);
          else openMarkdownLink(target);
          return;
        }
        case "call": {
          const id = data.id;
          const method = String(data.method ?? "");
          try {
            const params = isObject(data.params) ? { ...data.params } : {};
            // Popups opened from inside the frame give frame coordinates; make them window coordinates.
            if (POSITIONED.has(method)) translateToWindow(params, iframe.getBoundingClientRect());
            const result = await callMethod(method, params, {
              caller: "plugin",
              pluginId: current.owner.kind === "plugin" ? current.owner.id : `${current.owner.kind}:${current.owner.id}`,
              pluginName: current.owner.name,
              permissions: current.permissions,
              viewKey: current.viewKey,
            });
            post({ type: "response", id, ok: true, result });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            devlog.add(logSource, "warn", `[${title}] ${method}: ${message}`);
            post({ type: "response", id, ok: false, error: message, code: err instanceof ApiError ? err.code : "failed" });
          }
          return;
        }
        default:
          return;
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      remove();
    };
    // The view record is tied to the iframe document; rebuild it with the document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcdoc, viewKey, owner.kind, owner.id]);

  // Props changes without reloading.
  const propsJson = useMemo(() => {
    try {
      return JSON.stringify(props ?? {});
    } catch {
      return "{}";
    }
  }, [props]);
  const firstProps = useRef(true);
  useEffect(() => {
    if (firstProps.current) {
      firstProps.current = false;
      return;
    }
    iframeRef.current?.contentWindow?.postMessage({ __nv: VIEW_PROTOCOL, type: "props", props: JSON.parse(propsJson) }, "*");
  }, [propsJson]);

  // Theme and token changes.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      iframeRef.current?.contentWindow?.postMessage({ __nv: VIEW_PROTOCOL, type: "theme", tokens: themeTokens(), theme: currentTheme() }, "*");
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, doc]);

  return (
    <div className={`view-frame${fill ? " is-fill" : ""}${className ? ` ${className}` : ""}`} style={fill ? undefined : { height }}>
      {/* The frame's color-scheme must match the document's, or the browser paints an
          opaque canvas behind a transparent view. */}
      <iframe ref={iframeRef} title={title} sandbox="allow-scripts" srcDoc={srcdoc} style={{ colorScheme: theme === "dark" ? "dark" : "light" }} />
      {error ? (
        <div className="view-frame-error" role="status">
          <AlertTriangle size={12} />
          <span title={error}>{error}</span>
          <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => setError("")}>
            <X size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
