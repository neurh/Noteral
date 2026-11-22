import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Check, ImagePlus, LoaderCircle, Palette, Plus, Search, Upload, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fileToBase64 } from "../lib/base64";
import {
  COVER_COLORS,
  COVER_GRADIENTS,
  COVER_IMAGES,
  coverBase,
  coverColor,
  coverName,
  coverStyle,
  customGradientValue,
  parseCustomGradient,
  type CoverOption,
} from "../lib/covers";
import { Modal } from "./Modal";

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp";
const MAX_UPLOAD = 12 * 1024 * 1024;
const DEFAULT_COLOR = "#b86e55";
const DEFAULT_GRADIENT = { angle: 135, from: "#f6d5b8", to: "#bf6b62" };

type CoverTab = "colors" | "gradients" | "images" | "upload";

const tabs: Array<{ id: CoverTab; label: string }> = [
  { id: "images", label: "Images" },
  { id: "colors", label: "Colors" },
  { id: "gradients", label: "Gradients" },
  { id: "upload", label: "Upload" },
];

function matches(option: CoverOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return `${option.name} ${option.tags.join(" ")}`.toLowerCase().includes(needle);
}

function CoverCard({ option, selected, onPick, compact = false }: { option: CoverOption; selected: boolean; onPick: () => void; compact?: boolean }) {
  return (
    <button
      type="button"
      className={`cover-option ${compact ? "compact" : ""} ${selected ? "selected" : ""}`}
      style={coverStyle(option.value)}
      onClick={onPick}
      title={option.name}
      aria-label={option.name}
      aria-pressed={selected}
    >
      {selected ? <span className="cover-option-check"><Check size={13} /></span> : null}
      <span className="cover-option-name">{option.name}</span>
    </button>
  );
}

interface CoverPickerDialogProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  pageId: string;
  current: string;
  onPick: (value: string) => void;
}

