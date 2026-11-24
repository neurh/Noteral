import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  LayoutGrid,
  Palette,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_ASCII_VEIL,
  DEFAULT_CUSTOM_COLOR,
  DEFAULT_GRADIENT,
  HOME_BACKGROUNDS,
  HOME_BACKGROUND_GROUPS,
  HOME_BACKGROUND_INFO,
  HOME_TEMPLATES,
  HOME_TEMPLATE_INFO,
  gradientCss,
  isAsciiBackground,
  type HomeAsciiDensity,
  type HomeAsciiOptions,
  type HomeBackground,
  type HomeGradient,
  type HomeTabSettings,
  type HomeTemplate,
  MAX_CUSTOM_VIEWS,
  MAX_VIEW_NAME,
  type HomeCustomView,
} from "../../lib/home";
import { useAppStore } from "../../store";
import { LayoutSketch } from "./CustomInspector";
import { AsciiCanvas } from "./AsciiCanvas";
import { customBackgroundStyle } from "./HomeBackdrop";

type Panel = "root" | "view" | "background";

interface HomeMenuProps {
  anchor: HTMLElement | null;
  settings: HomeTabSettings;
  theme: "light" | "dark";
  /** Undefined when this Home cannot be customized (no tab id). */
  onChange?: (patch: Partial<HomeTabSettings>) => void;
  onCustomize?: () => void;
  /** Show a custom view in this tab and start editing it. */
  onEditView?: (viewId: string) => void;
  /** View key new Home tabs open with ("desk" when unset). */
  defaultView: string;
  onDefaultView: (viewKey: string | undefined) => void;
  onClose: () => void;
}

const COLOR_PRESETS = ["#f4efe6", "#e9e2d4", "#dfe7dc", "#dde6ec", "#ece0ef", "#f3dcd2", "#f6e7b8", "#2e3a33", "#26303f", "#3a2a33", "#1f1d1b", "#0f1720"];

const GRADIENT_PRESETS: HomeGradient[] = [
  { from: "#f6d5c4", to: "#c9d9e8", angle: 135, kind: "linear" },
  { from: "#fbe8c8", to: "#f2c6c2", angle: 160, kind: "linear" },
  { from: "#d9ecd2", to: "#a9cfc6", angle: 120, kind: "linear" },
  { from: "#e8e4f6", to: "#c3d6f2", angle: 200, kind: "radial" },
  { from: "#28324a", to: "#0f141f", angle: 180, kind: "linear" },
  { from: "#3b2a4a", to: "#152a38", angle: 135, kind: "radial" },
];

/** Coalesces rapid input events (color drags) into at most one update per frame. */
function useFrameCoalesced<T>(apply: (value: T) => void) {
  const pending = useRef<{ value: T } | null>(null);
  const frame = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return useCallback((value: T) => {
    pending.current = { value };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const next = pending.current;
      pending.current = null;
      if (next) applyRef.current(next.value);
    });
  }, []);
}

