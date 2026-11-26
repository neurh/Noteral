import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ImagePlus, LoaderCircle, Upload } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fileToBase64 } from "../lib/base64";
import { COVER_COLORS, COVER_GRADIENTS, COVER_IMAGES, customGradientValue } from "../lib/covers";
import { HOME_BACKGROUND_INFO, type HomeAsciiBackground, type HomeAsciiDensity } from "../lib/home";
import { normalizePageBackground, pageAsciiOptions, pageBackgroundDim, pageBackgroundOpacity, PAGE_ASCII_SCENES, setPageBackground, usePageBackground, type PageAsciiOptions, type PageBackground, type PageBackgroundKind } from "../lib/pageBackground";
import { normalizeBackgroundGradient } from "../lib/pageBackgroundModel";
import { useAppStore } from "../store";
import { AsciiCanvas } from "./home/AsciiCanvas";
import { ImageLinkField } from "./ImageLinkField";
import { Modal } from "./Modal";
import { PageBackdrop } from "./PageBackdrop";
import "../styles/page-background.css";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp";
const MAX_UPLOAD = 12 * 1024 * 1024;
const DEFAULT_INK = "#e8b86a";

/** Colors that follow the app theme, so the page stays right in light and dark. */
const THEME_COLORS: Array<{ name: string; value: string }> = [
  { name: "Paper", value: "var(--bg-sunken)" },
  { name: "Raised", value: "var(--bg-raised)" },
  { name: "Accent wash", value: "var(--accent-soft)" },
  { name: "Hover", value: "var(--bg-hover)" },
];

const tabs: Array<{ id: PageBackgroundKind; label: string }> = [
  { id: "color", label: "Color" },
  { id: "gradient", label: "Gradient" },
  { id: "image", label: "Image" },
  { id: "ascii", label: "ASCII" },
];

const DENSITIES: Array<{ id: HomeAsciiDensity; label: string }> = [
  { id: "fine", label: "Fine" },
  { id: "normal", label: "Normal" },
  { id: "large", label: "Large" },
];

function imageSrc(option: (typeof COVER_IMAGES)[number]): string {
  return /^url\("([^"]+)"\)$/.exec(option.preview)?.[1] ?? "";
}

interface PageBackgroundDialogProps {
  open: boolean;
  onClose: () => void;
  pageId: string;
}

