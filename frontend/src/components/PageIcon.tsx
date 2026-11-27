import { createElement, type CSSProperties, type ReactNode } from "react";
import { safeImageLink } from "../lib/covers";
import { ICON_NODES } from "../lib/iconNodes";

interface PageIconProps {
  value: string | undefined;
  size?: number;
  className?: string;
  fallback?: ReactNode;
}

export type ParsedPageIcon =
  | { kind: "lucide"; name: string; color?: string }
  | { kind: "emoji"; char: string }
  | { kind: "image"; src: string };

export function kebabIconName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}

export function resolveIconName(name: string): string | undefined {
  if (ICON_NODES[name]) return name;
  const kebab = kebabIconName(name);
  return ICON_NODES[kebab] ? kebab : undefined;
}

export function parsePageIcon(value: string | undefined): ParsedPageIcon | null {
  const raw = (value ?? "").trim();
  // The original welcome page used a typographic sparkle. It is intentionally
  // retired so pages start clean; real emoji remain available in the picker.
  if (!raw || raw === "✦") return null;
  if (raw.startsWith("lucide:")) {
    const match = /^lucide:([^:]+)(?::(#[0-9a-fA-F]{6}))?$/.exec(raw);
    const name = match ? resolveIconName(match[1]) : undefined;
    return name ? { kind: "lucide", name, color: match?.[2] } : null;
  }
  if (raw.startsWith("emoji:")) return { kind: "emoji", char: raw.slice(6) };
  if (raw.startsWith("link:")) {
    const src = safeImageLink(raw.slice(5));
    return src ? { kind: "image", src } : null;
  }
  const asset = raw.startsWith("upload:") ? raw.slice(7) : raw;
  if (asset.startsWith("/__assets/") && !/["\\\n\r]/.test(asset)) return { kind: "image", src: asset };
  // Plugin contributions name icons plainly ("pencil-ruler"), as the SDK docs describe.
  if (/^[a-z][a-z0-9-]*$/.test(raw)) {
    const name = resolveIconName(raw);
    if (name) return { kind: "lucide", name };
  }
  if (raw.length <= 12 && !/[/:.]/.test(raw)) return { kind: "emoji", char: raw };
  return null;
}

export function IconGlyph({ name, size = 16, color, className = "" }: { name: string; size?: number; color?: string; className?: string }) {
  const resolved = resolveIconName(name);
  if (!resolved) return null;
  const nodes = ICON_NODES[resolved];
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color ?? "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {nodes.map(([tag, attrs], index) => createElement(tag, { ...attrs, key: index }))}
    </svg>
  );
}

export function PageIcon({ value, size = 16, className = "", fallback = null }: PageIconProps) {
  const parsed = parsePageIcon(value);
  if (!parsed) return <>{fallback}</>;

  if (parsed.kind === "lucide") {
    return (
      <span className={`page-icon page-icon-lucide ${className}`} style={{ color: parsed.color } as CSSProperties} aria-hidden="true">
        <IconGlyph name={parsed.name} size={size} />
      </span>
    );
  }

  if (parsed.kind === "emoji") {
    return (
      <span className={`page-icon page-icon-emoji ${className}`} style={{ fontSize: `${Math.round(size * 1.02)}px` }} aria-hidden="true">
        {parsed.char}
      </span>
    );
  }

  return (
    <span className={`page-icon page-icon-image ${className}`} aria-hidden="true">
      <img src={parsed.src} alt="" referrerPolicy="no-referrer" width={size} height={size} style={{ width: size, height: size }} />
    </span>
  );
}