export function HomeMenu({ anchor, settings, theme, onChange, onCustomize, onEditView, defaultView, onDefaultView, onClose }: HomeMenuProps) {
  const [panel, setPanel] = useState<Panel>("root");
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const menuRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<Panel | null>(null);

  // Fixed positioning under the trigger, kept inside the window.
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const gutter = 10;
      const width = Math.min(392, window.innerWidth - gutter * 2);
      const left = Math.max(gutter, Math.min(rect.right - width, window.innerWidth - width - gutter));
      const top = rect.bottom + 6;
      setPosition({ top, left, width, maxHeight: Math.max(240, window.innerHeight - top - gutter) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [anchor]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape inside a rename field cancels the rename, not the menu.
      if ((event.target as HTMLElement | null)?.closest?.(".home-view-rename")) return;
      event.preventDefault();
      event.stopPropagation();
      if (panel !== "root") setPanel("root");
      else {
        onClose();
        anchor?.querySelector("button")?.focus();
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [anchor, onClose, panel]);

  // Move focus into each panel as it opens; returning to the root focuses the
  // row that opened the sub-panel.
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    if (panel === "root" && returnTo.current) {
      menu.querySelector<HTMLElement>(`[data-panel-link="${returnTo.current}"]`)?.focus();
      returnTo.current = null;
      return;
    }
    const selected = menu.querySelector<HTMLElement>(".home-menu-body [aria-checked='true']");
    (selected ?? menu.querySelector<HTMLElement>(".home-menu-body button:not(:disabled)"))?.focus({ preventScroll: false });
    bodyRef.current?.scrollTo({ top: 0 });
  }, [panel]);

  const open = (next: Panel) => {
    returnTo.current = null;
    setPanel(next);
  };
  const back = () => {
    returnTo.current = panel;
    setPanel("root");
  };

  const title = panel === "view" ? "View" : panel === "background" ? "Background" : "Home options";

  return createPortal(
    <div ref={menuRef} className={`home-menu panel-${panel}`} role="dialog" aria-label={title} style={position}>
      <div className="home-menu-head">
        {panel !== "root" ? (
          <button type="button" className="icon-button" onClick={back} aria-label="Back to Home options" title="Back">
            <ArrowLeft size={15} />
          </button>
        ) : (
          <span className="home-menu-head-spacer" aria-hidden="true" />
        )}
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)">
          <X size={15} />
        </button>
      </div>
      <div className="home-menu-body" ref={bodyRef} key={panel}>
        {panel === "root" ? (
          <RootPanel settings={settings} canCustomize={Boolean(onChange)} onOpen={open} onCustomize={onCustomize} />
        ) : null}
        {panel === "view" ? (
          <ViewPanel
            settings={settings}
            onPick={(template) => onChange?.({ template })}
            onPickView={(view) => onChange?.({ template: "custom", view })}
            onEditView={onEditView}
            defaultView={defaultView}
            onDefaultView={onDefaultView}
          />
        ) : null}
        {panel === "background" ? <BackgroundPanel settings={settings} theme={theme} onChange={onChange} /> : null}
      </div>
    </div>,
    document.body,
  );
}

function RootPanel({
  settings,
  canCustomize,
  onOpen,
  onCustomize,
}: {
  settings: HomeTabSettings;
  canCustomize: boolean;
  onOpen: (panel: Panel) => void;
  onCustomize?: () => void;
}) {
  const bg = settings.background;
  const views = useAppStore((state) => state.homeViews);
  const viewName = settings.template === "custom" ? views.find((view) => view.id === settings.view)?.name : undefined;
  return (
    <div className="home-menu-root">
      <button type="button" className="home-menu-row" data-panel-link="view" disabled={!canCustomize} onClick={() => onOpen("view")}>
        <span className="home-menu-row-thumb view" aria-hidden="true">
          <ViewWireframe view={settings.template} />
        </span>
        <span className="home-menu-row-text">
          <strong>View</strong>
          <span>{viewName ?? HOME_TEMPLATE_INFO[settings.template].label}</span>
        </span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <button type="button" className="home-menu-row" data-panel-link="background" disabled={!canCustomize} onClick={() => onOpen("background")}>
        <span className="home-menu-row-thumb" aria-hidden="true">
          <BackgroundSwatch background={bg} settings={settings} />
        </span>
        <span className="home-menu-row-text">
          <strong>Background</strong>
          <span>{HOME_BACKGROUND_INFO[bg].label}</span>
        </span>
        <ChevronRight size={15} aria-hidden="true" />
      </button>
      <div className="menu-separator" />
      <button type="button" className="home-menu-action" disabled={!canCustomize || !onCustomize} onClick={onCustomize}>
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span>{settings.template === "custom" ? "Edit this view" : "Build a custom view"}</span>
      </button>
      <p className="home-menu-note">Each view keeps its own background.</p>
    </div>
  );
}

