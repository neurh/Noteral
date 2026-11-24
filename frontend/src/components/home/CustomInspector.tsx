import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Eraser, LayoutDashboard, Minus, MoveVertical, Plus, Redo2, RotateCcw, Search, SlidersHorizontal, Trash2, Undo2, X } from "lucide-react";
import type { PageMeta } from "../../lib/api";
import {
  DEFAULT_RADIUS,
  HOME_CUSTOM_PRESETS,
  HOME_BUTTON_ACTIONS,
  HOME_BUTTON_ICONS,
  HOME_GRID_COLUMNS,
  HOME_ROW_PX,
  HOME_QUICK_ACTIONS,
  HOME_WIDGET_CATEGORIES,
  HOME_WIDGET_INFO,
  HOME_WIDGET_TYPES,
  HOME_WIDGET_VARIANTS,
  MAX_BUTTONS,
  MAX_GOALS,
  MAX_HABITS,
  MAX_PINNED_PAGES,
  MAX_VIEW_NAME,
  MAX_WIDGETS,
  MAX_WIDGET_H,
  MIN_WIDGET_H,
  MIN_WIDGET_W,
  newWidgetId,
  DEFAULT_QUICK_ACTIONS,
  isHexColor,
  type HomeCardStyle,
  type HomeCustomLayout,
  type HomeCustomPreset,
  type Box,
  type HomeButton,
  type HomeButtonAction,
  type HomeGoal,
  type HomeHabit,
  type HomeWidget,
  type HomeWidgetType,
  MAX_VIEW_CSS,
  MAX_WIDGET_CSS,
  MAX_WIDGET_HTML,
} from "../../lib/home";
import { useAppStore } from "../../store";
import { isOpenable } from "./data";
import { BUTTON_ACTION_LABELS, BUTTON_ICONS, PageGlyph, buttonLabel, QUICK_ACTION_INFO, WIDGET_ICONS, widgetLabel } from "./widgets";

export type InspectorTab = "page" | "add" | "widget";

export const ACCENT_SWATCHES = ["#b1533d", "#c2763a", "#a37a1f", "#3f7654", "#2f8f8a", "#3b6ea8", "#6a5acd", "#b0457a"];

const CARD_STYLES: { id: HomeCardStyle; label: string; hint: string }[] = [
  { id: "glass", label: "Glass", hint: "Soft, translucent" },
  { id: "solid", label: "Solid", hint: "Opaque paper" },
  { id: "outline", label: "Outline", hint: "Just a border" },
  { id: "flat", label: "Flat", hint: "No card" },
];

/** Width presets in lattice columns (of HOME_GRID_COLUMNS = 24). */
const QUICK_WIDTHS: { w: number; label: string }[] = [
  { w: 6, label: "¼" },
  { w: 8, label: "⅓" },
  { w: 12, label: "½" },
  { w: 16, label: "⅔" },
  { w: 18, label: "¾" },
  { w: 24, label: "Full" },
];

export interface InspectorProps {
  layout: HomeCustomLayout;
  viewName: string;
  tab: InspectorTab;
  selected?: HomeWidget;
  /** The canvas is too narrow for free placement and shows one column. */
  stacked: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onTab: (tab: InspectorTab) => void;
  onLayout: (patch: Partial<HomeCustomLayout>, key?: string) => void;
  onWidget: (id: string, patch: Partial<HomeWidget>, key?: string) => void;
  onBox: (id: string, box: Partial<Box>, key?: string) => void;
  onFit: (id: string) => void;
  onAdd: (type: HomeWidgetType) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onPreset: (preset: HomeCustomPreset) => void;
  onClear: () => void;
  onTidy: () => void;
  onRename: (name: string) => void;
  onDuplicateView: () => void;
  onDeleteView: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
}