export function CoverPickerDialog({ open, onClose, workspaceId, pageId, current, onPick }: CoverPickerDialogProps) {
  const [tab, setTab] = useState<CoverTab>("images");
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [customColorOpen, setCustomColorOpen] = useState(false);
  const [customColor, setCustomColor] = useState(DEFAULT_COLOR);
  const [gradientOpen, setGradientOpen] = useState(false);
  const [gradientAngle, setGradientAngle] = useState(DEFAULT_GRADIENT.angle);
  const [gradientFrom, setGradientFrom] = useState(DEFAULT_GRADIENT.from);
  const [gradientTo, setGradientTo] = useState(DEFAULT_GRADIENT.to);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab("images");
    setQuery("");
    setUploadError("");
    setCustomColorOpen(false);
    setGradientOpen(false);
    const color = coverColor(current);
    if (color) setCustomColor(color);
    const gradient = parseCustomGradient(current);
    if (gradient) {
      setGradientAngle(gradient.angle);
      setGradientFrom(gradient.from);
      setGradientTo(gradient.to);
    }
  }, [open, current]);

  const filtered = useMemo(() => {
    const source = tab === "colors" ? COVER_COLORS : tab === "gradients" ? COVER_GRADIENTS : tab === "images" ? COVER_IMAGES : [];
    return source.filter((option) => matches(option, query));
  }, [query, tab]);

  const currentBase = coverBase(current);
  const customColorSelected = Boolean(coverColor(current)) && !COVER_COLORS.some((option) => option.value === currentBase);
  const customGradientSelected = Boolean(parseCustomGradient(current));
  const showCustomCards = !query.trim() && (tab === "colors" || tab === "gradients");
  const gradientPreview = `linear-gradient(${gradientAngle}deg, ${gradientFrom}, ${gradientTo})`;

  function selectTab(next: CoverTab) {
    setTab(next);
    setQuery("");
    setCustomColorOpen(false);
    setGradientOpen(false);
  }

  async function upload(file: File | undefined) {
    setUploadError("");
    if (!file) return;
    if (!file.type.startsWith("image/") || !ACCEPTED_IMAGES.split(",").includes(file.type)) {
      setUploadError("Choose a PNG, JPG, GIF, WebP, AVIF or BMP image.");
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setUploadError("That image is larger than 12 MB. Choose a smaller one.");
      return;
    }
    setUploading(true);
    try {
      const data = await fileToBase64(file);
      const asset = await api.saveAsset(workspaceId, pageId, file.name, data);
      onPick(`upload:${asset.url}`);
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void upload(event.dataTransfer.files[0]);
  }

  const heading = tab === "images"
    ? { title: "Free photography", note: "Bundled offline · Unsplash License" }
    : tab === "colors"
      ? { title: "Colors", note: "A quiet wash for the page" }
      : { title: "Gradients", note: "Soft transitions, made in Noteral" };

  return (
    <Modal
      open={open}
      title={current ? "Change cover" : "Add cover"}
      subtitle="Choose photography, a color, a gradient, or an image of your own."
      onClose={onClose}
      width="large"
      className="appearance-modal cover-modal"
      bodyClassName="appearance-body cover-picker-body"
      footer={
        <>
          {current ? (
            <button type="button" className="text-button" onClick={() => onPick("")}>
              Remove cover
            </button>
          ) : <span />}
          <button type="button" className="secondary-button" onClick={onClose}>Done</button>
        </>
      }
    >
      <div className="appearance-tabs cover-tabs" role="tablist" aria-label="Cover source">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? "active" : ""}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab !== "upload" ? (
        <label className="picker-search appearance-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "images" ? "Search places and moods…" : tab === "colors" ? "Search colors…" : "Search gradients…"}
            aria-label="Search covers"
            spellCheck={false}
          />
          {query ? <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={13} /></button> : null}
        </label>
      ) : null}

      {tab === "upload" ? (
        <div
          className={`appearance-upload cover-upload ${dragging ? "dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <span className="upload-emblem"><ImagePlus size={26} /></span>
          <h3>A cover of your own</h3>
          <p>PNG, JPG, GIF, WebP, AVIF or BMP · up to 12 MB. Nothing leaves your machine.</p>
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPTED_IMAGES}
            hidden
            onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }}
          />
          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? <><LoaderCircle size={14} className="spin" /> Uploading…</> : <><Upload size={14} /> Choose image</>}
          </button>
          {uploadError ? <div className="appearance-error" role="alert">{uploadError}</div> : null}
        </div>
      ) : (
        <div className="appearance-scroll cover-scroll">
          <div className="cover-images-head">
            <h3>{query.trim() && tab === "images" ? `${filtered.length} images` : heading.title}</h3>
            <span>{query.trim() ? "Searching the offline collection" : heading.note}</span>
          </div>

          {showCustomCards && tab === "colors" && customColorOpen ? (
            <div className="cover-custom-panel">
              <div className="cover-custom-head">
                <span className="cover-custom-preview color" style={{ backgroundColor: customColor }} />
                <div>
                  <h3>Custom color</h3>
                  <p>Pick any color for a completely quiet cover.</p>
                </div>
                <button type="button" className="icon-button" onClick={() => setCustomColorOpen(false)} aria-label="Close custom color"><X size={15} /></button>
              </div>
              <div className="cover-custom-controls">
                <label className="cover-color-field">
                  <span>Color</span>
                  <input type="color" value={customColor} onChange={(event) => setCustomColor(event.target.value)} aria-label="Custom cover color" />
                  <code>{customColor}</code>
                </label>
              </div>
              <div className="cover-custom-actions">
                <button type="button" className="secondary-button" onClick={() => setCustomColorOpen(false)}>Cancel</button>
                <button type="button" className="primary-button" onClick={() => onPick(`color:${customColor}`)}>Use color</button>
              </div>
            </div>
          ) : null}

          {showCustomCards && tab === "gradients" && gradientOpen ? (
            <div className="cover-custom-panel">
              <div className="cover-custom-head">
                <span className="cover-custom-preview gradient" style={{ backgroundImage: gradientPreview }} />
                <div>
                  <h3>Custom gradient</h3>
                  <p>Blend two colors and turn the light.</p>
                </div>
                <button type="button" className="icon-button" onClick={() => setGradientOpen(false)} aria-label="Close custom gradient"><X size={15} /></button>
              </div>
              <div className="cover-custom-controls gradient-controls">
                <label className="cover-color-field">
                  <span>From</span>
                  <input type="color" value={gradientFrom} onChange={(event) => setGradientFrom(event.target.value)} aria-label="Gradient start color" />
                  <code>{gradientFrom}</code>
                </label>
                <label className="cover-color-field">
                  <span>To</span>
                  <input type="color" value={gradientTo} onChange={(event) => setGradientTo(event.target.value)} aria-label="Gradient end color" />
                  <code>{gradientTo}</code>
                </label>
                <label className="cover-angle-field">
                  <span>Angle</span>
                  <input type="range" min={0} max={360} value={gradientAngle} onChange={(event) => setGradientAngle(Number(event.target.value))} aria-label="Gradient angle" />
                  <code>{gradientAngle}°</code>
                </label>
              </div>
              <div className="cover-custom-actions">
                <button type="button" className="secondary-button" onClick={() => setGradientOpen(false)}>Cancel</button>
                <button type="button" className="primary-button" onClick={() => onPick(customGradientValue(gradientAngle, gradientFrom, gradientTo))}>Use gradient</button>
              </div>
            </div>
          ) : null}

          {filtered.length === 0 ? (
            <div className="appearance-empty">No covers match “{query}”. Try a mood like “calm”, “warm”, or “night”.</div>
          ) : (
            <div className={`cover-gallery ${tab === "colors" ? "colors" : tab === "gradients" ? "gradients" : ""}`}>
              {showCustomCards && tab === "colors" ? (
                <button
                  type="button"
                  className={`cover-option compact custom-color ${customColorSelected ? "selected" : ""}`}
                  style={{ backgroundImage: "conic-gradient(from 210deg, #f2b8a0, #f2d39a, #bcd6b1, #a8c6dd, #c0aedd, #e4aebd, #f2b8a0)" }}
                  onClick={() => { setGradientOpen(false); setCustomColorOpen((value) => !value); }}
                  aria-expanded={customColorOpen}
                  aria-label="Custom color"
                >
                  {customColorSelected ? <span className="cover-option-check"><Check size={13} /></span> : null}
                  <span className="cover-custom-plus"><Plus size={15} /></span>
                  <span className="cover-option-name">Custom color</span>
                </button>
              ) : null}
              {showCustomCards && tab === "gradients" ? (
                <button
                  type="button"
                  className={`cover-option compact custom-gradient ${customGradientSelected ? "selected" : ""}`}
                  style={{ backgroundImage: gradientPreview }}
                  onClick={() => { setCustomColorOpen(false); setGradientOpen((value) => !value); }}
                  aria-expanded={gradientOpen}
                  aria-label="Custom gradient"
                >
                  {customGradientSelected ? <span className="cover-option-check"><Check size={13} /></span> : null}
                  <span className="cover-custom-plus"><Plus size={15} /></span>
                  <span className="cover-option-name">Custom gradient</span>
                </button>
              ) : null}
              {filtered.map((option) => (
                <CoverCard
                  key={option.id}
                  option={option}
                  selected={option.value === currentBase}
                  compact={tab === "colors" || tab === "gradients"}
                  onPick={() => onPick(option.value)}
                />
              ))}
            </div>
          )}

          {current.startsWith("upload:") ? (
            <div className="cover-current-note">
              <span className="cover-current-dot" style={coverStyle(current)} />
              {coverName(current)} is set as this page’s cover.
            </div>
          ) : null}
          <div className="cover-credit">
            <Palette size={12} />
            Photography from Unsplash, bundled for offline use.
          </div>
        </div>
      )}
    </Modal>
  );
}