function ViewPanel({
  settings,
  onPick,
  onPickView,
  onEditView,
  defaultView,
  onDefaultView,
}: {
  settings: HomeTabSettings;
  onPick: (view: HomeTemplate) => void;
  onPickView: (viewId: string) => void;
  onEditView?: (viewId: string) => void;
  defaultView: string;
  onDefaultView: (viewKey: string | undefined) => void;
}) {
  const views = useAppStore((state) => state.homeViews);
  const createHomeView = useAppStore((state) => state.createHomeView);
  const duplicateHomeView = useAppStore((state) => state.duplicateHomeView);
  const removeHomeView = useAppStore((state) => state.removeHomeView);
  const current = settings.template;
  const builtIn = HOME_TEMPLATES.filter((view) => view !== "custom");
  const currentKey = current === "custom" ? (settings.view ?? "") : current;
  const known = (builtIn as string[]).includes(defaultView) || views.some((view) => view.id === defaultView);
  const defaultKey = known ? defaultView : "desk";
  return (
    <>
      <div className="home-default-view">
        <div className="home-default-copy">
          <strong>New Home tabs open</strong>
          <span>Pick the view a new tab starts with.</span>
        </div>
        <label className="home-default-select">
          <span className="sr-only">Default view for new Home tabs</span>
          <select value={defaultKey} onChange={(event) => onDefaultView(event.target.value === "desk" ? undefined : event.target.value)}>
            <optgroup label="Built-in">
              {builtIn.map((view) => (
                <option key={view} value={view}>
                  {HOME_TEMPLATE_INFO[view].label}
                </option>
              ))}
            </optgroup>
            {views.length ? (
              <optgroup label="Your views">
                {views.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <ChevronDown size={13} aria-hidden="true" />
        </label>
        {currentKey && currentKey !== defaultKey ? (
          <button type="button" className="home-default-use" onClick={() => onDefaultView(currentKey === "desk" ? undefined : currentKey)}>
            Use this view
          </button>
        ) : null}
      </div>
      <div className="home-view-cards" role="radiogroup" aria-label="Home view">
        {builtIn.map((view) => {
          const selected = view === current;
          const info = HOME_TEMPLATE_INFO[view];
          return (
            <button
              key={view}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`home-pick-card ${selected ? "selected" : ""}`}
              onClick={() => onPick(view)}
            >
              <span className={`home-view-thumb view-${view}`} aria-hidden="true">
                <ViewWireframe view={view} />
                {selected ? (
                  <span className="home-pick-check">
                    <Check size={11} strokeWidth={3} />
                  </span>
                ) : null}
              </span>
              <span className="home-pick-label">
                {info.label}
                {view === defaultKey ? <span className="home-default-badge">Default</span> : null}
              </span>
              <span className="home-pick-desc">{info.description}</span>
            </button>
          );
        })}
      </div>
      <div className="home-menu-section-head">
        <h3>
          <LayoutGrid size={13} aria-hidden="true" /> Your views
        </h3>
        <span>
          {views.length} / {MAX_CUSTOM_VIEWS}
        </span>
      </div>
      <div className="home-view-cards custom" role="radiogroup" aria-label="Your custom views">
        {views.map((view) => (
          <CustomViewCard
            key={view.id}
            view={view}
            selected={current === "custom" && settings.view === view.id}
            isDefault={view.id === defaultKey}
            canDuplicate={views.length < MAX_CUSTOM_VIEWS}
            onPick={() => onPickView(view.id)}
            onEdit={onEditView ? () => onEditView(view.id) : undefined}
            onDuplicate={() => {
              const id = duplicateHomeView(view.id);
              if (id) onPickView(id);
            }}
            onDelete={() => removeHomeView(view.id)}
          />
        ))}
        {views.length < MAX_CUSTOM_VIEWS ? (
          <button
            type="button"
            className="home-pick-card home-view-new"
            onClick={() => {
              const id = createHomeView();
              if (onEditView) onEditView(id);
              else onPickView(id);
            }}
          >
            <span className="home-view-thumb new" aria-hidden="true">
              <Plus size={18} />
            </span>
            <span className="home-pick-label">New view</span>
            <span className="home-pick-desc">Start from a layout, then add, move and resize widgets.</span>
          </button>
        ) : null}
      </div>
      <p className="home-menu-note">Your views are shared by every Home tab. Changes to one show wherever it is open.</p>
    </>
  );
}

function CustomViewCard({
  view,
  selected,
  isDefault,
  canDuplicate,
  onPick,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  view: HomeCustomView;
  selected: boolean;
  isDefault: boolean;
  canDuplicate: boolean;
  onPick: () => void;
  onEdit?: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const updateHomeView = useAppStore((state) => state.updateHomeView);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(view.name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      setName(view.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [renaming]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 3200);
    return () => window.clearTimeout(timer);
  }, [confirming]);
  const commitName = () => {
    const next = name.trim();
    if (next && next !== view.name) updateHomeView(view.id, { name: next });
    setRenaming(false);
  };
  const count = view.widgets.length;
  return (
    <div className={`home-pick-card home-view-card ${selected ? "selected" : ""} ${confirming ? "confirming" : ""}`}>
      <button type="button" role="radio" aria-checked={selected} className="home-view-pick" onClick={onPick} onDoubleClick={onEdit} aria-label={`${view.name}, ${count} widgets`}>
        <span className="home-view-thumb view-custom" aria-hidden="true">
          <LayoutSketch layout={view} className="thumb" />
          {selected ? (
            <span className="home-pick-check">
              <Check size={11} strokeWidth={3} />
            </span>
          ) : null}
        </span>
      </button>
      {renaming ? (
        <form
          className="home-view-rename"
          onSubmit={(event) => {
            event.preventDefault();
            commitName();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={name}
            maxLength={MAX_VIEW_NAME}
            aria-label="View name"
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setRenaming(false);
              }
            }}
          />
        </form>
      ) : (
        <span className="home-pick-label">
          <span className="home-view-name">{view.name}</span>
          {isDefault ? <span className="home-default-badge">Default</span> : null}
        </span>
      )}
      <span className="home-pick-desc">{count ? `${count} widget${count === 1 ? "" : "s"}` : "Empty"}</span>
      <span className="home-viewcard-tools">
        {confirming ? (
          <>
            <button type="button" className="danger" onClick={onDelete} title="Delete this view">
              Delete
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <>
            {onEdit ? (
              <button type="button" onClick={onEdit} aria-label={`Edit ${view.name}`} title="Edit widgets">
                <SlidersHorizontal size={13} />
              </button>
            ) : null}
            <button type="button" onClick={() => setRenaming(true)} aria-label={`Rename ${view.name}`} title="Rename">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={onDuplicate} disabled={!canDuplicate} aria-label={`Duplicate ${view.name}`} title="Duplicate">
              <Copy size={13} />
            </button>
            <button type="button" className="danger" onClick={() => setConfirming(true)} aria-label={`Delete ${view.name}`} title="Delete">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </span>
    </div>
  );
}

function BackgroundPanel({
  settings,
  theme,
  onChange,
}: {
  settings: HomeTabSettings;
  theme: "light" | "dark";
  onChange?: (patch: Partial<HomeTabSettings>) => void;
}) {
  const [hovered, setHovered] = useState<HomeBackground | null>(null);
  const current = settings.background;

  const pick = (background: HomeBackground) => {
    if (!onChange) return;
    if (background === "custom-color") onChange({ background, color: settings.color ?? DEFAULT_CUSTOM_COLOR });
    else if (background === "custom-gradient") onChange({ background, gradient: settings.gradient ?? DEFAULT_GRADIENT });
    else onChange({ background });
  };

  return (
    <div className="home-bg-panel">
      {HOME_BACKGROUND_GROUPS.map((group) => {
        const items = HOME_BACKGROUNDS.filter((bg) => HOME_BACKGROUND_INFO[bg].group === group.id);
        return (
          <section key={group.id} className={`home-bg-group group-${group.id}`} aria-label={group.label}>
            <div className="home-bg-group-head">
              <h3>{group.label}</h3>
              {group.hint ? <span>{group.hint}</span> : null}
            </div>
            <div className={`home-bg-cards ${group.id === "custom" ? "two" : WALLPAPER_GROUPS.has(group.id) ? "wall" : ""}`} role="radiogroup" aria-label={`${group.label} backgrounds`}>
              {items.map((bg) => {
                const selected = bg === current;
                const ascii = isAsciiBackground(bg);
                return (
                  <button
                    key={bg}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={`home-pick-card bg ${selected ? "selected" : ""}`}
                    onClick={() => pick(bg)}
                    onPointerEnter={ascii ? () => setHovered(bg) : undefined}
                    onPointerLeave={ascii ? () => setHovered((value) => (value === bg ? null : value)) : undefined}
                    onFocus={ascii ? () => setHovered(bg) : undefined}
                    onBlur={ascii ? () => setHovered((value) => (value === bg ? null : value)) : undefined}
                  >
                    <span className="home-bg-thumb" aria-hidden="true">
                      {ascii ? (
                        <span className="home-bg" data-bg={bg}>
                          <AsciiCanvas
                            className="home-bg-canvas"
                            scene={bg}
                            speed={selected ? (settings.ascii?.speed ?? 1) : 1}
                            ink={selected ? settings.ascii?.ink : undefined}
                            playing={hovered === bg}
                            fontSize={6}
                            maxFps={24}
                          />
                        </span>
                      ) : (
                        <BackgroundSwatch background={bg} settings={settings} />
                      )}
                      {selected ? (
                        <span className="home-pick-check">
                          <Check size={11} strokeWidth={3} />
                        </span>
                      ) : null}
                    </span>
                    <span className="home-pick-label">
                      {bg === "custom-color" ? <Palette size={12} aria-hidden="true" /> : null}
                      {HOME_BACKGROUND_INFO[bg].label}
                    </span>
                    {ascii ? <span className="home-pick-sub">{HOME_BACKGROUND_INFO[bg].description}</span> : null}
                  </button>
                );
              })}
            </div>
            {isAsciiBackground(current) && HOME_BACKGROUND_INFO[current].group === group.id && onChange ? <AsciiTuner settings={settings} onChange={onChange} /> : null}
            {group.id === "custom" && current === "custom-color" && onChange ? <ColorEditor color={settings.color ?? DEFAULT_CUSTOM_COLOR} onChange={onChange} /> : null}
            {group.id === "custom" && current === "custom-gradient" && onChange ? (
              <GradientEditor gradient={settings.gradient ?? DEFAULT_GRADIENT} onChange={onChange} />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function BackgroundSwatch({ background, settings }: { background: HomeBackground; settings: HomeTabSettings }) {
  if (background === "custom-color") return <span className="home-bg" data-bg="custom-color" style={{ background: settings.color ?? DEFAULT_CUSTOM_COLOR }} />;
  if (background === "custom-gradient") {
    const g = settings.gradient ?? DEFAULT_GRADIENT;
    return <span className="home-bg" data-bg="custom-gradient" style={customBackgroundStyle({ background, gradient: g })} />;
  }
  if (isAsciiBackground(background)) {
    return (
      <span className="home-bg" data-bg={background}>
        <AsciiCanvas className="home-bg-canvas" scene={background} ink={settings.ascii?.ink} playing={false} fontSize={5} maxFps={1} />
      </span>
    );
  }
  return <span className="home-bg" data-bg={background} />;
}

function EditorBlock({ title, children, onReset }: { title: string; children: ReactNode; onReset?: () => void }) {
  return (
    <div className="home-bg-editor">
      <div className="home-bg-editor-head">
        <span>{title}</span>
        {onReset ? (
          <button type="button" className="home-text-button" onClick={onReset}>
            <RotateCcw size={11} aria-hidden="true" /> Reset
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="home-color-field">
      <span className="home-color-well" style={{ background: value }}>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} color`} />
      </span>
      <span className="home-color-copy">
        <span>{label}</span>
        <input
          type="text"
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label} hex value`}
          onChange={(event) => {
            const next = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
            setText(next);
            if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase());
          }}
          onBlur={() => setText(value)}
        />
      </span>
    </label>
  );
}

function ColorEditor({ color, onChange }: { color: string; onChange: (patch: Partial<HomeTabSettings>) => void }) {
  const update = useFrameCoalesced((value: string) => onChange({ background: "custom-color", color: value }));
  return (
    <EditorBlock title="Your color" onReset={() => onChange({ color: DEFAULT_CUSTOM_COLOR })}>
      <ColorField label="Color" value={color} onChange={update} />
      <div className="home-color-presets" role="group" aria-label="Color presets">
        {COLOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={preset === color ? "selected" : ""}
            style={{ background: preset }}
            onClick={() => onChange({ color: preset })}
            aria-label={`Use ${preset}`}
            title={preset}
          />
        ))}
      </div>
    </EditorBlock>
  );
}

function GradientEditor({ gradient, onChange }: { gradient: HomeGradient; onChange: (patch: Partial<HomeTabSettings>) => void }) {
  const update = useFrameCoalesced((patch: Partial<HomeGradient>) => onChange({ background: "custom-gradient", gradient: { ...gradient, ...patch } }));
  // `gradient` is read at flush time through a ref so a drag never applies a stale stop.
  const latest = useRef(gradient);
  latest.current = gradient;
  const set = (patch: Partial<HomeGradient>) => update(patch);
  return (
    <EditorBlock title="Your gradient" onReset={() => onChange({ gradient: DEFAULT_GRADIENT })}>
      <div className="home-gradient-preview" style={{ backgroundImage: gradientCss(gradient) }} />
      <div className="home-gradient-stops">
        <ColorField label="From" value={gradient.from} onChange={(from) => set({ from })} />
        <button
          type="button"
          className="icon-button"
          onClick={() => onChange({ gradient: { ...latest.current, from: latest.current.to, to: latest.current.from } })}
          aria-label="Swap colors"
          title="Swap colors"
        >
          <ArrowLeftRight size={14} />
        </button>
        <ColorField label="To" value={gradient.to} onChange={(to) => set({ to })} />
      </div>
      <div className="home-gradient-row">
        <div className="home-segmented small" role="radiogroup" aria-label="Gradient shape">
          {(["linear", "radial"] as const).map((kind) => (
            <button key={kind} type="button" role="radio" aria-checked={gradient.kind === kind} className={gradient.kind === kind ? "active" : ""} onClick={() => onChange({ gradient: { ...gradient, kind } })}>
              {kind === "linear" ? "Linear" : "Radial"}
            </button>
          ))}
        </div>
        <label className={`home-range ${gradient.kind === "radial" ? "disabled" : ""}`}>
          <span>Angle</span>
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={gradient.angle}
            disabled={gradient.kind === "radial"}
            onChange={(event) => set({ angle: Number(event.target.value) })}
          />
          <output>{gradient.angle}°</output>
        </label>
      </div>
      <div className="home-gradient-presets" role="group" aria-label="Gradient presets">
        {GRADIENT_PRESETS.map((preset, index) => (
          <button key={index} type="button" style={{ backgroundImage: gradientCss(preset) }} onClick={() => onChange({ gradient: preset })} aria-label={`Gradient preset ${index + 1}`} />
        ))}
      </div>
    </EditorBlock>
  );
}

/** Background groups shown as animated wallpaper cards. */
const WALLPAPER_GROUPS = new Set<string>(["ascii"]);

const ASCII_DENSITIES: { id: HomeAsciiDensity; label: string }[] = [
  { id: "fine", label: "Fine" },
  { id: "normal", label: "Normal" },
  { id: "large", label: "Large" },
];

function AsciiTuner({ settings, onChange }: { settings: HomeTabSettings; onChange: (patch: Partial<HomeTabSettings>) => void }) {
  const ascii: HomeAsciiOptions = settings.ascii ?? { speed: 1 };
  const veil = ascii.veil ?? DEFAULT_ASCII_VEIL;
  const set = (patch: Partial<HomeAsciiOptions>) => onChange({ ascii: { ...ascii, ...patch } });
  const update = useFrameCoalesced(set);
  const density = ascii.density ?? "normal";
  return (
    <EditorBlock title={`Tune ${HOME_BACKGROUND_INFO[settings.background].label}`} onReset={settings.ascii ? () => onChange({ ascii: undefined }) : undefined}>
      <div className="home-tune">
        <label className={`home-tune-row range ${ascii.still ? "disabled" : ""}`}>
          <span className="home-tune-label">Speed</span>
          <input type="range" min={0.25} max={3} step={0.25} value={ascii.speed} disabled={ascii.still} onChange={(event) => update({ speed: Number(event.target.value) })} />
          <output>{ascii.speed}×</output>
        </label>
        <label className="home-tune-row range">
          <span className="home-tune-label">Veil</span>
          <input type="range" min={0} max={0.8} step={0.05} value={veil} onChange={(event) => update({ veil: Number(event.target.value) })} />
          <output>{Math.round(veil * 100)}%</output>
        </label>
        <TuneChoice
          label="Detail"
          aria="Character size"
          value={density}
          options={ASCII_DENSITIES.map((d) => ({ id: d.id, label: d.label }))}
          onPick={(id) => set({ density: id === "normal" ? undefined : (id as HomeAsciiOptions["density"]) })}
        />
        <TuneChoice
          label="Motion"
          aria="Motion"
          value={ascii.still ? "still" : "animated"}
          options={[
            { id: "animated", label: "Animated" },
            { id: "still", label: "Still" },
          ]}
          onPick={(id) => set({ still: id === "still" ? true : undefined })}
        />
        <TuneChoice
          label="Cursor"
          aria="React to cursor"
          disabled={ascii.still}
          value={ascii.cursor === false ? "ignore" : "react"}
          options={[
            { id: "react", label: "React" },
            { id: "ignore", label: "Ignore" },
          ]}
          onPick={(id) => set({ cursor: id === "ignore" ? false : undefined })}
        />
        <TuneChoice
          label="Ink"
          aria="Ink color"
          value={ascii.ink ? "custom" : "scene"}
          options={[
            { id: "scene", label: "Scene" },
            { id: "custom", label: "Custom" },
          ]}
          onPick={(id) => set({ ink: id === "custom" ? (ascii.ink ?? "#e8b86a") : undefined })}
          extra={
            ascii.ink ? (
              <span className="home-color-well small" style={{ background: ascii.ink }}>
                <input type="color" value={ascii.ink} onChange={(event) => update({ ink: event.target.value })} aria-label="Ink color" />
              </span>
            ) : null
          }
        />
      </div>
    </EditorBlock>
  );
}

function TuneChoice({
  label,
  aria,
  value,
  options,
  onPick,
  disabled = false,
  extra,
}: {
  label: string;
  aria: string;
  value: string;
  options: { id: string; label: string }[];
  onPick: (id: string) => void;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className={`home-tune-row choice ${disabled ? "disabled" : ""} ${extra ? "with-extra" : ""}`}>
      <span className="home-tune-label">{label}</span>
      <div className="home-segmented small home-tune-seg" role="radiogroup" aria-label={aria}>
        {options.map((option) => {
          const active = option.id === value;
          return (
            <button key={option.id} type="button" role="radio" aria-checked={active} className={active ? "active" : ""} disabled={disabled} onClick={() => onPick(option.id)}>
              {option.label}
            </button>
          );
        })}
      </div>
      {extra}
    </div>
  );
}

/** Small schematic of each view, drawn with theme tokens. */
export function ViewWireframe({ view }: { view: HomeTemplate }) {
  return (
    <svg viewBox="0 0 120 76" className="home-wire" focusable="false">
      {WIREFRAMES[view]}
    </svg>
  );
}

const line = (x: number, y: number, w: number, cls = "w-line", h = 3) => <rect x={x} y={y} width={w} height={h} rx={h / 2} className={cls} />;
const box = (x: number, y: number, w: number, h: number, cls = "w-box") => <rect x={x} y={y} width={w} height={h} rx={3} className={cls} />;

const WIREFRAMES: Record<HomeTemplate, ReactNode> = {
  desk: (
    <>
      {line(12, 11, 46, "w-ink", 5)}
      {line(12, 20, 30)}
      {box(12, 28, 22, 9, "w-accent")}
      {box(37, 28, 22, 9)}
      {box(62, 28, 22, 9)}
      {box(12, 43, 46, 24)}
      {line(17, 49, 30)}
      {line(17, 55, 24)}
      {line(17, 61, 28)}
      {box(62, 43, 46, 24)}
      {line(67, 49, 26)}
      {line(67, 55, 32)}
      {line(67, 61, 22)}
    </>
  ),
  focus: (
    <>
      {line(38, 22, 44, "w-ink", 6)}
      {line(30, 33, 60)}
      {line(40, 39, 40)}
      {box(44, 48, 32, 10, "w-accent")}
      {line(48, 64, 24, "w-faint", 2)}
    </>
  ),
  dashboard: (
    <>
      {line(10, 9, 36, "w-ink", 4)}
      {box(10, 17, 22, 13)}
      {box(35, 17, 22, 13)}
      {box(60, 17, 22, 13)}
      {box(85, 17, 25, 13)}
      {line(14, 25, 8, "w-accent", 3)}
      {line(39, 25, 10, "w-accent", 3)}
      {line(64, 25, 6, "w-accent", 3)}
      {line(89, 25, 9, "w-accent", 3)}
      {box(10, 34, 100, 15)}
      {Array.from({ length: 22 }, (_, i) => (
        <rect key={i} x={14 + i * 4.2} y={38 + (i % 2) * 4} width={3} height={3} rx={0.8} className={i % 3 === 0 ? "w-accent" : i % 4 === 1 ? "w-line" : "w-faint"} />
      ))}
      {box(10, 53, 48, 16)}
      {line(14, 58, 30)}
      {line(14, 63, 22)}
      {box(62, 53, 48, 16)}
      {line(66, 58, 26)}
      {line(66, 63, 32)}
    </>
  ),
  gallery: (
    <>
      {[0, 1, 2].map((col) =>
        [0, 1].map((row) => (
          <g key={`${col}${row}`}>
            {box(10 + col * 34, 9 + row * 32, 30, 28)}
            <rect x={10 + col * 34} y={9 + row * 32} width={30} height={14} rx={3} className={(col + row) % 2 ? "w-cover-b" : "w-cover"} />
            {line(14 + col * 34, 27 + row * 32, 18)}
          </g>
        )),
      )}
    </>
  ),
  timeline: (
    <>
      <rect x={21} y={10} width={1.5} height={58} className="w-line" />
      {[12, 36, 56].map((y, i) => (
        <g key={y}>
          <circle cx={21.75} cy={y + 2} r={3} className={i === 0 ? "w-accent" : "w-ink"} />
          {line(30, y, 22, "w-ink", 3)}
          {line(30, y + 7, 64)}
          {i < 2 ? line(30, y + 13, 48) : null}
        </g>
      ))}
    </>
  ),
  index: (
    <>
      {box(10, 9, 100, 9)}
      {line(15, 12, 28, "w-faint", 3)}
      {["A", "B", "C"].map((_, i) => (
        <g key={i}>
          {line(10, 25 + i * 17, 6, "w-accent", 4)}
          {line(22, 25 + i * 17, 54)}
          {line(22, 31 + i * 17, 40)}
          {line(92, 25 + i * 17, 16, "w-faint", 3)}
        </g>
      ))}
    </>
  ),
  launchpad: (
    <>
      {line(42, 10, 36, "w-ink", 4)}
      {box(16, 19, 88, 12, "w-box strong")}
      {line(22, 24, 30, "w-faint", 3)}
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          {box(16 + i * 23, 39, 19, 18)}
          <rect x={20 + i * 23} y={43} width={6} height={6} rx={1.5} className={i === 0 ? "w-accent" : "w-line"} />
          {line(20 + i * 23, 51, 10, "w-line", 2)}
        </g>
      ))}
      {line(16, 64, 18, "w-faint", 4)}
      {line(37, 64, 22, "w-faint", 4)}
      {line(62, 64, 16, "w-faint", 4)}
    </>
  ),
  custom: (
    <>
      <rect x={10} y={9} width={48} height={26} rx={3} className="w-dash" />
      <rect x={62} y={9} width={48} height={26} rx={3} className="w-box" />
      {line(67, 15, 18, "w-ink", 4)}
      {line(67, 23, 30)}
      <rect x={10} y={39} width={30} height={28} rx={3} className="w-box" />
      {line(15, 45, 14, "w-accent", 4)}
      <rect x={44} y={39} width={66} height={28} rx={3} className="w-dash" />
      <path d="M34 18v8M30 22h8" className="w-plus" />
      <path d="M77 49v8M73 53h8" className="w-plus" />
    </>
  ),
};
