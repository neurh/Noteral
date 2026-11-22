import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ImagePlus, LoaderCircle, Search, Shapes, Shuffle, Smile, Upload, X } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { fileToBase64 } from "../lib/base64";
import { EMOJI, EMOJI_GROUPS, emojiGroupLabel, emojiSkins, type EmojiEntry } from "../lib/emoji";
import { ICON_NODES } from "../lib/iconNodes";
import { IconGlyph, parsePageIcon } from "./PageIcon";
import { Modal } from "./Modal";

const ICON_NAMES = Object.keys(ICON_NODES).sort();
const ICON_COLORS = ["#b1533d", "#c68d4d", "#7f825c", "#4f6555", "#4b7187", "#6f4c63", "#8d5558", "#64727d", "#6b5142", "#8b8174", "#2c2822", "#d4765c"];
const RECENT_ICONS_KEY = "noteral.recentIcons.v1";
const RECENT_EMOJI_KEY = "noteral.recentEmoji.v1";
const RECENT_LIMIT = 16;

function readRecent(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function rememberRecent(key: string, value: string): string[] {
  const next = [value, ...readRecent(key).filter((item) => item !== value)].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in restricted webviews; the picker still works.
  }
  return next;
}

const ACCEPTED_IMAGES = "image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp";
const MAX_UPLOAD = 8 * 1024 * 1024;
const PAGE_SIZE = 144;

