/**
 * Files attached to a chat message: images (downscaled before sending), PDFs and text/code
 * files (inlined as text). Everything is read in the browser; nothing is uploaded anywhere
 * except to the chosen provider with the message.
 */
import type { Attachment } from "./types";

export const MAX_FILES = 8;
/** Per file, before encoding. */
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_BYTES = 12 * 1024 * 1024;
export const MAX_TEXT_BYTES = 512 * 1024;
/** Long edge for images sent to the model (providers downscale past ~1.5k anyway). */
const IMAGE_EDGE = 1568;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const TEXT_EXTENSIONS = new Set(
  "txt md markdown mdx csv tsv json jsonl yaml yml toml ini xml html htm css scss less js jsx ts tsx mjs cjs py rb go rs java kt swift c h cpp hpp cs php sh bash zsh sql graphql vue svelte log env conf cfg tex rst org".split(" "),
);

/** The accept attribute for the file picker. */
export const ACCEPT = [...IMAGE_TYPES, "application/pdf", "text/*", ...[...TEXT_EXTENSIONS].map((ext) => `.${ext}`)].join(",");

function extension(name: string): string {
  const at = name.lastIndexOf(".");
  return at >= 0 ? name.slice(at + 1).toLowerCase() : "";
}

export function kindOf(file: { name: string; type: string }): Attachment["kind"] | null {
  if (IMAGE_TYPES.includes(file.type)) return "image";
  if (file.type === "application/pdf" || extension(file.name) === "pdf") return "pdf";
  if (file.type.startsWith("text/") || file.type === "application/json" || TEXT_EXTENSIONS.has(extension(file.name))) return "text";
  return null;
}

const newId = () => `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image couldn't be read."));
    };
    image.src = url;
  });
}

/** Downscales large images and re-encodes them (JPEG for photos, PNG when it has transparency). */
async function encodeImage(file: File): Promise<{ mime: string; data: string; size: number }> {
  if (file.type === "image/gif" || (file.size < 900 * 1024 && file.type !== "image/webp")) {
    const image = await loadImage(file).catch(() => null);
    if (!image || Math.max(image.naturalWidth, image.naturalHeight) <= IMAGE_EDGE) {
      return { mime: file.type, data: base64(await file.arrayBuffer()), size: file.size };
    }
  }
  const image = await loadImage(file);
  const scale = Math.min(1, IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { mime: file.type, data: base64(await file.arrayBuffer()), size: file.size };
  context.drawImage(image, 0, 0, width, height);
  const keepAlpha = file.type === "image/png" && hasAlpha(context, width, height);
  const mime = keepAlpha ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.86));
  if (!blob) return { mime: file.type, data: base64(await file.arrayBuffer()), size: file.size };
  return { mime, data: base64(await blob.arrayBuffer()), size: blob.size };
}

function hasAlpha(context: CanvasRenderingContext2D, width: number, height: number): boolean {
  // Sample a grid instead of every pixel.
  const step = Math.max(1, Math.floor(Math.min(width, height) / 40));
  const { data } = context.getImageData(0, 0, width, height);
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) if (data[(y * width + x) * 4 + 3] < 250) return true;
  return false;
}

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

/** Reads a picked, dropped or pasted file. Throws a readable message when it can't be attached. */
export async function readAttachment(file: File): Promise<Attachment> {
  const kind = kindOf(file);
  const name = file.name || (kind === "image" ? "Pasted image" : "file");
  if (!kind) throw new Error(`"${name}" can't be attached. Images, PDFs and text or code files work.`);
  if (kind === "image") {
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`"${name}" is larger than ${mb(MAX_IMAGE_BYTES)}.`);
    const encoded = await encodeImage(file);
    return { id: newId(), name, mime: encoded.mime, size: encoded.size, kind, data: encoded.data };
  }
  if (kind === "pdf") {
    if (file.size > MAX_PDF_BYTES) throw new Error(`"${name}" is larger than ${mb(MAX_PDF_BYTES)}.`);
    return { id: newId(), name, mime: "application/pdf", size: file.size, kind, data: base64(await file.arrayBuffer()) };
  }
  if (file.size > MAX_TEXT_BYTES) throw new Error(`"${name}" is larger than ${Math.round(MAX_TEXT_BYTES / 1024)} KB. Attach a smaller part of it.`);
  const text = await file.text();
  if (/\u0000/.test(text.slice(0, 4096))) throw new Error(`"${name}" looks like a binary file.`);
  return { id: newId(), name, mime: file.type || "text/plain", size: file.size, kind, data: text };
}

/** "12 KB", "1.4 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Whether a drag carries files from the system (not pages from the app). */
export function hasFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && [...transfer.types].includes("Files"));
}
