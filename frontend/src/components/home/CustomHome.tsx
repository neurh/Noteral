import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Move, Plus, SlidersHorizontal, Sparkles } from "lucide-react";
import {
  HOME_GRID_COLUMNS,
  HOME_ROW_PX,
  MAX_WIDGETS,
  MIN_WIDGET_W,
  clampBox,
  compactWidgets,
  findFreeSpot,
  layoutRows,
  newWidget,
  newWidgetId,
  readingOrder,
  resolveCollisions,
  type Box,
  type HomeCustomLayout,
  type HomeCustomPreset,
  type HomeCustomView,
  type HomeWidget,
  type HomeWidgetType,
} from "../../lib/home";
import { CustomInspector, type InspectorTab } from "./CustomInspector";
import { LIVE_WHILE_EDITING, WIDGET_ICONS, renderWidget, widgetLabel } from "./widgets";

const GAP_PX = { tight: 10, normal: 16, roomy: 24 } as const;
const HISTORY_LIMIT = 60;
const COALESCE_MS = 1000;
/** Below this canvas width the free layout reads as one column, in reading order. */
const STACK_BELOW = 600;
/** Empty rows kept under the last widget while editing, so there is room to drop. */
const EDIT_ROOM_ROWS = 24;
const DRAG_THRESHOLD = 4;
const EDGE_SCROLL = 56;

type Handle = "e" | "w" | "s" | "se" | "sw";
type GestureKind = "move" | Handle;

interface CustomHomeProps {
  view: HomeCustomView;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  onChange: (layout: HomeCustomLayout) => void;
  onRename: (name: string) => void;
  onDuplicateView: () => void;
  onDeleteView: () => void;
}

interface Gesture {
  id: string;
  kind: GestureKind;
  pointerId: number;
  /** Pointer position at the start, relative to the canvas. */
  startX: number;
  startY: number;
  /** Where inside the widget it was grabbed, px. */
  grabX: number;
  grabY: number;
  origin: Box;
  base: HomeWidget[];
  moved: boolean;
  clientX: number;
  clientY: number;
}

interface Draft {
  id: string;
  kind: GestureKind;
  widgets: HomeWidget[];
  box: Box;
  /** Free pixel position of a widget being moved, so it follows the pointer exactly. */
  px?: { left: number; top: number };
}

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

const INTERACTIVE = "input, textarea, select, button, a, label, [contenteditable='true'], [role='slider']";

/** Undo/redo for the layout, coalescing rapid edits of the same control. */
function useLayoutHistory(layout: HomeCustomLayout, onChange: (layout: HomeCustomLayout) => void) {
  const past = useRef<HomeCustomLayout[]>([]);
  const future = useRef<HomeCustomLayout[]>([]);
  const last = useRef<{ key?: string; at: number }>({ at: 0 });
  const current = useRef(layout);
  current.current = layout;
  const [, bump] = useState(0);

  const commit = useCallback(
    (next: HomeCustomLayout, key?: string) => {
      const now = Date.now();
      const coalesce = key !== undefined && last.current.key === key && now - last.current.at < COALESCE_MS;
      if (!coalesce) {
        past.current.push(current.current);
        if (past.current.length > HISTORY_LIMIT) past.current.shift();
      }
      future.current = [];
      last.current = { key, at: now };
      current.current = next;
      onChange(next);
      bump((n) => n + 1);
    },
    [onChange],
  );
  const step = useCallback(
    (from: { current: HomeCustomLayout[] }, to: { current: HomeCustomLayout[] }) => {
      const target = from.current.pop();
      if (!target) return;
      to.current.push(current.current);
      last.current = { at: 0 };
      current.current = target;
      onChange(target);
      bump((n) => n + 1);
    },
    [onChange],
  );
  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);
  return { commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, current };
}

function layoutOf(view: HomeCustomView): HomeCustomLayout {
  const { id: _id, name: _name, ...layout } = view;
  return layout;
}

function cloneWidget(source: HomeWidget): HomeWidget {
  const copy: HomeWidget = { ...structuredClone(source), id: newWidgetId() };
  if (copy.items) copy.items = copy.items.map((item) => ({ ...item, id: newWidgetId() }));
  if (copy.buttons) copy.buttons = copy.buttons.map((item) => ({ ...item, id: newWidgetId() }));
  if (copy.habits) copy.habits = copy.habits.map((item) => ({ ...item, id: newWidgetId() }));
  if (copy.goals) copy.goals = copy.goals.map((item) => ({ ...item, id: newWidgetId() }));
  return copy;
}