function iconLabel(name: string): string {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function normalizeIconSearch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function useIncremental(total: number, resetKey: string) {
  const [count, setCount] = useState(PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCount(PAGE_SIZE);
  }, [resetKey]);

  useEffect(() => {
    if (count >= total) return;
    const node = sentinel.current;
    if (!node) return;
    const root = node.closest(".appearance-scroll") as Element | null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setCount((current) => Math.min(total, current + PAGE_SIZE));
        }
      },
      { root, rootMargin: "480px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [count, total, resetKey]);

  function showMore() {
    setCount((current) => Math.min(total, current + PAGE_SIZE));
  }

  return { count: Math.min(count, total), sentinel, showMore };
}

type PopoverState =
  | { kind: "color"; name: string; rect: DOMRect; current: string }
  | { kind: "skin"; emoji: EmojiEntry; rect: DOMRect; current: string };

function ColorPopover({ state, onPick, onClose }: { state: Extract<PopoverState, { kind: "color" }>; onPick: (value: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = 238;
  const height = 154;
  const left = Math.min(Math.max(12, state.rect.left + state.rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const top = state.rect.bottom + height + 12 > window.innerHeight ? Math.max(12, state.rect.top - height - 10) : state.rect.bottom + 10;
  const current = parsePageIcon(state.current);
  const currentColor = current?.kind === "lucide" ? current.color : undefined;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="appearance-popover color-popover" style={{ left, top, width }} role="dialog" aria-label="Choose icon color">
      <div className="color-popover-head">
        <span className="color-preview" style={{ color: currentColor }}>
          <IconGlyph name={state.name} size={21} />
        </span>
        <div>
          <strong>Icon color</strong>
          <span>Pick a tint, or keep the ink.</span>
        </div>
      </div>
      <div className="color-swatches">
        <button type="button" className={`color-swatch auto ${!currentColor ? "selected" : ""}`} onClick={() => onPick(`lucide:${state.name}`)} title="Default ink" aria-label="Default ink">
          <Check size={13} />
        </button>
        {ICON_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`color-swatch ${currentColor === color ? "selected" : ""}`}
            style={{ background: color }}
            onClick={() => onPick(`lucide:${state.name}:${color}`)}
            title={color}
            aria-label={`Use ${color}`}
          />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function SkinPopover({ state, onPick, onClose }: { state: Extract<PopoverState, { kind: "skin" }>; onPick: (value: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const skins = emojiSkins(state.emoji);
  const width = Math.min(286, 64 + skins.length * 43);
  const left = Math.min(Math.max(12, state.rect.left + state.rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const top = state.rect.bottom + 102 > window.innerHeight ? Math.max(12, state.rect.top - 92) : state.rect.bottom + 8;

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="appearance-popover skin-popover" style={{ left, top, width }} role="dialog" aria-label="Choose skin tone">
      <div className="skin-popover-title">Skin tone</div>
      <div className="skin-options">
        {skins.map((skin) => (
          <button
            key={skin.name}
            type="button"
            className={`skin-option ${state.current === skin.char ? "selected" : ""}`}
            onClick={() => onPick(`emoji:${skin.char}`)}
            title={skin.name}
            aria-label={skin.name}
          >
            {skin.char}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

interface IconPickerDialogProps {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
  pageId: string;
  current: string;
  onPick: (value: string) => void;
}

export function IconPickerDialog({ open, onClose, workspaceId, pageId, current, onPick }: IconPickerDialogProps) {
  const [tab, setTab] = useState<"icons" | "emoji" | "upload">("icons");
  const [query, setQuery] = useState("");
  const [emojiGroup, setEmojiGroup] = useState<number | "all">("all");
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [recentIcons, setRecentIcons] = useState<string[]>(() => readRecent(RECENT_ICONS_KEY));
  const [recentEmoji, setRecentEmoji] = useState<string[]>(() => readRecent(RECENT_EMOJI_KEY));
  const fileInput = useRef<HTMLInputElement>(null);
  const parsed = parsePageIcon(current);
  const selectedEmoji = parsed?.kind === "emoji" ? parsed.char : "";

  useEffect(() => {
    if (!open) return;
    setTab("icons");
    setQuery("");
    setEmojiGroup("all");
    setPopover(null);
    setUploadError("");
  }, [open]);

  const iconResults = useMemo(() => {
    const needle = normalizeIconSearch(query);
    if (!needle) return ICON_NAMES;
    return ICON_NAMES.filter((name) => normalizeIconSearch(name).includes(needle));
  }, [query]);

  const icons = useIncremental(iconResults.length, `icons:${query}`);

  const visibleRecentIcons = useMemo(() => {
    const seen = new Set<string>();
    return recentIcons.filter((value) => {
      const recent = parsePageIcon(value);
      if (!recent || recent.kind === "image") return false;
      const key = recent.kind === "lucide" ? `lucide:${recent.name}` : `emoji:${recent.char}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [recentIcons]);

  const emojiResults = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle) return EMOJI.filter((entry) => entry.search.includes(needle));
    return emojiGroup === "all" ? EMOJI : EMOJI.filter((entry) => entry.group === emojiGroup);
  }, [emojiGroup, query]);

  const chooseIcon = (name: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const sameIcon = parsed?.kind === "lucide" && parsed.name === name;
    setPopover({ kind: "color", name, rect, current: sameIcon ? current : "" });
  };

  const chooseEmoji = (emoji: EmojiEntry, event: React.MouseEvent<HTMLButtonElement>) => {
    if (!emoji.skins.length) {
      const value = `emoji:${emoji.unicode}`;
      setRecentEmoji(rememberRecent(RECENT_EMOJI_KEY, value));
      onPick(value);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setPopover({ kind: "skin", emoji, rect, current: parsed?.kind === "emoji" ? parsed.char : "" });
  };

  function rememberIcon(value: string) {
    setRecentIcons(rememberRecent(RECENT_ICONS_KEY, value));
  }

  function rememberEmoji(value: string) {
    setRecentEmoji(rememberRecent(RECENT_EMOJI_KEY, value));
  }

  function pickRecentIcon(value: string) {
    rememberIcon(value);
    onPick(value);
  }

  function pickRecentEmoji(value: string) {
    rememberEmoji(value);
    onPick(value);
  }

  function pickRandom() {
    setPopover(null);
    if (tab === "emoji") {
      if (!emojiResults.length) return;
      const emoji = emojiResults[Math.floor(Math.random() * emojiResults.length)];
      const value = `emoji:${emoji.unicode}`;
      rememberEmoji(value);
      onPick(value);
      return;
    }
    if (!iconResults.length) return;
    const name = iconResults[Math.floor(Math.random() * iconResults.length)];
    const color = parsed?.kind === "lucide" && parsed.color ? `:${parsed.color}` : "";
    const value = `lucide:${name}${color}`;
    rememberIcon(value);
    onPick(value);
  }

  async function upload(file: File | undefined) {
    setUploadError("");
    if (!file) return;
    if (!file.type.startsWith("image/") || !ACCEPTED_IMAGES.split(",").includes(file.type)) {
      setUploadError("Choose a PNG, JPG, GIF, WebP, AVIF or BMP image.");
      return;
    }
    if (file.size > MAX_UPLOAD) {
      setUploadError("That image is larger than 8 MB. Choose a smaller one.");
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

  const title = current ? "Change icon" : "Add icon";
  return (
    <>
      <Modal
        open={open}
        title={title}
        subtitle="A small mark for this page — icon, emoji, or your own image."
        onClose={onClose}
        width="large"
        className="appearance-modal icon-modal"
        bodyClassName="appearance-body"
        footer={
          <>
            {current ? (
              <button type="button" className="text-button" onClick={() => onPick("")}>
                Remove icon
              </button>
            ) : <span />}
            <button type="button" className="secondary-button" onClick={onClose}>Done</button>
          </>
        }
      >
        <div className="appearance-tabs" role="tablist" aria-label="Icon source">
          <button type="button" role="tab" aria-selected={tab === "icons"} className={tab === "icons" ? "active" : ""} onClick={() => { setTab("icons"); setPopover(null); }}>
            <Shapes size={15} /> Icons
          </button>
          <button type="button" role="tab" aria-selected={tab === "emoji"} className={tab === "emoji" ? "active" : ""} onClick={() => { setTab("emoji"); setPopover(null); }}>
            <Smile size={15} /> Emoji
          </button>
          <button type="button" role="tab" aria-selected={tab === "upload"} className={tab === "upload" ? "active" : ""} onClick={() => { setTab("upload"); setPopover(null); }}>
            <Upload size={15} /> Upload
          </button>
        </div>

        {tab !== "upload" ? (
          <div className="appearance-search-row">
            <label className="picker-search appearance-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tab === "icons" ? `Search ${ICON_NAMES.length.toLocaleString()} icons…` : "Search all emoji…"}
                aria-label={tab === "icons" ? "Search icons" : "Search emoji"}
                spellCheck={false}
              />
              {query ? <button type="button" className="search-clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={13} /></button> : null}
            </label>
            <button
              type="button"
              className="appearance-random"
              onClick={pickRandom}
              title={tab === "icons" ? "Pick a random icon" : "Pick a random emoji"}
              aria-label={tab === "icons" ? "Pick a random icon" : "Pick a random emoji"}
            >
              <Shuffle size={15} />
            </button>
          </div>
        ) : null}

        {tab === "icons" ? (
          <div
            className="appearance-scroll"
            onScroll={(event) => {
              const node = event.currentTarget;
              if (node.scrollHeight - node.scrollTop - node.clientHeight < 320) icons.showMore();
            }}
          >
            {!query.trim() && visibleRecentIcons.length ? (
              <section className="appearance-section">
                <h3>Recently used</h3>
                <div className="recent-strip">
                  {visibleRecentIcons.map((value) => {
                    const recent = parsePageIcon(value);
                    if (!recent || recent.kind === "image") return null;
                    const selected = recent.kind === "lucide" && parsed?.kind === "lucide" && parsed.name === recent.name;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`appearance-icon-cell ${selected ? "selected" : ""}`}
                        onClick={() => pickRecentIcon(value)}
                        title={recent.kind === "lucide" ? iconLabel(recent.name) : recent.char}
                        aria-label={recent.kind === "lucide" ? iconLabel(recent.name) : recent.char}
                      >
                        {recent.kind === "lucide" ? <IconGlyph name={recent.name} size={19} color={recent.color} /> : <span className="recent-emoji">{recent.char}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section className="appearance-section">
              <h3>{query.trim() ? `${iconResults.length} results` : "All icons"}</h3>
              {iconResults.length === 0 ? <div className="appearance-empty">No icons match “{query}”.</div> : (
                <>
                  <div className="icon-grid">
                    {iconResults.slice(0, icons.count).map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={`appearance-icon-cell ${parsed?.kind === "lucide" && parsed.name === name ? "selected" : ""}`}
                        onClick={(event) => chooseIcon(name, event)}
                        title={iconLabel(name)}
                        aria-label={iconLabel(name)}
                      >
                        <IconGlyph name={name} size={19} />
                      </button>
                    ))}
                  </div>
                  {icons.count < iconResults.length ? <div ref={icons.sentinel} className="appearance-sentinel"><LoaderCircle size={14} className="spin" /></div> : null}
                </>
              )}
            </section>
          </div>
        ) : null}

        {tab === "emoji" ? (
          <div className="appearance-scroll">
            {!query.trim() ? (
              <div className="emoji-groups" role="tablist" aria-label="Emoji categories">
                <button type="button" className={emojiGroup === "all" ? "active" : ""} onClick={() => setEmojiGroup("all")}>All</button>
                {EMOJI_GROUPS.map((group) => (
                  <button key={group.order} type="button" className={emojiGroup === group.order ? "active" : ""} onClick={() => setEmojiGroup(group.order)}>
                    {group.label}
                  </button>
                ))}
              </div>
            ) : null}
            {!query.trim() && recentEmoji.length ? (
              <section className="appearance-section">
                <h3>Recently used</h3>
                <div className="recent-strip">
                  {recentEmoji.map((value) => {
                    const char = value.startsWith("emoji:") ? value.slice(6) : value;
                    return (
                      <button
                        key={value}
                        type="button"
                        className={`appearance-emoji-cell ${selectedEmoji === char ? "selected" : ""}`}
                        onClick={() => pickRecentEmoji(value)}
                        title={char}
                        aria-label={`Recently used emoji ${char}`}
                      >
                        {char}
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : null}
            <section className="appearance-section">
              <h3>{query.trim() ? `${emojiResults.length} results` : emojiGroup === "all" ? "All emoji" : emojiGroupLabel(emojiGroup)}</h3>
              {emojiResults.length === 0 ? <div className="appearance-empty">No emoji match “{query}”.</div> : (
                <>
                  <div className="emoji-grid">
                    {emojiResults.map((emoji) => (
                      <button
                        key={emoji.hexcode}
                        type="button"
                        className={`appearance-emoji-cell ${selectedEmoji === emoji.unicode || emoji.skins.some((skin) => skin.unicode === selectedEmoji) ? "selected" : ""}`}
                        onClick={(event) => chooseEmoji(emoji, event)}
                        title={emoji.label}
                        aria-label={emoji.label}
                      >
                        {emoji.unicode}
                        {emoji.skins.length ? <span className="emoji-skin-dot" /> : null}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>
        ) : null}

        {tab === "upload" ? (
          <div
            className={`appearance-upload ${dragging ? "dragging" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={drop}
          >
            <span className="upload-emblem"><ImagePlus size={25} /></span>
            <h3>Use your own image</h3>
            <p>PNG, JPG, GIF, WebP, AVIF or BMP · up to 8 MB. It stays in this workspace.</p>
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
        ) : null}
      </Modal>

      {popover?.kind === "color" ? (
        <ColorPopover state={popover} onClose={() => setPopover(null)} onPick={(value) => { setPopover(null); rememberIcon(value); onPick(value); }} />
      ) : null}
      {popover?.kind === "skin" ? (
        <SkinPopover state={popover} onClose={() => setPopover(null)} onPick={(value) => { setPopover(null); rememberEmoji(value); onPick(value); }} />
      ) : null}
    </>
  );
}