export function PageBackgroundDialog({ open, onClose, pageId }: PageBackgroundDialogProps) {
  const saved = usePageBackground(pageId);
  const workspaceId = useAppStore((state) => state.workspace?.id ?? "");
  const title = useAppStore((state) => state.pages.find((page) => page.id === pageId)?.title || "Untitled");
  const notify = useAppStore((state) => state.notify);
  const [draft, setDraft] = useState<PageBackground | null>(saved);
  const [tab, setTab] = useState<PageBackgroundKind>("color");
  const pending = useRef<{ timer: number; value: PageBackground | null } | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(saved);
    setTab(saved?.kind ?? "color");
    // Only when the dialog opens: later changes come from this dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  const save = (value: PageBackground | null) => {
    setPageBackground(pageId, value).catch((error) => notify(errorMessage(error), "error"));
  };

  const flush = () => {
    const current = pending.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    pending.current = null;
    save(current.value);
  };

  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Show the change at once; save it right away, or shortly after a slider settles. */
  const apply = (next: PageBackground | null, delay = 0) => {
    const clean = next ? normalizePageBackground(next) : null;
    if (next && !clean) return;
    setDraft(clean);
    if (pending.current) window.clearTimeout(pending.current.timer);
    if (delay <= 0) {
      pending.current = null;
      save(clean);
      return;
    }
    pending.current = { value: clean, timer: window.setTimeout(flush, delay) };
  };

  /** A new background keeps the strength and veil chosen for the same kind. */
  const pick = (kind: PageBackgroundKind, patch: Pick<PageBackground, "value" | "ascii">) => {
    const keep = draft?.kind === kind ? { opacity: draft.opacity, dim: draft.dim } : { opacity: draft?.opacity };
    apply({ kind, ...keep, ...patch });
  };

  const close = () => {
    flush();
    onClose();
  };

  const opacity = draft ? pageBackgroundOpacity(draft) : 1;
  const dim = draft ? pageBackgroundDim(draft) : 0;

  return (
    <Modal
      open={open}
      title="Page background"
      subtitle="Fill the whole page behind its cover and text — a color, gradient, image or a living ASCII scene."
      onClose={close}
      width="large"
      className="appearance-modal page-bg-modal"
      bodyClassName="appearance-body page-bg-body"
      footer={
        <>
          {draft ? (
            <button type="button" className="text-button" onClick={() => apply(null)}>Remove background</button>
          ) : <span />}
          <button type="button" className="secondary-button" onClick={close}>Done</button>
        </>
      }
    >
      <div className="appearance-tabs" role="tablist" aria-label="Background type">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {draft?.kind === item.id ? <span className="page-bg-tab-dot" aria-label="(in use)" /> : null}
          </button>
        ))}
      </div>

      <div className="page-bg-layout">
        <div className="appearance-scroll page-bg-options">
          {tab === "color" ? <ColorPanel draft={draft} onPick={(value) => pick("color", { value })} /> : null}
          {tab === "gradient" ? <GradientPanel draft={draft} onPick={(value) => pick("gradient", { value })} /> : null}
          {tab === "image" ? <ImagePanel draft={draft} workspaceId={workspaceId} pageId={pageId} onPick={(value) => pick("image", { value })} /> : null}
          {tab === "ascii" ? (
            <AsciiPanel
              draft={draft}
              onPick={(ascii, delay) => {
                if (delay) apply({ ...(draft as PageBackground), ascii: { ...ascii } }, delay);
                else pick("ascii", { ascii: { ...ascii } });
              }}
            />
          ) : null}
        </div>

        <aside className="page-bg-side" aria-label="Preview and readability">
          <div className="page-bg-sample">
            {draft ? <PageBackdrop background={draft} active={open} preview /> : null}
            <div className="page-bg-sample-text">
              <strong>{title}</strong>
              <p>Text on this page reads like this. Raise the veil if it gets hard to read.</p>
            </div>
          </div>
          <label className={`page-bg-range ${draft ? "" : "disabled"}`}>
            <span>Strength</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={opacity}
              disabled={!draft}
              onChange={(event) => draft && apply({ ...draft, opacity: Number(event.target.value) }, 220)}
            />
            <output>{Math.round(opacity * 100)}%</output>
          </label>
          <label className={`page-bg-range ${draft ? "" : "disabled"}`}>
            <span>Veil</span>
            <input
              type="range"
              min={0}
              max={0.9}
              step={0.05}
              value={dim}
              disabled={!draft}
              onChange={(event) => draft && apply({ ...draft, dim: Number(event.target.value) }, 220)}
            />
            <output>{Math.round(dim * 100)}%</output>
          </label>
          <p className="page-bg-note">
            {draft
              ? "Strength fades the background into the page color. The veil lays the page color over it so text stays readable in light and dark themes."
              : "No background yet. Pick one to see it here and on the page."}
          </p>
        </aside>
      </div>
    </Modal>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="page-bg-section">
      <div className="cover-images-head">
        <h3>{title}</h3>
        {note ? <span>{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

function Swatch({ label, style, selected, onPick }: { label: string; style: Record<string, string> | undefined; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className={`cover-option compact ${selected ? "selected" : ""}`} style={style} onClick={onPick} title={label} aria-label={label}>
      {selected ? <span className="cover-option-check"><Check size={13} /></span> : null}
      <span className="cover-option-name">{label}</span>
    </button>
  );
}

function ColorPanel({ draft, onPick }: { draft: PageBackground | null; onPick: (value: string) => void }) {
  const current = draft?.kind === "color" ? draft.value ?? "" : "";
  const [custom, setCustom] = useState(() => (/^#[0-9a-f]{6}$/i.test(current) ? current : "#e9e1d6"));
  return (
    <>
      <Section title="Theme" note="Follows light and dark mode">
        <div className="cover-gallery colors" role="radiogroup" aria-label="Theme colors">
          {THEME_COLORS.map((color) => (
            <Swatch key={color.value} label={color.name} style={{ backgroundColor: color.value }} selected={current === color.value} onPick={() => onPick(color.value)} />
          ))}
        </div>
      </Section>
      <Section title="Colors" note="The cover palette">
        <div className="cover-gallery colors" role="radiogroup" aria-label="Colors">
          {COVER_COLORS.map((option) => (
            <Swatch key={option.id} label={option.name} style={{ backgroundColor: option.preview }} selected={current === option.preview.toLowerCase()} onPick={() => onPick(option.preview)} />
          ))}
        </div>
      </Section>
      <Section title="Custom" note="Any color">
        <div className="page-bg-inline">
          <label className="cover-color-field">
            <span>Color</span>
            <input type="color" value={custom} onChange={(event) => setCustom(event.target.value)} aria-label="Custom color" />
            <code>{custom}</code>
          </label>
          <button type="button" className="secondary-button" onClick={() => onPick(custom)}>
            {current === custom.toLowerCase() ? <><Check size={14} /> In use</> : "Use color"}
          </button>
        </div>
      </Section>
    </>
  );
}

function GradientPanel({ draft, onPick }: { draft: PageBackground | null; onPick: (value: string) => void }) {
  const current = draft?.kind === "gradient" ? draft.value ?? "" : "";
  const [angle, setAngle] = useState(135);
  const [from, setFrom] = useState("#f6d5b8");
  const [to, setTo] = useState("#bf6b62");
  const custom = normalizeBackgroundGradient(customGradientValue(angle, from, to)) ?? "";
  return (
    <>
      <Section title="Gradients" note="Soft transitions, made in Noteral">
        <div className="cover-gallery gradients" role="radiogroup" aria-label="Gradients">
          {COVER_GRADIENTS.map((option) => {
            const value = normalizeBackgroundGradient(option.value) ?? "";
            return <Swatch key={option.id} label={option.name} style={{ backgroundImage: option.preview }} selected={Boolean(value) && current === value} onPick={() => onPick(value)} />;
          })}
        </div>
      </Section>
      <Section title="Custom" note="Two colors and an angle">
        <div className="page-bg-gradient">
          <span className="page-bg-gradient-preview" style={{ backgroundImage: custom }} aria-hidden="true" />
          <div className="cover-custom-controls gradient-controls">
            <label className="cover-color-field"><span>From</span><input type="color" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Gradient start" /><code>{from}</code></label>
            <label className="cover-color-field"><span>To</span><input type="color" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Gradient end" /><code>{to}</code></label>
            <label className="cover-angle-field"><span>Angle</span><input type="range" min={0} max={360} step={5} value={angle} onChange={(event) => setAngle(Number(event.target.value))} aria-label="Gradient angle" /><code>{angle}°</code></label>
          </div>
          <div className="cover-custom-actions">
            <button type="button" className="secondary-button" disabled={!custom} onClick={() => onPick(custom)}>
              {custom && current === custom ? <><Check size={14} /> In use</> : "Use gradient"}
            </button>
          </div>
        </div>
      </Section>
    </>
  );
}

function ImagePanel({ draft, workspaceId, pageId, onPick }: { draft: PageBackground | null; workspaceId: string; pageId: string; onPick: (value: string) => void }) {
  const current = draft?.kind === "image" ? draft.value ?? "" : "";
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function upload(file: File | undefined) {
    setError("");
    if (!file) return;
    if (!ACCEPTED_IMAGES.split(",").includes(file.type)) {
      setError("Choose a PNG, JPG, GIF, WebP, AVIF or BMP image.");
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setError("That image is larger than 12 MB. Choose a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const asset = await api.saveAsset(workspaceId, pageId, file.name, await fileToBase64(file));
      onPick(asset.url);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Section title="Your image" note="Stays in this workspace">
        <div
          className="page-bg-upload"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); void upload(event.dataTransfer.files[0]); }}
        >
          <span className="upload-emblem small" aria-hidden="true"><ImagePlus size={18} /></span>
          <div>
            <strong>Upload an image</strong>
            <span>PNG, JPG, GIF, WebP, AVIF or BMP · up to 12 MB, or drop it here.</span>
          </div>
          <input ref={fileInput} type="file" accept={ACCEPTED_IMAGES} hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()} disabled={uploading || !workspaceId}>
            {uploading ? <><LoaderCircle size={14} className="spin" /> Uploading…</> : <><Upload size={14} /> Choose image</>}
          </button>
        </div>
        {error ? <div className="appearance-error" role="alert">{error}</div> : null}
      </Section>
      <ImageLinkField
        className="page-bg-link"
        title="From link"
        applyLabel="Use as background"
        initial={/^https?:/.test(current) ? current : ""}
        onApply={onPick}
      />
      <Section title="Photography" note="Bundled offline · Unsplash License">
        <div className="cover-gallery" role="radiogroup" aria-label="Photography">
          {COVER_IMAGES.map((option) => {
            const src = imageSrc(option);
            return <Swatch key={option.id} label={option.name} style={{ backgroundImage: option.preview }} selected={current === src} onPick={() => onPick(src)} />;
          })}
        </div>
      </Section>
    </>
  );
}

function AsciiPanel({ draft, onPick }: { draft: PageBackground | null; onPick: (ascii: PageAsciiOptions, delay?: number) => void }) {
  const current = pageAsciiOptions(draft);
  const [hovered, setHovered] = useState<HomeAsciiBackground | null>(null);
  const set = (patch: Partial<PageAsciiOptions>, delay = 0) => current && onPick({ ...current, ...patch }, delay || undefined);
  return (
    <>
      <Section title="Scenes" note="The same living wallpapers as Home">
        <div className="page-bg-scenes" role="radiogroup" aria-label="ASCII scenes">
          {PAGE_ASCII_SCENES.map((scene) => {
            const selected = current?.scene === scene;
            return (
              <button
                key={scene}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`page-bg-scene ${selected ? "selected" : ""}`}
                onClick={() => onPick(current ? { ...current, scene } : { scene })}
                onPointerEnter={() => setHovered(scene)}
                onPointerLeave={() => setHovered((value) => (value === scene ? null : value))}
                onFocus={() => setHovered(scene)}
                onBlur={() => setHovered((value) => (value === scene ? null : value))}
              >
                <span className="page-bg-scene-thumb home-bg" data-bg={scene} aria-hidden="true">
                  <AsciiCanvas className="home-bg-canvas" scene={scene} speed={selected ? current?.speed ?? 1 : 1} ink={selected ? current?.ink : undefined} playing={hovered === scene} fontSize={6} maxFps={24} />
                  {selected ? <span className="cover-option-check"><Check size={13} /></span> : null}
                </span>
                <span className="page-bg-scene-label">{HOME_BACKGROUND_INFO[scene].label}</span>
                <span className="page-bg-scene-sub">{HOME_BACKGROUND_INFO[scene].description}</span>
              </button>
            );
          })}
        </div>
      </Section>
      {current ? (
        <Section title={`Tune ${HOME_BACKGROUND_INFO[current.scene].label}`}>
          <div className="page-bg-tune">
            <label className={`page-bg-range ${current.still ? "disabled" : ""}`}>
              <span>Speed</span>
              <input type="range" min={0.25} max={3} step={0.25} value={current.speed ?? 1} disabled={current.still} onChange={(event) => set({ speed: Number(event.target.value) }, 220)} />
              <output>{current.speed ?? 1}×</output>
            </label>
            <Choice label="Detail" value={current.density ?? "normal"} options={DENSITIES} onPick={(id) => set({ density: id as HomeAsciiDensity })} />
            <Choice label="Motion" value={current.still ? "still" : "animated"} options={[{ id: "animated", label: "Animated" }, { id: "still", label: "Still" }]} onPick={(id) => set({ still: id === "still" })} />
            <Choice label="Cursor" value={current.cursor === false ? "ignore" : "react"} disabled={current.still} options={[{ id: "react", label: "React" }, { id: "ignore", label: "Ignore" }]} onPick={(id) => set({ cursor: id !== "ignore" })} />
            <Choice
              label="Ink"
              value={current.ink ? "custom" : "scene"}
              options={[{ id: "scene", label: "Scene" }, { id: "custom", label: "Custom" }]}
              onPick={(id) => set({ ink: id === "custom" ? current.ink ?? DEFAULT_INK : undefined })}
              extra={current.ink ? <input className="page-bg-ink" type="color" value={current.ink} onChange={(event) => set({ ink: event.target.value }, 220)} aria-label="Ink color" /> : null}
            />
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Choice({ label, value, options, onPick, disabled = false, extra }: { label: string; value: string; options: Array<{ id: string; label: string }>; onPick: (id: string) => void; disabled?: boolean; extra?: ReactNode }) {
  return (
    <div className={`page-bg-choice ${disabled ? "disabled" : ""}`}>
      <span>{label}</span>
      <div className="page-bg-segment" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button key={option.id} type="button" role="radio" aria-checked={value === option.id} className={value === option.id ? "active" : ""} disabled={disabled} onClick={() => onPick(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
      {extra}
    </div>
  );
}