const sameBox = (a: Box, b: Box) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export function CustomHome({ view, editing, onEditingChange, onChange, onRename, onDuplicateView, onDeleteView }: CustomHomeProps) {
  const layout = useMemo(() => layoutOf(view), [view]);
  const history = useLayoutHistory(layout, onChange);
  const { commit } = history;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>("page");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [stacked, setStacked] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);

  const selected = layout.widgets.find((widget) => widget.id === selectedId);
  const latest = () => history.current.current;

  // Measure the canvas: narrow canvases stack widgets in reading order.
  useLayoutEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const measure = () => setStacked(el.clientWidth < STACK_BELOW);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editing) {
      setSelectedId(null);
      setDraft(null);
      gesture.current = null;
    }
  }, [editing]);
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selected, selectedId]);
  useEffect(() => {
    if (tab === "widget" && !selected) setTab("page");
  }, [selected, tab]);

  const setLayout = useCallback((patch: Partial<HomeCustomLayout>, key?: string) => commit({ ...latest(), ...patch }, key), [commit]); // eslint-disable-line react-hooks/exhaustive-deps
  const setWidgets = useCallback((widgets: HomeWidget[], key?: string) => commit({ ...latest(), widgets }, key), [commit]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchWidget = useCallback(
    (id: string, patch: Partial<HomeWidget>, key?: string) =>
      setWidgets(
        latest().widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
        key,
      ),
    [setWidgets], // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** Move or resize one widget; whatever it now covers slides down, nothing else moves. */
  const setBox = useCallback(
    (id: string, patch: Partial<Box>, key?: string) => {
      const widgets = latest().widgets;
      const current = widgets.find((w) => w.id === id);
      if (!current) return;
      const box = clampBox({ ...current, ...patch });
      if (sameBox(box, current)) return;
      setWidgets(resolveCollisions(widgets.map((w) => (w.id === id ? { ...w, ...box } : w)), id), key);
    },
    [setWidgets], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const focusSlot = (id: string, scroll = false) =>
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-widget-id="${id}"]`);
      el?.focus({ preventScroll: true });
      if (scroll) el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });

  const select = (id: string | null) => {
    setSelectedId(id);
    if (id) setTab("widget");
  };

  const addWidget = (type: HomeWidgetType) => {
    const widgets = latest().widgets;
    if (widgets.length >= MAX_WIDGETS) return;
    const seed = newWidget(type);
    const spot = findFreeSpot(widgets, seed.w, seed.h);
    const widget = { ...seed, ...spot };
    setWidgets([...widgets, widget]);
    select(widget.id);
    focusSlot(widget.id, true);
  };
  const duplicateWidget = (id: string) => {
    const widgets = latest().widgets;
    const source = widgets.find((w) => w.id === id);
    if (!source || widgets.length >= MAX_WIDGETS) return;
    const copy = cloneWidget(source);
    const spot = findFreeSpot(widgets, copy.w, copy.h, { x: source.x, y: source.y });
    setWidgets([...widgets, { ...copy, ...spot }]);
    select(copy.id);
    focusSlot(copy.id, true);
  };
  const removeWidget = (id: string) => {
    const widgets = latest().widgets;
    const order = readingOrder(widgets);
    const index = order.findIndex((w) => w.id === id);
    if (index < 0) return;
    setWidgets(widgets.filter((w) => w.id !== id));
    const rest = order.filter((w) => w.id !== id);
    const neighbour = rest[Math.min(index, rest.length - 1)];
    setSelectedId(neighbour?.id ?? null);
    if (!neighbour) setTab("add");
    if (neighbour) focusSlot(neighbour.id);
  };
  const fitWidget = (id: string) => {
    const slot = canvasRef.current?.querySelector<HTMLElement>(`[data-widget-id="${id}"]`);
    const card = slot?.querySelector<HTMLElement>(".hw, .hw-slot-placeholder, .hw-spacer");
    if (!slot || !card) return;
    const saved = [slot.style.height, card.style.height, card.style.maxHeight, card.style.overflow];
    slot.style.height = "auto";
    card.style.height = "auto";
    card.style.maxHeight = "none";
    card.style.overflow = "visible";
    const height = slot.getBoundingClientRect().height;
    [slot.style.height, card.style.height, card.style.maxHeight, card.style.overflow] = saved;
    setBox(id, { h: Math.ceil(height / HOME_ROW_PX) });
  };
  const applyPreset = (preset: HomeCustomPreset) => {
    commit(preset.build());
    setSelectedId(null);
  };

  // Pointer gestures -------------------------------------------------------

  const computeDraft = useCallback((g: Gesture): Draft | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const col = rect.width / HOME_GRID_COLUMNS;
    const px = g.clientX - rect.left;
    const py = g.clientY - rect.top;
    const o = g.origin;
    let box: Box;
    let free: Draft["px"];
    if (g.kind === "move") {
      const left = Math.max(0, Math.min(rect.width - o.w * col, px - g.grabX));
      const top = Math.max(0, py - g.grabY);
      free = { left, top };
      box = clampBox({ x: left / col, y: top / HOME_ROW_PX, w: o.w, h: o.h });
    } else {
      const dx = Math.round((px - g.startX) / col);
      const dy = Math.round((py - g.startY) / HOME_ROW_PX);
      let { x, w, h } = o;
      if (g.kind.includes("e")) w = Math.min(HOME_GRID_COLUMNS - o.x, o.w + dx);
      if (g.kind.includes("w")) {
        x = Math.max(0, Math.min(o.x + o.w - MIN_WIDGET_W, o.x + dx));
        w = o.w + (o.x - x);
      }
      if (g.kind.includes("s")) h = o.h + dy;
      box = clampBox({ x, y: o.y, w, h });
    }
    const widgets = resolveCollisions(
      g.base.map((w) => (w.id === g.id ? { ...w, ...box } : w)),
      g.id,
    );
    return { id: g.id, kind: g.kind, widgets, box, px: free };
  }, []);

  const tick = useCallback(() => {
    frame.current = 0;
    const g = gesture.current;
    if (!g || !g.moved) return;
    // Scroll the page when the pointer nears its top or bottom edge.
    const scroller = scrollRef.current;
    let again = false;
    if (scroller) {
      const rect = scroller.getBoundingClientRect();
      const up = g.clientY - rect.top;
      const down = rect.bottom - g.clientY;
      const speed = up < EDGE_SCROLL ? -(EDGE_SCROLL - up) / 3 : down < EDGE_SCROLL ? (EDGE_SCROLL - down) / 3 : 0;
      if (speed) {
        const before = scroller.scrollTop;
        scroller.scrollTop += speed;
        again = scroller.scrollTop !== before;
      }
    }
    const next = computeDraft(g);
    if (next) setDraft(next);
    if (again) frame.current = requestAnimationFrame(tick);
  }, [computeDraft]);

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  const finishGesture = useCallback(
    (cancel: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      document.documentElement.classList.remove("home-dragging");
      if (!g) return;
      if (g.moved && !cancel) {
        const result = computeDraft(g);
        const before = g.base.find((w) => w.id === g.id);
        if (result && before && !sameBox(result.box, before)) setWidgets(result.widgets);
      }
      setDraft(null);
    },
    [computeDraft, setWidgets],
  );

  useEffect(() => {
    if (!editing) return;
    const onMove = (event: PointerEvent) => {
      const g = gesture.current;
      if (!g || event.pointerId !== g.pointerId) return;
      g.clientX = event.clientX;
      g.clientY = event.clientY;
      if (!g.moved) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dist = Math.hypot(event.clientX - rect.left - g.startX, event.clientY - rect.top - g.startY);
        if (dist < DRAG_THRESHOLD) return;
        g.moved = true;
        document.documentElement.classList.add("home-dragging");
        window.getSelection()?.removeAllRanges();
      }
      schedule();
    };
    const onUp = (event: PointerEvent) => {
      if (gesture.current && event.pointerId === gesture.current.pointerId) finishGesture(event.type === "pointercancel");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      finishGesture(true);
    };
  }, [editing, schedule, finishGesture]);

  const startGesture = (event: ReactPointerEvent<HTMLElement>, widget: HomeWidget, kind: GestureKind) => {
    if (event.button !== 0 || stacked) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const col = rect.width / HOME_GRID_COLUMNS;
    const startX = event.clientX - rect.left;
    const startY = event.clientY - rect.top;
    gesture.current = {
      id: widget.id,
      kind,
      pointerId: event.pointerId,
      startX,
      startY,
      grabX: startX - widget.x * col,
      grabY: startY - widget.y * HOME_ROW_PX,
      origin: { x: widget.x, y: widget.y, w: widget.w, h: widget.h },
      base: latest().widgets,
      moved: kind !== "move",
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (kind !== "move") {
      document.documentElement.classList.add("home-dragging");
      schedule();
    }
  };

  const onSlotPointerDown = (event: ReactPointerEvent<HTMLDivElement>, widget: HomeWidget) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const handle = target.closest<HTMLElement>("[data-handle]");
    select(widget.id);
    if (handle) {
      event.preventDefault();
      event.stopPropagation();
      startGesture(event, widget, handle.dataset.handle as Handle);
      return;
    }
    // Inside live widgets (checklists, notes…) controls keep working; drag from the chip or the frame.
    if (!target.closest(".hw-slot-chip") && target.closest(INTERACTIVE) && event.currentTarget.contains(target.closest(INTERACTIVE))) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    startGesture(event, widget, "move");
  };

  // Keyboard ---------------------------------------------------------------

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        if (gesture.current) {
          event.preventDefault();
          finishGesture(true);
          return;
        }
        if (isTyping(event.target) && (event.target as HTMLElement).closest(".home-inspector")) {
          (event.target as HTMLElement).blur();
          return;
        }
        event.preventDefault();
        if (selectedId) setSelectedId(null);
        else onEditingChange(false);
        return;
      }
      if (isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      if (mod && key === "z" && !event.shiftKey) {
        event.preventDefault();
        history.undo();
      } else if (mod && ((key === "z" && event.shiftKey) || key === "y")) {
        event.preventDefault();
        history.redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, selectedId, onEditingChange, finishGesture, history.undo, history.redo]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSlotKey = (event: ReactKeyboardEvent<HTMLDivElement>, widget: HomeWidget) => {
    if (event.target !== event.currentTarget) return;
    const mod = event.ctrlKey || event.metaKey;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(widget.id);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeWidget(widget.id);
    } else if (mod && event.key.toLowerCase() === "d") {
      event.preventDefault();
      duplicateWidget(widget.id);
    } else if (arrows[event.key]) {
      event.preventDefault();
      const [dx, dy] = arrows[event.key];
      setSelectedId(widget.id);
      if (event.shiftKey) setBox(widget.id, { w: widget.w + dx, h: widget.h + dy * 2 }, `size:${widget.id}`);
      else setBox(widget.id, { x: widget.x + dx, y: widget.y + dy * 2 }, `move:${widget.id}`);
      focusSlot(widget.id, true);
    }
  };

  // Render -----------------------------------------------------------------

  const widgets = draft?.widgets ?? layout.widgets;
  const shown = stacked ? readingOrder(widgets) : widgets;
  const rows = layoutRows(widgets);
  const canvasHeight = (rows + (editing ? EDIT_ROOM_ROWS : 0)) * HOME_ROW_PX;

  const style = {
    "--hc-gap": `${GAP_PX[layout.gap]}px`,
    "--hw-radius": `${layout.radius}px`,
    "--hc-row": `${HOME_ROW_PX}px`,
    "--hc-cols": HOME_GRID_COLUMNS,
    ...(layout.accent ? { "--hc-accent": layout.accent } : {}),
  } as CSSProperties;

  const place = (widget: HomeWidget): CSSProperties => {
    const tint = widget.tint ? { "--hw-tint": widget.tint } : {};
    if (stacked) return { ...tint, height: widget.h * HOME_ROW_PX } as CSSProperties;
    if (draft?.id === widget.id && draft.px) {
      return { ...tint, left: draft.px.left, top: draft.px.top, width: `${(widget.w / HOME_GRID_COLUMNS) * 100}%`, height: widget.h * HOME_ROW_PX } as CSSProperties;
    }
    return {
      ...tint,
      left: `${(widget.x / HOME_GRID_COLUMNS) * 100}%`,
      top: widget.y * HOME_ROW_PX,
      width: `${(widget.w / HOME_GRID_COLUMNS) * 100}%`,
      height: widget.h * HOME_ROW_PX,
    } as CSSProperties;
  };

  const ctxFor = (widget: HomeWidget) => ({
    layoutTitle: layout.title,
    editing,
    onPatch: (patch: Partial<HomeWidget>) => patchWidget(widget.id, patch, `content:${widget.id}`),
  });

  const empty = !layout.widgets.length;

  const canvas = (
    <div
      className={`home-custom ${editing ? "editing" : ""} ${draft ? `dragging drag-${draft.kind === "move" ? "move" : "resize"}` : ""} ${stacked ? "stacked" : ""}`}
      style={style}
      data-width={layout.width}
      data-cards={layout.cards}
      data-shadow={layout.shadow}
      data-font={layout.font}
      data-valign={layout.valign}
      data-accent={layout.accent ? "custom" : undefined}
      onPointerDown={(event) => {
        if (editing && (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains("hc-canvas"))) setSelectedId(null);
      }}
    >
      <div className="hc-canvas" ref={canvasRef} style={stacked || empty ? undefined : { height: canvasHeight }} hidden={empty}>
        {editing && draft && !stacked ? (
          <div
            className="hc-drop"
            aria-hidden="true"
            style={{
              left: `${(draft.box.x / HOME_GRID_COLUMNS) * 100}%`,
              top: draft.box.y * HOME_ROW_PX,
              width: `${(draft.box.w / HOME_GRID_COLUMNS) * 100}%`,
              height: draft.box.h * HOME_ROW_PX,
            }}
          />
        ) : null}
        {shown.map((widget) => {
          const body = renderWidget(widget, ctxFor(widget));
          const common = {
            "data-type": widget.type,
            "data-card": widget.style ?? layout.cards,
            "data-tinted": widget.tint ? "" : undefined,
            style: place(widget),
          };
          if (!editing) {
            return (
              <div key={widget.id} className="hc-slot" {...common}>
                {body}
              </div>
            );
          }
          const live = LIVE_WHILE_EDITING.has(widget.type);
          const Icon = WIDGET_ICONS[widget.type];
          const isSelected = selectedId === widget.id;
          const active = draft?.id === widget.id;
          return (
            <div
              key={widget.id}
              data-widget-id={widget.id}
              className={`hc-slot editable ${isSelected ? "selected" : ""} ${active ? `lifted ${draft.kind === "move" ? "moving" : "sizing"}` : ""}`}
              {...common}
              tabIndex={0}
              role="group"
              aria-label={`${widgetLabel(widget)}, ${widget.w} by ${widget.h}. Arrow keys move, Shift+arrows resize, Delete removes.`}
              onPointerDown={(event) => onSlotPointerDown(event, widget)}
              onKeyDown={(event) => onSlotKey(event, widget)}
            >
              <div className="hw-slot-body" inert={!live || undefined}>
                {body ?? <div className="hw-slot-placeholder">Empty {widgetLabel(widget).toLowerCase()}</div>}
              </div>
              <div className="hw-slot-chip">
                <Move size={12} aria-hidden="true" />
                <Icon size={12} aria-hidden="true" />
                <span className="hw-slot-name">{widgetLabel(widget)}</span>
                <span className="hw-slot-span">
                  {(active ? draft.box.w : widget.w)}×{(active ? draft.box.h : widget.h)}
                </span>
              </div>
              {!stacked
                ? (["e", "w", "s", "se", "sw"] as Handle[]).map((handle) => <span key={handle} className={`hc-handle h-${handle}`} data-handle={handle} aria-hidden="true" />)
                : null}
            </div>
          );
        })}
        {editing && !stacked && layout.widgets.length < MAX_WIDGETS ? (
          <button type="button" className="home-add-tile" onClick={() => setTab("add")} style={{ top: rows * HOME_ROW_PX }}>
            <Plus size={15} aria-hidden="true" /> Add widget
          </button>
        ) : null}
      </div>
      {editing && stacked && !empty && layout.widgets.length < MAX_WIDGETS ? (
        <button type="button" className="home-add-tile stacked" onClick={() => setTab("add")}>
          <Plus size={15} aria-hidden="true" /> Add widget
        </button>
      ) : null}
      {empty ? (
        <div className="home-custom-empty">
          <Sparkles size={22} aria-hidden="true" />
          <h2>{view.name || "An empty Home"}</h2>
          <p>{editing ? "Add widgets from the panel, or start from a layout." : "This view has no widgets yet. Add clocks, lists, buttons, notes and more."}</p>
          {editing ? (
            <button type="button" className="primary-button" onClick={() => setTab("add")}>
              <Plus size={14} aria-hidden="true" /> Add a widget
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={() => onEditingChange(true)}>
              <SlidersHorizontal size={14} aria-hidden="true" /> Customize
            </button>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <div className={`home-custom-shell ${editing ? "editing" : ""}`}>
      <div className="home-custom-frame">
        <div className="home-scroll" ref={scrollRef}>
          {canvas}
        </div>
        {editing ? (
          <CustomInspector
            layout={layout}
            viewName={view.name}
            tab={tab}
            selected={selected}
            stacked={stacked}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onTab={setTab}
            onLayout={setLayout}
            onWidget={patchWidget}
            onBox={setBox}
            onFit={fitWidget}
            onAdd={addWidget}
            onDuplicate={duplicateWidget}
            onRemove={removeWidget}
            onPreset={applyPreset}
            onTidy={() => setWidgets(compactWidgets(latest().widgets))}
            onClear={() => {
              setWidgets([]);
              setSelectedId(null);
              setTab("add");
            }}
            onRename={onRename}
            onDuplicateView={onDuplicateView}
            onDeleteView={onDeleteView}
            onUndo={history.undo}
            onRedo={history.redo}
            onDone={() => onEditingChange(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
