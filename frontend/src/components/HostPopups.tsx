import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Search } from "lucide-react";
import { placePopup, popups, useOpenPopups } from "../lib/popups";
import type { MenuRequest, ModalRequest, OpenPopup, PopoverRequest, PopupMenuItem, PopupPlacement, PopupRect } from "../lib/popups";
import { Modal } from "./Modal";
import { IconGlyph, PageIcon, resolveIconName } from "./PageIcon";
import { ViewFrame } from "./ViewFrame";

/** Renders every menu, modal view and popover opened through lib/popups. Mounted once in App. */
export function HostPopups() {
  const open = useOpenPopups();
  if (!open.length) return null;
  return (
    <>
      {open.map((popup, index) => {
        const top = index === open.length - 1;
        const request = popup.request;
        if (request.kind === "menu") return <PopupMenu key={popup.id} popup={popup} request={request} />;
        if (request.kind === "modal") return <ModalView key={popup.id} popup={popup} request={request} top={top} />;
        return <PopoverView key={popup.id} popup={popup} request={request} />;
      })}
    </>
  );
}

// ── menu ─────────────────────────────────────────────────────────────────────

function MenuIcon({ icon, reserve }: { icon?: string; reserve?: boolean }) {
  if (!icon) return reserve ? <span className="popup-menu-icon" aria-hidden="true" /> : null;
  if (resolveIconName(icon)) return <IconGlyph name={icon} size={14} className="popup-menu-icon" />;
  if (/^(https?:|data:image\/)/.test(icon)) return <img className="popup-menu-icon popup-menu-img" src={icon} alt="" />;
  return <PageIcon value={icon} size={14} className="popup-menu-icon" />;
}

function usePlacement(ref: React.RefObject<HTMLElement | null>, at: { x?: number; y?: number; anchor?: PopupRect; placement?: PopupPlacement }, deps: unknown[]) {
  const [style, setStyle] = useState<CSSProperties>({ left: -9999, top: -9999, visibility: "hidden" });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const place = () => {
      const rect = element.getBoundingClientRect();
      const { left, top } = placePopup({ width: rect.width, height: rect.height }, at);
      setStyle({ left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return style;
}

function selectable(item: PopupMenuItem) {
  return (item.type ?? "item") === "item" && !item.disabled;
}

function matchesFilter(item: PopupMenuItem, query: string): boolean {
  if (!query) return true;
  if (item.type === "separator" || item.type === "header") return false;
  const hay = `${item.label ?? ""} ${item.description ?? ""} ${item.hint ?? ""}`.toLowerCase();
  return hay.includes(query) || Boolean(item.children?.some((child) => matchesFilter(child, query)));
}

/** Flatten matching leaves for a filtered menu (submenus are opened inline). */
function filterItems(items: PopupMenuItem[], query: string): PopupMenuItem[] {
  if (!query) return items;
  const out: PopupMenuItem[] = [];
  for (const item of items) {
    if (item.children?.length) out.push(...filterItems(item.children, query));
    else if (matchesFilter(item, query)) out.push(item);
  }
  return out;
}

function PopupMenu({ popup, request }: { popup: OpenPopup; request: MenuRequest }) {
  const [items, setItems] = useState(request.items);
  useEffect(() => setItems(request.items), [request.items]);
  const choose = (item: PopupMenuItem) => {
    if (!selectable(item) || item.children?.length) return;
    if (item.run) {
      try {
        item.run();
      } catch (error) {
        console.error(error);
      }
    }
    if (item.keepOpen) {
      if (typeof item.checked === "boolean") {
        const flip = (list: PopupMenuItem[]): PopupMenuItem[] => list.map((entry) => (entry === item ? { ...entry, checked: !entry.checked } : entry.children ? { ...entry, children: flip(entry.children) } : entry));
        setItems((current) => flip(current));
      }
      return;
    }
    popups.close(popup.id, item.run ? null : (item.id ?? null));
  };
  const dismiss = () => popups.close(popup.id, null);

  // Close on outside pointer, scroll elsewhere, blur and Escape.
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(`[data-popup="${popup.id}"]`)) return;
      dismiss();
    };
    const onBlur = () => dismiss();
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popup.id]);

  return createPortal(
    <MenuPanel
      popupId={popup.id}
      items={items}
      at={request}
      width={request.width}
      filter={request.filter}
      className={request.className}
      onChoose={choose}
      onDismiss={dismiss}
      root
    />,
    document.body,
  );
}

interface MenuPanelProps {
  popupId: number;
  items: PopupMenuItem[];
  at: { x?: number; y?: number; anchor?: PopupRect; placement?: PopupPlacement };
  width?: number;
  filter?: boolean;
  className?: string;
  root?: boolean;
  onChoose: (item: PopupMenuItem) => void;
  onDismiss: () => void;
  /** Submenus: go back to the parent (ArrowLeft). */
  onBack?: () => void;
}