export function CustomInspector(props: InspectorProps) {
  const { tab, selected, onTab } = props;
  const tabs: { id: InspectorTab; label: string; disabled?: boolean }[] = [
    { id: "page", label: "Page" },
    { id: "add", label: "Add" },
    { id: "widget", label: "Widget", disabled: !selected },
  ];
  return (
    <aside className="home-inspector" aria-label="Customize Home">
      <header className="hi-head">
        <div className="hi-title">
          <SlidersHorizontal size={14} aria-hidden="true" />
          <span>Customize</span>
        </div>
        <div className="hi-head-actions">
          <button type="button" className="icon-button" onClick={props.onUndo} disabled={!props.canUndo} aria-label="Undo" title="Undo (Ctrl+Z)">
            <Undo2 size={15} />
          </button>
          <button type="button" className="icon-button" onClick={props.onRedo} disabled={!props.canRedo} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
            <Redo2 size={15} />
          </button>
          <button type="button" className="primary-button hi-done" onClick={props.onDone}>
            <Check size={14} aria-hidden="true" /> Done
          </button>
        </div>
      </header>
      <div className="hi-tabs" role="tablist" aria-label="Customize sections">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : ""}
            disabled={item.disabled}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="hi-body" role="tabpanel">
        {tab === "page" ? <PagePanel {...props} /> : null}
        {tab === "add" ? <AddPanel {...props} /> : null}
        {tab === "widget" && selected ? <WidgetPanel {...props} widget={selected} /> : null}
        {tab === "widget" && !selected ? <p className="hi-hint">Select a widget on the page to change it.</p> : null}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Small controls

function Field({ label, hint, children, inline = false }: { label: string; hint?: ReactNode; children: ReactNode; inline?: boolean }) {
  return (
    <div className={`hi-field ${inline ? "inline" : ""}`}>
      <div className="hi-label">
        <span>{label}</span>
        {hint ? <span className="hi-label-hint">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="hi-section">
      <div className="hi-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="home-segmented small hi-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? "active" : ""} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="hi-toggle">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="hi-switch" aria-hidden="true" />
    </label>
  );
}

function Swatches({ value, onChange, label, allowDefault = "Theme" }: { value?: string; onChange: (value: string | undefined) => void; label: string; allowDefault?: string }) {
  const custom = value && !ACCENT_SWATCHES.includes(value) ? value : undefined;
  return (
    <div className="hi-swatches" role="radiogroup" aria-label={label}>
      <button type="button" role="radio" aria-checked={!value} className={`hi-swatch none ${!value ? "active" : ""}`} onClick={() => onChange(undefined)} title={allowDefault}>
        <span>{allowDefault}</span>
      </button>
      {ACCENT_SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          className={`hi-swatch ${value === color ? "active" : ""}`}
          style={{ background: color }}
          onClick={() => onChange(color)}
        />
      ))}
      <label className={`hi-swatch picker ${custom ? "active" : ""}`} style={custom ? { background: custom } : undefined} title="Custom color">
        <Plus size={12} aria-hidden="true" />
        <input type="color" value={value && isHexColor(value) ? value : "#7a6a58"} aria-label="Custom color" onChange={(event) => onChange(event.target.value)} />
      </label>
    </div>
  );
}

/** A mini map of a layout: every widget as a box at its real position. */
export function LayoutSketch({ layout, className = "" }: { layout: HomeCustomLayout; className?: string }) {
  const rows = Math.max(1, layout.widgets.reduce((max, w) => Math.max(max, w.y + w.h), 0));
  return (
    <span className={`hi-sketch ${className}`} aria-hidden="true">
      {layout.widgets.map((widget) => (
        <span
          key={widget.id}
          className={`hi-sketch-cell t-${widget.type}`}
          style={{
            left: `${(widget.x / HOME_GRID_COLUMNS) * 100}%`,
            width: `${(widget.w / HOME_GRID_COLUMNS) * 100}%`,
            top: `${(widget.y / rows) * 100}%`,
            height: `${(widget.h / rows) * 100}%`,
          }}
        />
      ))}
    </span>
  );
}