function MenuPanel({ popupId, items, at, width, filter, className, root, onChoose, onDismiss, onBack }: MenuPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; rect: PopupRect; focus: boolean } | null>(null);
  const shown = useMemo(() => filterItems(items, query.trim().toLowerCase()), [items, query]);
  // When some items have icons, the rest keep an empty slot so labels line up.
  const reserveIcon = useMemo(() => shown.some((item) => item.type !== "separator" && item.type !== "header" && item.icon), [shown]);
  const style = usePlacement(panel, at, [at.x, at.y, at.anchor?.x, at.anchor?.y, shown.length]);
  const hoverTimer = useRef<number | undefined>(undefined);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    // Focus the panel (or its filter) so keys work at once.
    const timer = setTimeout(() => {
      const input = panel.current?.querySelector<HTMLInputElement>(".popup-menu-filter input");
      if (input) input.focus();
      else panel.current?.focus({ preventScroll: true });
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => {
    if (active >= 0) buttons.current[active]?.focus({ preventScroll: false });
  }, [active]);

  const openSub = (index: number, focus: boolean) => {
    const button = buttons.current[index];
    if (!button) return;
    const rect = button.getBoundingClientRect();
    setSub({ index, rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }, focus });
  };

  const move = (delta: number) => {
    if (!shown.length) return;
    let next = active;
    for (let step = 0; step < shown.length; step++) {
      next = (next + delta + shown.length) % shown.length;
      if (selectable(shown[next])) break;
    }
    setActive(next);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const key = event.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      move(key === "ArrowDown" ? 1 : -1);
    } else if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (onBack) onBack();
      else onDismiss();
    } else if (key === "ArrowLeft" && onBack) {
      event.preventDefault();
      onBack();
    } else if ((key === "ArrowRight" || key === "Enter" || key === " ") && active >= 0) {
      const item = shown[active];
      if (!item) return;
      if (item.children?.length) {
        event.preventDefault();
        openSub(active, true);
      } else if (key !== "ArrowRight" && !(key === " " && (event.target as HTMLElement).tagName === "INPUT")) {
        event.preventDefault();
        onChoose(item);
      }
    } else if (key === "Enter" && filter && shown.length) {
      const first = shown.findIndex(selectable);
      if (first >= 0) {
        event.preventDefault();
        onChoose(shown[first]);
      }
    }
  };

  const subItem = sub ? shown[sub.index] : null;

  return (
    <>
      <div
        ref={panel}
        data-popup={popupId}
        role="menu"
        tabIndex={-1}
        className={`menu popup-menu${className ? ` ${className}` : ""}`}
        style={{ ...style, position: "fixed", width, zIndex: root ? 1200 : 1201 }}
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {filter ? (
          <label className="popup-menu-filter">
            <Search size={13} />
            <input
              value={query}
              placeholder="Filter…"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(-1);
                setSub(null);
              }}
            />
          </label>
        ) : null}
        <div className="popup-menu-items">
          {shown.length === 0 ? <div className="popup-menu-empty">{query ? "No matches" : "Nothing here"}</div> : null}
          {shown.map((item, index) => {
            const type = item.type ?? "item";
            if (type === "separator") return <div key={`s${index}`} className="menu-separator" role="separator" />;
            if (type === "header") {
              return (
                <div key={`h${index}`} className="popup-menu-header" role="presentation">
                  {item.label}
                </div>
              );
            }
            const hasChildren = Boolean(item.children?.length);
            return (
              <button
                key={`${item.id ?? item.label}-${index}`}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                role={typeof item.checked === "boolean" ? "menuitemcheckbox" : "menuitem"}
                aria-checked={typeof item.checked === "boolean" ? item.checked : undefined}
                aria-haspopup={hasChildren ? "menu" : undefined}
                aria-expanded={hasChildren ? sub?.index === index : undefined}
                disabled={item.disabled}
                className={`${item.danger ? "danger" : ""}${sub?.index === index ? " is-open" : ""}`}
                onMouseEnter={() => {
                  setActive(index);
                  window.clearTimeout(hoverTimer.current);
                  if (hasChildren) hoverTimer.current = window.setTimeout(() => openSub(index, false), 120);
                  else if (sub) hoverTimer.current = window.setTimeout(() => setSub(null), 180);
                }}
                onClick={() => (hasChildren ? openSub(index, true) : onChoose(item))}
              >
                {typeof item.checked === "boolean" ? <span className="popup-menu-checkslot">{item.checked ? <Check size={13} /> : null}</span> : null}
                <MenuIcon icon={item.icon} reserve={reserveIcon} />
                <span className="popup-menu-copy">
                  <span className="popup-menu-label">{item.label}</span>
                  {item.description ? <span className="popup-menu-description">{item.description}</span> : null}
                </span>
                {item.hint ? <span className="popup-menu-hint">{item.hint}</span> : null}
                {hasChildren ? <ChevronRight size={13} className="popup-menu-chevron" /> : null}
              </button>
            );
          })}
        </div>
      </div>
      {sub && subItem?.children?.length ? (
        <SubMenu
          key={sub.index}
          popupId={popupId}
          items={subItem.children}
          anchor={sub.rect}
          focus={sub.focus}
          onChoose={onChoose}
          onDismiss={onDismiss}
          onBack={() => {
            const index = sub.index;
            setSub(null);
            setActive(index);
            buttons.current[index]?.focus();
          }}
        />
      ) : null}
    </>
  );
}