function Stepper({ value, min, max, step = 1, onChange, label, format }: { value: number; min: number; max: number; step?: number; onChange: (value: number) => void; label: string; format?: (value: number) => string }) {
  return (
    <div className="hi-stepper" role="group" aria-label={label}>
      <button type="button" className="icon-button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`}>
        <Minus size={14} />
      </button>
      <span>{format ? format(value) : value}</span>
      <button type="button" className="icon-button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
        <Plus size={14} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page

function PagePanel({ layout, viewName, onLayout, onPreset, onClear, onTidy, onRename, onDuplicateView, onDeleteView }: InspectorProps) {
  const presets = useMemo(() => HOME_CUSTOM_PRESETS.map((preset) => ({ preset, layout: preset.build() })), []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <>
      <Section title="View">
        <Field label="Name">
          <input
            type="text"
            className="hi-input"
            value={viewName}
            maxLength={MAX_VIEW_NAME}
            placeholder="Custom view"
            aria-label="View name"
            onChange={(event) => onRename(event.target.value)}
            onBlur={(event) => {
              if (!event.target.value.trim()) onRename("Custom view");
            }}
          />
        </Field>
        <div className="hi-row-actions">
          <button type="button" className="hi-ghost" onClick={onDuplicateView}>
            <Copy size={13} aria-hidden="true" /> Duplicate view
          </button>
          {confirmDelete ? (
            <>
              <button type="button" className="hi-ghost danger solid" onClick={onDeleteView} autoFocus>
                <Trash2 size={13} aria-hidden="true" /> Delete “{viewName}”
              </button>
              <button type="button" className="hi-ghost" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="hi-ghost danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} aria-hidden="true" /> Delete view
            </button>
          )}
        </div>
      </Section>

      <Section title="Start from">
        <div className="hi-presets">
          {presets.map(({ preset, layout: sample }) => (
            <button key={preset.id} type="button" className="hi-preset" onClick={() => onPreset(preset)} title={preset.description}>
              <LayoutSketch layout={sample} />
              <span className="hi-preset-label">{preset.label}</span>
              <span className="hi-preset-desc">{preset.description}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title="Layout">
        <Field label="Width">
          <Segmented
            label="Page width"
            value={layout.width}
            options={[
              { id: "narrow", label: "Narrow" },
              { id: "wide", label: "Wide" },
              { id: "full", label: "Full" },
            ]}
            onChange={(width) => onLayout({ width })}
          />
        </Field>
        <Field label="Spacing">
          <Segmented
            label="Spacing between widgets"
            value={layout.gap}
            options={[
              { id: "tight", label: "Tight" },
              { id: "normal", label: "Normal" },
              { id: "roomy", label: "Roomy" },
            ]}
            onChange={(gap) => onLayout({ gap })}
          />
        </Field>
        <Field label="Position">
          <Segmented
            label="Vertical position"
            value={layout.valign}
            options={[
              { id: "top", label: "Top" },
              { id: "center", label: "Centered" },
            ]}
            onChange={(valign) => onLayout({ valign })}
          />
        </Field>
      </Section>

      <Section title="Cards">
        <div className="hi-cardstyles" role="radiogroup" aria-label="Card style">
          {CARD_STYLES.map((style) => (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={layout.cards === style.id}
              className={`hi-cardstyle ${layout.cards === style.id ? "active" : ""}`}
              onClick={() => onLayout({ cards: style.id })}
            >
              <span className={`hi-cardstyle-demo s-${style.id}`} aria-hidden="true">
                <span />
              </span>
              <span className="hi-cardstyle-label">{style.label}</span>
            </button>
          ))}
        </div>
        <Field label="Corners" hint={`${layout.radius}px`}>
          <input
            type="range"
            className="hi-range"
            min={0}
            max={28}
            step={1}
            value={layout.radius}
            aria-label="Corner radius"
            onChange={(event) => onLayout({ radius: Number(event.target.value) }, "radius")}
          />
        </Field>
        <Field label="Shadow">
          <Segmented
            label="Card shadow"
            value={layout.shadow}
            options={[
              { id: "none", label: "None" },
              { id: "soft", label: "Soft" },
              { id: "lifted", label: "Lifted" },
            ]}
            onChange={(shadow) => onLayout({ shadow })}
          />
        </Field>
      </Section>

      <Section title="Type & color">
        <Field label="Headlines">
          <div className="hi-fonts" role="radiogroup" aria-label="Headline font">
            {(["serif", "sans", "mono"] as const).map((font) => (
              <button
                key={font}
                type="button"
                role="radio"
                aria-checked={layout.font === font}
                className={`hi-font f-${font} ${layout.font === font ? "active" : ""}`}
                onClick={() => onLayout({ font })}
              >
                <span className="hi-font-demo">Aa</span>
                <span>{font === "serif" ? "Serif" : font === "sans" ? "Sans" : "Mono"}</span>
              </button>
            ))}
          </div>
        </Field>
        <Field label="Accent">
          <Swatches label="Accent color" value={layout.accent} onChange={(accent) => onLayout({ accent }, "accent")} />
        </Field>
        <Field label="Greeting headline" hint="Empty = time of day">
          <input
            type="text"
            className="hi-input"
            value={layout.title}
            maxLength={80}
            placeholder="Good morning."
            onChange={(event) => onLayout({ title: event.target.value }, "title")}
          />
        </Field>
      </Section>
      <Section title="Custom CSS">
        <Field label="View CSS" hint={<>Scoped to this view; <code>&amp;</code> is the view, <code>.hw</code> a card</>}>
          <textarea
            className="hi-input hi-textarea hi-code"
            rows={5}
            spellCheck={false}
            value={layout.css ?? ""}
            maxLength={MAX_VIEW_CSS}
            placeholder={"& .hw { backdrop-filter: blur(12px); }\n& .hw-head h2 { text-transform: uppercase; }"}
            aria-label="View CSS"
            onChange={(event) => onLayout({ css: event.target.value || undefined }, "view-css")}
          />
        </Field>
      </Section>

      <div className="hi-footer-actions">
        <button
          type="button"
          className="hi-ghost"
          onClick={() =>
            onLayout({
              radius: DEFAULT_RADIUS,
              shadow: "soft",
              cards: "glass",
              gap: "normal",
              width: "wide",
              font: "serif",
              valign: "top",
              accent: undefined,
            })
          }
        >
          <RotateCcw size={13} aria-hidden="true" /> Reset style
        </button>
        <button type="button" className="hi-ghost" onClick={onTidy} disabled={!layout.widgets.length} title="Slide every widget up to close the gaps">
          <LayoutDashboard size={13} aria-hidden="true" /> Tidy up
        </button>
        <button type="button" className="hi-ghost danger" onClick={onClear} disabled={!layout.widgets.length}>
          <Eraser size={13} aria-hidden="true" /> Clear widgets
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Add

function AddPanel({ layout, onAdd }: InspectorProps) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const full = layout.widgets.length >= MAX_WIDGETS;
  const matches = (type: HomeWidgetType) => !needle || `${HOME_WIDGET_INFO[type].label} ${HOME_WIDGET_INFO[type].description}`.toLowerCase().includes(needle);
  const counts = useMemo(() => {
    const map = new Map<HomeWidgetType, number>();
    for (const widget of layout.widgets) map.set(widget.type, (map.get(widget.type) ?? 0) + 1);
    return map;
  }, [layout.widgets]);
  const groups = HOME_WIDGET_CATEGORIES.map((category) => ({
    ...category,
    types: HOME_WIDGET_TYPES.filter((type) => HOME_WIDGET_INFO[type].category === category.id && matches(type)),
  })).filter((group) => group.types.length);
  return (
    <>
      <label className="hi-search">
        <Search size={14} aria-hidden="true" />
        <input type="search" value={query} placeholder="Search widgets" aria-label="Search widgets" onChange={(event) => setQuery(event.target.value)} autoFocus />
      </label>
      {full ? <p className="hi-hint warn">This Home holds {MAX_WIDGETS} widgets, the most it can. Remove one to add another.</p> : null}
      {groups.map((group) => (
        <Section key={group.id} title={group.label}>
          <div className="hi-widget-list">
            {group.types.map((type) => {
              const Icon = WIDGET_ICONS[type];
              const info = HOME_WIDGET_INFO[type];
              const used = counts.get(type) ?? 0;
              return (
                <button key={type} type="button" className="hi-widget-option" disabled={full} onClick={() => onAdd(type)}>
                  <span className="hi-widget-icon">
                    <Icon size={16} aria-hidden="true" />
                  </span>
                  <span className="hi-widget-copy">
                    <span className="hi-widget-name">
                      {info.label}
                      {used ? <span className="hi-badge">{used} on page</span> : null}
                    </span>
                    <span className="hi-widget-desc">{info.description}</span>
                  </span>
                  <Plus size={14} className="hi-widget-plus" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </Section>
      ))}
      {!groups.length ? <p className="hi-hint">No widget matches “{query.trim()}”.</p> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Widget

function WidgetPanel({ layout, widget, stacked, onWidget, onBox, onFit, onDuplicate, onRemove }: InspectorProps & { widget: HomeWidget }) {
  const info = HOME_WIDGET_INFO[widget.type];
  const Icon = WIDGET_ICONS[widget.type];
  const patch = (next: Partial<HomeWidget>, key?: string) => onWidget(widget.id, next, key);
  const box = (next: Partial<Box>, key?: string) => onBox(widget.id, next, key);
  const variants = HOME_WIDGET_VARIANTS[widget.type];
  const isSpacer = widget.type === "spacer";
  const isGreeting = widget.type === "greeting";
  const hasHeader = !isSpacer && widget.type !== "text" && widget.type !== "continue";
  const maxX = HOME_GRID_COLUMNS - widget.w;
  return (
    <>
      <div className="hi-widget-summary">
        <span className="hi-widget-icon large">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="hi-widget-copy">
          <span className="hi-widget-name">{widgetLabel(widget)}</span>
          <span className="hi-widget-desc">{info.description}</span>
        </span>
      </div>
      <div className="hi-widget-actions">
        <button type="button" className="hi-tool" onClick={() => onDuplicate(widget.id)} disabled={layout.widgets.length >= MAX_WIDGETS} title="Duplicate (Ctrl+D)">
          <Copy size={14} aria-hidden="true" /> Duplicate
        </button>
        <button type="button" className="hi-tool danger" onClick={() => onRemove(widget.id)} title="Remove (Delete)">
          <Trash2 size={14} aria-hidden="true" /> Remove
        </button>
      </div>

      <Section title="Size & position">
        {stacked ? <p className="hi-hint">The page is narrow, so widgets stack in one column. Widen the window to place them freely.</p> : null}
        <Field label="Width" hint={`${widget.w} of ${HOME_GRID_COLUMNS} columns`}>
          <div className="hi-spans" role="radiogroup" aria-label="Widget width">
            {QUICK_WIDTHS.map((item) => (
              <button
                key={item.w}
                type="button"
                role="radio"
                aria-checked={widget.w === item.w}
                className={`hi-span ${widget.w === item.w ? "active" : ""}`}
                onClick={() => box({ w: item.w, x: Math.min(widget.x, HOME_GRID_COLUMNS - item.w) })}
                title={`${item.w} columns`}
              >
                <span className="hi-span-bar" style={{ width: `${(item.w / HOME_GRID_COLUMNS) * 100}%` }} />
                <span className="hi-span-label">{item.label}</span>
              </button>
            ))}
          </div>
          <Stepper label="Width" value={widget.w} min={MIN_WIDGET_W} max={HOME_GRID_COLUMNS - widget.x} onChange={(w) => box({ w }, `w:${widget.id}`)} format={(v) => `${v} / ${HOME_GRID_COLUMNS}`} />
        </Field>
        <Field label="Height" hint={`${widget.h * HOME_ROW_PX}px`}>
          <div className="hi-row">
            <Stepper label="Height" value={widget.h} min={MIN_WIDGET_H} max={MAX_WIDGET_H} step={2} onChange={(h) => box({ h }, `h:${widget.id}`)} format={(v) => `${v * HOME_ROW_PX}px`} />
            <button type="button" className="hi-tool" onClick={() => onFit(widget.id)} disabled={isSpacer} title="Make the card exactly as tall as its content">
              <MoveVertical size={14} aria-hidden="true" /> Fit content
            </button>
          </div>
        </Field>
        <Field label="Column" hint={`${widget.x + 1}–${widget.x + widget.w}`}>
          <input
            type="range"
            className="hi-range"
            min={0}
            max={maxX}
            value={widget.x}
            disabled={maxX <= 0}
            aria-label="Column"
            onChange={(event) => box({ x: Number(event.target.value) }, `x:${widget.id}`)}
          />
        </Field>
        <Field label="Row">
          <Stepper label="Row" value={widget.y} min={0} max={2000} step={2} onChange={(y) => box({ y }, `y:${widget.id}`)} format={(v) => `${v * HOME_ROW_PX}px from top`} />
        </Field>
        <p className="hi-hint">Drag a card to move it, its edges to resize. Only cards it lands on move out of the way.</p>
      </Section>

      {!isSpacer ? (
        <Section title="Content">
          {isGreeting ? (
            <>
              <Field label="Headline" hint="Empty = time of day">
                <input
                  type="text"
                  className="hi-input"
                  value={widget.title ?? ""}
                  maxLength={80}
                  placeholder={layout.title || "Good morning."}
                  onChange={(event) => patch({ title: event.target.value }, `title:${widget.id}`)}
                />
              </Field>
              <Field label="Subtitle">
                <input
                  type="text"
                  className="hi-input"
                  value={widget.text ?? ""}
                  maxLength={160}
                  placeholder="A line under the greeting"
                  onChange={(event) => patch({ text: event.target.value }, `text:${widget.id}`)}
                />
              </Field>
              <Toggle label="Show date line" checked={!widget.hideTitle} onChange={(show) => patch({ hideTitle: !show })} />
            </>
          ) : hasHeader ? (
            <>
              <Field label="Title">
                <input
                  type="text"
                  className="hi-input"
                  value={widget.title ?? ""}
                  maxLength={60}
                  placeholder={info.label}
                  onChange={(event) => patch({ title: event.target.value }, `title:${widget.id}`)}
                />
              </Field>
              <Toggle label="Show header" checked={!widget.hideTitle} onChange={(show) => patch({ hideTitle: !show })} />
            </>
          ) : widget.type === "continue" ? (
            <Field label="Kicker">
              <input
                type="text"
                className="hi-input"
                value={widget.title ?? ""}
                maxLength={60}
                placeholder="Pick up where you left off"
                onChange={(event) => patch({ title: event.target.value }, `title:${widget.id}`)}
              />
            </Field>
          ) : null}
          {variants ? (
            <Field label="Style">
              <Segmented label="Widget variant" value={widget.variant ?? variants[0].id} options={variants} onChange={(variant) => patch({ variant })} />
            </Field>
          ) : null}
          {info.limit ? (
            <Field label="Items" hint={widget.limit ? String(widget.limit) : "Auto"}>
              <input
                type="range"
                className="hi-range"
                min={info.limit.min}
                max={info.limit.max}
                value={widget.limit ?? info.limit.min}
                aria-label="How many items"
                onChange={(event) => patch({ limit: Number(event.target.value) }, `limit:${widget.id}`)}
              />
              {widget.limit ? (
                <button type="button" className="hi-ghost small" onClick={() => patch({ limit: undefined })}>
                  Fit to size
                </button>
              ) : null}
            </Field>
          ) : null}
          <TypeSettings widget={widget} patch={patch} />
        </Section>
      ) : null}

      {!isSpacer && widget.type !== "text" && !isGreeting ? (
        <Section title="Look">
          <Field label="Card">
            <div className="hi-chips" role="radiogroup" aria-label="Card style">
              <button type="button" role="radio" aria-checked={!widget.style} className={`hi-chip ${!widget.style ? "active" : ""}`} onClick={() => patch({ style: undefined })}>
                Page default
              </button>
              {CARD_STYLES.map((style) => (
                <button
                  key={style.id}
                  type="button"
                  role="radio"
                  aria-checked={widget.style === style.id}
                  className={`hi-chip ${widget.style === style.id ? "active" : ""}`}
                  onClick={() => patch({ style: style.id })}
                  title={style.hint}
                >
                  {style.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Tint">
            <Swatches label="Widget tint" value={widget.tint} allowDefault="None" onChange={(tint) => patch({ tint }, `tint:${widget.id}`)} />
          </Field>
        </Section>
      ) : null}
    </>
  );
}

function TypeSettings({ widget, patch }: { widget: HomeWidget; patch: (next: Partial<HomeWidget>, key?: string) => void }) {
  return (
    <>
      <TypeFields widget={widget} patch={patch} />
      <Field label="Card CSS" hint={<>Use <code>&amp;</code> for the card</>}>
        <textarea
          className="hi-input hi-textarea hi-code"
          rows={3}
          spellCheck={false}
          value={widget.css ?? ""}
          maxLength={MAX_WIDGET_CSS}
          placeholder={"border-radius: 4px;\n& h2 { letter-spacing: .04em; }"}
          onChange={(event) => patch({ css: event.target.value || undefined }, `css:${widget.id}`)}
        />
      </Field>
    </>
  );
}

function TypeFields({ widget, patch }: { widget: HomeWidget; patch: (next: Partial<HomeWidget>, key?: string) => void }) {
  const pages = useAppStore((state) => state.pages);
  switch (widget.type) {
    case "html":
      return (
        <Field label="HTML" hint="Runs in a sandbox; window.noteral is the SDK">
          <textarea
            className="hi-input hi-textarea hi-code"
            rows={10}
            spellCheck={false}
            value={widget.html ?? ""}
            maxLength={MAX_WIDGET_HTML}
            placeholder={"<h3>Hello</h3>\n<script>\n  noteral.call('pages.list', {}).then(p => document.body.append(p.length + ' pages'))\n</script>"}
            onChange={(event) => patch({ html: event.target.value }, `html:${widget.id}`)}
          />
        </Field>
      );
    case "clock":
      return <Toggle label="24-hour time" checked={widget.hour24 === true} onChange={(hour24) => patch({ hour24 })} />;
    case "quick": {
      const actions = widget.actions ?? DEFAULT_QUICK_ACTIONS;
      return (
        <Field label="Actions">
          <div className="hi-checks">
            {HOME_QUICK_ACTIONS.map((id) => {
              const { label, icon: ActionIcon } = QUICK_ACTION_INFO[id];
              const on = actions.includes(id);
              return (
                <label key={id} className={`hi-check ${on ? "on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      patch({
                        actions: on ? actions.filter((a) => a !== id) : HOME_QUICK_ACTIONS.filter((a) => a === id || actions.includes(a)),
                      })
                    }
                  />
                  <ActionIcon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
        </Field>
      );
    }
    case "links":
      return <PagePicker pages={pages} selected={widget.pageIds ?? []} onChange={(pageIds) => patch({ pageIds })} />;
    case "folder":
      return <FolderPicker pages={pages} value={widget.pageId} onChange={(pageId) => patch({ pageId })} />;
    case "countdown":
      return (
        <>
          <Field label="Date">
            <input type="date" className="hi-input" value={widget.date ?? ""} onChange={(event) => patch({ date: event.target.value || undefined })} />
          </Field>
        </>
      );
    case "text":
      return (
        <Field label="Text" hint="Or type on the page">
          <textarea
            className="hi-input hi-textarea"
            rows={4}
            value={widget.text ?? ""}
            maxLength={2000}
            onChange={(event) => patch({ text: event.target.value }, `text:${widget.id}`)}
          />
        </Field>
      );
    case "note":
      return widget.text ? (
        <button type="button" className="hi-ghost danger" onClick={() => patch({ text: "" })}>
          <Eraser size={13} aria-hidden="true" /> Clear note
        </button>
      ) : null;
    case "todo": {
      const items = widget.items ?? [];
      const done = items.filter((item) => item.done).length;
      return items.length ? (
        <div className="hi-row-actions">
          <button type="button" className="hi-ghost" onClick={() => patch({ items: items.filter((item) => !item.done) })} disabled={!done}>
            <Check size={13} aria-hidden="true" /> Clear {done} done
          </button>
          <button type="button" className="hi-ghost danger" onClick={() => patch({ items: [] })}>
            <Eraser size={13} aria-hidden="true" /> Clear all
          </button>
        </div>
      ) : null;
    }
    case "buttons":
      return <ButtonsEditor widget={widget} pages={pages} patch={patch} />;
    case "image":
      return (
        <>
          <Field label="Image link" hint="https://…">
            <input
              type="url"
              className="hi-input"
              value={widget.url ?? ""}
              placeholder="https://images.example.com/photo.jpg"
              onChange={(event) => patch({ url: event.target.value.trim() || undefined }, `url:${widget.id}`)}
            />
          </Field>
          <Field label="Caption">
            <input type="text" className="hi-input" value={widget.text ?? ""} maxLength={160} onChange={(event) => patch({ text: event.target.value }, `text:${widget.id}`)} />
          </Field>
        </>
      );
    case "habits":
      return <ListEditor
        label="Habits"
        noun="habit"
        max={MAX_HABITS}
        items={(widget.habits ?? []).map((h) => ({ id: h.id, text: h.text }))}
        onChange={(rows, key) => {
          const old = new Map((widget.habits ?? []).map((h) => [h.id, h]));
          patch({ habits: rows.map((row): HomeHabit => ({ id: row.id, text: row.text, days: old.get(row.id)?.days ?? [] })) }, key);
        }}
        extra={(widget.habits ?? []).some((h) => h.days.length) ? (
          <button type="button" className="hi-ghost" onClick={() => patch({ habits: (widget.habits ?? []).map((h) => ({ ...h, days: [] })) })}>
            <RotateCcw size={13} aria-hidden="true" /> Reset all check-ins
          </button>
        ) : null}
      />;
    case "progress":
      return <GoalsEditor widget={widget} patch={patch} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Editors for list-like widgets

function moveItem<T>(list: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

function RowTools({ index, count, onMove, onRemove, noun }: { index: number; count: number; onMove: (delta: number) => void; onRemove: () => void; noun: string }) {
  return (
    <span className="hi-item-tools">
      <button type="button" className="icon-button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${noun} up`}>
        <ArrowUp size={13} />
      </button>
      <button type="button" className="icon-button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${noun} down`}>
        <ArrowDown size={13} />
      </button>
      <button type="button" className="icon-button danger" onClick={onRemove} aria-label={`Remove ${noun}`}>
        <X size={13} />
      </button>
    </span>
  );
}

function ListEditor({
  label,
  noun,
  max,
  items,
  onChange,
  extra,
}: {
  label: string;
  noun: string;
  max: number;
  items: { id: string; text: string }[];
  onChange: (items: { id: string; text: string }[], key?: string) => void;
  extra?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text || items.length >= max) return;
    onChange([...items, { id: newWidgetId(), text: text.slice(0, 60) }]);
    setDraft("");
  };
  return (
    <Field label={label} hint={`${items.length} / ${max}`}>
      <ul className="hi-items">
        {items.map((item, index) => (
          <li key={item.id} className="hi-item">
            <input
              type="text"
              className="hi-input"
              value={item.text}
              maxLength={60}
              aria-label={`${noun} ${index + 1}`}
              onChange={(event) => onChange(items.map((row) => (row.id === item.id ? { ...row, text: event.target.value } : row)), `item:${item.id}`)}
            />
            <RowTools index={index} count={items.length} noun={noun} onMove={(delta) => onChange(moveItem(items, index, delta))} onRemove={() => onChange(items.filter((row) => row.id !== item.id))} />
          </li>
        ))}
      </ul>
      {items.length < max ? (
        <form
          className="hi-item-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input type="text" className="hi-input" value={draft} maxLength={60} placeholder={`Add a ${noun}…`} onChange={(event) => setDraft(event.target.value)} />
          <button type="submit" className="icon-button" disabled={!draft.trim()} aria-label={`Add ${noun}`}>
            <Plus size={14} />
          </button>
        </form>
      ) : null}
      {extra}
    </Field>
  );
}

function GoalsEditor({ widget, patch }: { widget: HomeWidget; patch: (next: Partial<HomeWidget>, key?: string) => void }) {
  const goals = widget.goals ?? [];
  const set = (next: HomeGoal[], key?: string) => patch({ goals: next }, key);
  return (
    <Field label="Goals" hint={`${goals.length} / ${MAX_GOALS}`}>
      <ul className="hi-items">
        {goals.map((goal, index) => (
          <li key={goal.id} className="hi-item stacked">
            <div className="hi-item-line">
              <input
                type="text"
                className="hi-input"
                value={goal.text}
                maxLength={60}
                aria-label={`Goal ${index + 1}`}
                onChange={(event) => set(goals.map((g) => (g.id === goal.id ? { ...g, text: event.target.value } : g)), `goal:${goal.id}`)}
              />
              <RowTools index={index} count={goals.length} noun="goal" onMove={(delta) => set(moveItem(goals, index, delta))} onRemove={() => set(goals.filter((g) => g.id !== goal.id))} />
            </div>
            <div className="hi-item-line numbers">
              <label>
                <span>Done</span>
                <input
                  type="number"
                  className="hi-input"
                  min={0}
                  max={goal.max}
                  value={goal.value}
                  onChange={(event) => set(goals.map((g) => (g.id === goal.id ? { ...g, value: Math.max(0, Math.min(g.max, Math.round(Number(event.target.value) || 0))) } : g)), `goalv:${goal.id}`)}
                />
              </label>
              <label>
                <span>Target</span>
                <input
                  type="number"
                  className="hi-input"
                  min={1}
                  max={1000000}
                  value={goal.max}
                  onChange={(event) => {
                    const max = Math.max(1, Math.min(1e6, Math.round(Number(event.target.value) || 1)));
                    set(goals.map((g) => (g.id === goal.id ? { ...g, max, value: Math.min(g.value, max) } : g)), `goalm:${goal.id}`);
                  }}
                />
              </label>
            </div>
          </li>
        ))}
      </ul>
      {goals.length < MAX_GOALS ? (
        <button type="button" className="hi-ghost" onClick={() => set([...goals, { id: newWidgetId(), text: `Goal ${goals.length + 1}`, value: 0, max: 10 }])}>
          <Plus size={13} aria-hidden="true" /> Add goal
        </button>
      ) : null}
    </Field>
  );
}

const ACTION_OPTIONS: { id: HomeButtonAction; label: string }[] = HOME_BUTTON_ACTIONS.map((id) => ({ id, label: BUTTON_ACTION_LABELS[id] }));

function ButtonsEditor({ widget, pages, patch }: { widget: HomeWidget; pages: PageMeta[]; patch: (next: Partial<HomeWidget>, key?: string) => void }) {
  const buttons = widget.buttons ?? [];
  const [open, setOpen] = useState<string | null>(buttons[0]?.id ?? null);
  const openable = useMemo(() => pages.filter(isOpenable).sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled")), [pages]);
  const set = (next: HomeButton[], key?: string) => patch({ buttons: next }, key);
  const update = (id: string, change: Partial<HomeButton>, key?: string) => set(buttons.map((b) => (b.id === id ? { ...b, ...change } : b)), key);
  const add = () => {
    const button: HomeButton = { id: newWidgetId(), label: "", icon: "arrow", action: "new-page" };
    set([...buttons, button]);
    setOpen(button.id);
  };
  return (
    <Field label="Buttons" hint={`${buttons.length} / ${MAX_BUTTONS}`}>
      <ul className="hi-items">
        {buttons.map((button, index) => {
          const ButtonIcon = BUTTON_ICONS[button.icon];
          const expanded = open === button.id;
          return (
            <li key={button.id} className={`hi-item stacked ${expanded ? "open" : ""}`}>
              <div className="hi-item-line">
                <button type="button" className="hi-item-toggle" onClick={() => setOpen(expanded ? null : button.id)} aria-expanded={expanded}>
                  <span className="hi-item-swatch" style={button.color ? { background: button.color } : undefined}>
                    <ButtonIcon size={13} aria-hidden="true" />
                  </span>
                  <span className="hi-item-label">{buttonLabel(button, pages)}</span>
                </button>
                <RowTools index={index} count={buttons.length} noun="button" onMove={(delta) => set(moveItem(buttons, index, delta))} onRemove={() => set(buttons.filter((b) => b.id !== button.id))} />
              </div>
              {expanded ? (
                <div className="hi-item-form">
                  <label className="hi-mini">
                    <span>Does</span>
                    <select
                      className="hi-input"
                      value={button.action}
                      onChange={(event) => update(button.id, { action: event.target.value as HomeButtonAction, target: undefined })}
                    >
                      {ACTION_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {button.action === "page" ? (
                    <label className="hi-mini">
                      <span>Page</span>
                      <select className="hi-input" value={button.target ?? ""} onChange={(event) => update(button.id, { target: event.target.value || undefined })}>
                        <option value="">Choose a page…</option>
                        {openable.map((page) => (
                          <option key={page.id} value={page.id}>
                            {page.title || "Untitled"}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {button.action === "url" ? (
                    <label className="hi-mini">
                      <span>Link</span>
                      <input
                        type="url"
                        className="hi-input"
                        value={button.target ?? ""}
                        placeholder="https://"
                        onChange={(event) => update(button.id, { target: event.target.value.trim() || undefined }, `bt:${button.id}`)}
                      />
                    </label>
                  ) : null}
                  <label className="hi-mini">
                    <span>Label</span>
                    <input
                      type="text"
                      className="hi-input"
                      value={button.label}
                      maxLength={40}
                      placeholder={buttonLabel({ ...button, label: "" }, pages)}
                      onChange={(event) => update(button.id, { label: event.target.value }, `bl:${button.id}`)}
                    />
                  </label>
                  <div className="hi-mini">
                    <span>Icon</span>
                    <div className="hi-icon-grid" role="radiogroup" aria-label="Button icon">
                      {HOME_BUTTON_ICONS.map((icon) => {
                        const Glyph = BUTTON_ICONS[icon];
                        return (
                          <button
                            key={icon}
                            type="button"
                            role="radio"
                            aria-checked={button.icon === icon}
                            aria-label={icon}
                            className={button.icon === icon ? "active" : ""}
                            onClick={() => update(button.id, { icon })}
                          >
                            <Glyph size={14} aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="hi-mini">
                    <span>Color</span>
                    <Swatches label="Button color" value={button.color} allowDefault="Accent" onChange={(color) => update(button.id, { color })} />
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {buttons.length < MAX_BUTTONS ? (
        <button type="button" className="hi-ghost" onClick={add}>
          <Plus size={13} aria-hidden="true" /> Add button
        </button>
      ) : null}
    </Field>
  );
}

function PagePicker({ pages, selected, onChange }: { pages: PageMeta[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState("");
  const byId = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const needle = query.trim().toLowerCase();
  const candidates = useMemo(
    () =>
      pages
        .filter((page) => isOpenable(page) && !selected.includes(page.id) && (!needle || (page.title || "Untitled").toLowerCase().includes(needle)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8),
    [pages, selected, needle],
  );
  const chosen = selected.map((id) => byId.get(id)).filter((page): page is PageMeta => Boolean(page));
  const move = (index: number, delta: number) => {
    const next = [...selected];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };
  return (
    <Field label="Pages" hint={`${chosen.length}/${MAX_PINNED_PAGES}`}>
      {chosen.length ? (
        <ul className="hi-picked">
          {chosen.map((page, index) => (
            <li key={page.id}>
              <PageGlyph page={page} size={14} />
              <span className="hi-picked-title">{page.title || "Untitled"}</span>
              <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Move up">
                <ArrowUp size={12} />
              </button>
              <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === chosen.length - 1} aria-label="Move down">
                <ArrowDown size={12} />
              </button>
              <button type="button" className="icon-button" onClick={() => onChange(selected.filter((id) => id !== page.id))} aria-label={`Unpin ${page.title || "Untitled"}`}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {selected.length < MAX_PINNED_PAGES ? (
        <>
          <label className="hi-search small">
            <Search size={13} aria-hidden="true" />
            <input type="search" value={query} placeholder="Find a page to pin" aria-label="Find a page to pin" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="hi-candidates">
            {candidates.map((page) => (
              <button key={page.id} type="button" className="hi-candidate" onClick={() => onChange([...selected, page.id])}>
                <PageGlyph page={page} size={14} />
                <span>{page.title || "Untitled"}</span>
                <Plus size={13} aria-hidden="true" />
              </button>
            ))}
            {!candidates.length ? <p className="hi-hint">{needle ? "No match." : "Every page is pinned."}</p> : null}
          </div>
        </>
      ) : null}
    </Field>
  );
}

function FolderPicker({ pages, value, onChange }: { pages: PageMeta[]; value?: string; onChange: (id: string) => void }) {
  const options = useMemo(() => {
    const parents = new Set(pages.map((page) => page.parentId).filter(Boolean));
    return pages
      .filter((page) => page.kind === "folder" || parents.has(page.id))
      .sort((a, b) => (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || (a.title || "").localeCompare(b.title || ""));
  }, [pages]);
  if (!options.length) return <p className="hi-hint">Make a folder, or nest pages inside a page, to list it here.</p>;
  return (
    <Field label="Show what's inside">
      <div className="hi-candidates">
        {options.map((page) => (
          <button key={page.id} type="button" className={`hi-candidate ${value === page.id ? "active" : ""}`} onClick={() => onChange(page.id)} aria-pressed={value === page.id}>
            <PageGlyph page={page} size={14} />
            <span>{page.title || "Untitled"}</span>
            {value === page.id ? <Check size={13} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </Field>
  );
}