function SubMenu({ popupId, items, anchor, focus, onChoose, onDismiss, onBack }: { popupId: number; items: PopupMenuItem[]; anchor: PopupRect; focus: boolean; onChoose: (item: PopupMenuItem) => void; onDismiss: () => void; onBack: () => void }) {
  // Hover-opened submenus keep focus in the parent; keyboard-opened ones take it.
  const keep = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    if (!focus) {
      const timer = setTimeout(() => keep.current?.focus({ preventScroll: true }), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [focus]);
  return <MenuPanel popupId={popupId} items={items} at={{ anchor, placement: "right-start" }} onChoose={onChoose} onDismiss={onDismiss} onBack={onBack} />;
}

// ── modal view ───────────────────────────────────────────────────────────────

function clampSize(value: number | undefined, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function ModalView({ popup, request, top }: { popup: OpenPopup; request: ModalRequest; top: boolean }) {
  const dismissible = request.dismissible !== false;
  const width = clampSize(request.width, 240, 1400);
  const height = clampSize(request.height, 80, 1200);
  const props = useMemo(() => ({ data: request.data ?? null }), [request.data]);
  return (
    <Modal
      open
      title={request.title || request.owner.name}
      subtitle={request.subtitle}
      onClose={() => {
        if (dismissible && top) popups.close(popup.id, null);
      }}
      width="large"
      bare={request.bare}
      className={`popup-modal${request.bare ? " is-bare" : ""}`}
      bodyClassName="popup-modal-body"
      style={{ maxWidth: width ? `min(${width}px, calc(100vw - 48px))` : undefined, width: width ? "100%" : undefined }}
    >
      <ViewFrame
        viewKey={`popup:${popup.id}`}
        html={request.html}
        owner={request.owner}
        permissions={request.permissions}
        props={props}
        surface="modal"
        fill={Boolean(height)}
        initialHeight={height ?? 120}
        maxHeight={Math.round(window.innerHeight * 0.8)}
        className={height ? "popup-view-fixed" : undefined}
        title={request.title || request.owner.name}
        onClose={(value) => popups.close(popup.id, value)}
        onData={(data) => popups.close(popup.id, data)}
      />
      {height ? <style>{`.popup-modal-body .popup-view-fixed{height:min(${height}px, 76vh)}`}</style> : null}
    </Modal>
  );
}

// ── popover view ─────────────────────────────────────────────────────────────

function PopoverView({ popup, request }: { popup: OpenPopup; request: PopoverRequest }) {
  const panel = useRef<HTMLDivElement>(null);
  const width = clampSize(request.width, 120, 900) ?? 300;
  const height = clampSize(request.height, 40, 900);
  const style = usePlacement(panel, request, [request.x, request.y, request.anchor?.x, request.anchor?.y]);
  const props = useMemo(() => ({ data: request.data ?? null }), [request.data]);
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.(`[data-popup="${popup.id}"]`)) return;
      popups.close(popup.id, null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      popups.close(popup.id, null);
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [popup.id]);
  return createPortal(
    <div ref={panel} data-popup={popup.id} className="popup-popover" role="dialog" aria-label={request.owner.name} style={{ ...style, width, height }}>
      <ViewFrame
        viewKey={`popup:${popup.id}`}
        html={request.html}
        owner={request.owner}
        permissions={request.permissions}
        props={props}
        surface="popover"
        fill={Boolean(height)}
        initialHeight={height ?? 60}
        maxHeight={Math.round(window.innerHeight * 0.7)}
        title={request.owner.name}
        onClose={(value) => popups.close(popup.id, value)}
        onData={(data) => popups.close(popup.id, data)}
      />
    </div>,
    document.body,
  );
}
