import { useEffect, useRef } from "react";
import type { HomeAsciiBackground } from "../../lib/home";
import { AsciiEngine, type EngineOptions } from "./asciiEngine";
import type { AsciiWorkerMessage } from "./asciiWorker";

interface AsciiCanvasProps {
  scene: HomeAsciiBackground;
  speed?: number;
  ink?: string;
  /** Whether the animation may run. A still frame is drawn regardless. */
  playing: boolean;
  fontSize?: number;
  maxFps?: number;
  className?: string;
  seed?: number;
  /** Render in a Web Worker when the browser supports OffscreenCanvas. */
  offThread?: boolean;
  /**
   * React to the pointer anywhere over the canvas, even through content laid
   * on top: hover lights the scene, clicks on empty space send a ripple.
   */
  interactive?: boolean;
}

/** Clicks on these never ripple the background. */
const UI_TARGET =
  'a, button, input, textarea, select, label, summary, [role="button"], [role="menu"], [role="menuitem"], [role="dialog"], [role="radio"], [role="tab"], [contenteditable="true"], .hw, .home-card, .home-inspector, .page-header';

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

let monoStack: string | null = null;
function monoFont(): string {
  if (monoStack === null) {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    monoStack = value || '"SFMono-Regular", Menlo, Consolas, monospace';
  }
  return monoStack;
}

function canUseWorker(): boolean {
  try {
    return (
      typeof Worker !== "undefined" &&
      typeof OffscreenCanvas !== "undefined" &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === "function" &&
      new OffscreenCanvas(1, 1).getContext("2d") !== null
    );
  } catch {
    return false;
  }
}

interface Host {
  resize(width: number, height: number, dpr: number): void;
  options(patch: Partial<EngineOptions>): void;
  play(playing: boolean): void;
  pointer(x: number, y: number, inside: boolean): void;
  tap(x: number, y: number): void;
  destroy(): void;
}

function workerHost(glyph: HTMLCanvasElement, back: HTMLCanvasElement, options: EngineOptions, width: number, height: number, dpr: number): Host | null {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./asciiWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
  const glyphOff = glyph.transferControlToOffscreen();
  const backOff = back.transferControlToOffscreen();
  const send = (message: AsciiWorkerMessage, transfer: Transferable[] = []) => worker.postMessage(message, transfer);
  send({ type: "init", glyph: glyphOff, back: backOff, options, width, height, dpr, playing: false }, [glyphOff, backOff]);
  return {
    resize: (w, h, d) => send({ type: "resize", width: w, height: h, dpr: d }),
    options: (patch) => send({ type: "options", options: patch }),
    play: (playing) => send({ type: "play", playing }),
    pointer: (x, y, inside) => send({ type: "pointer", x, y, inside }),
    tap: (x, y) => send({ type: "tap", x, y }),
    destroy: () => {
      send({ type: "destroy" });
      // Give the worker a moment to stop its loop, then make sure it is gone.
      setTimeout(() => worker.terminate(), 250);
    },
  };
}

function mainHost(glyph: HTMLCanvasElement, back: HTMLCanvasElement, options: EngineOptions, width: number, height: number, dpr: number): Host {
  const engine = new AsciiEngine(glyph, back, options);
  engine.resize(width, height, dpr);
  return {
    resize: (w, h, d) => engine.resize(w, h, d),
    options: (patch) => engine.setOptions(patch),
    play: (playing) => engine.setPlaying(playing),
    pointer: (x, y, inside) => engine.pointer(x, y, inside),
    tap: (x, y) => engine.tap(x, y),
    destroy: () => engine.destroy(),
  };
}

/**
 * Hosts one ASCII wallpaper. React only forwards option changes; the loop runs
 * outside React (in a worker when possible) and stops whenever the canvas is
 * offscreen, the window is hidden, `playing` is false, or the user prefers
 * reduced motion.
 */
export function AsciiCanvas({ scene, speed = 1, ink, playing, fontSize = 13, maxFps = 24, className, seed = 7, offThread = false, interactive = false }: AsciiCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glyphRef = useRef<HTMLCanvasElement>(null);
  const backRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<Host | null>(null);
  const visibleRef = useRef(true);
  const playingRef = useRef(playing);
  const runningRef = useRef(false);
  playingRef.current = playing;

  const sync = () => {
    const host = hostRef.current;
    if (!host) return;
    const run = playingRef.current && visibleRef.current && !document.hidden && !prefersReducedMotion();
    if (run === runningRef.current) return;
    runningRef.current = run;
    host.play(run);
  };

  useEffect(() => {
    const wrap = wrapRef.current;
    const glyph = glyphRef.current;
    const back = backRef.current;
    if (!wrap || !glyph || !back) return;
    const rect = wrap.getBoundingClientRect();
    const options: EngineOptions = { scene, speed, ink, fontSize, maxFps, seed, fontFamily: monoFont() };
    const dpr = window.devicePixelRatio || 1;
    const host = (offThread && canUseWorker() && workerHost(glyph, back, options, rect.width, rect.height, dpr)) || mainHost(glyph, back, options, rect.width, rect.height, dpr);
    hostRef.current = host;
    runningRef.current = false;

    let frame = 0;
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = wrap.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) host.resize(r.width, r.height, window.devicePixelRatio || 1);
      });
    });
    resize.observe(wrap);
    const visibility = new IntersectionObserver((entries) => {
      visibleRef.current = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    visibility.observe(wrap);
    const onChange = () => sync();
    document.addEventListener("visibilitychange", onChange);
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    motion?.addEventListener?.("change", onChange);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener("visibilitychange", onChange);
      motion?.removeEventListener?.("change", onChange);
      host.destroy();
      hostRef.current = null;
    };
    // The host is created once per mount (canvases can only be transferred once);
    // option changes flow through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    hostRef.current?.options({ scene, speed, ink, fontSize, maxFps });
  }, [scene, speed, ink, fontSize, maxFps]);

  useEffect(() => {
    sync();
  });

  // Pointer input. Content sits above the canvas, so listen on the window and
  // map into the canvas rect; moves are coalesced to one message per frame.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!interactive || !wrap) return;
    let rect = wrap.getBoundingClientRect();
    let pending: { x: number; y: number; inside: boolean } | null = null;
    let raf = 0;
    let inside = false;
    const flush = () => {
      raf = 0;
      if (pending && runningRef.current) hostRef.current?.pointer(pending.x, pending.y, pending.inside);
      pending = null;
    };
    const queue = (x: number, y: number, isInside: boolean) => {
      pending = { x, y, inside: isInside };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onMove = (event: PointerEvent) => {
      if (!runningRef.current || event.pointerType === "touch") return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const now = x >= 0 && y >= 0 && x < rect.width && y < rect.height;
      if (!now && !inside) return;
      inside = now;
      queue(x, y, now);
    };
    const onLeave = () => {
      if (!inside) return;
      inside = false;
      queue(0, 0, false);
    };
    const onDown = (event: PointerEvent) => {
      if (!runningRef.current || event.button !== 0) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return;
      const target = event.target as Element | null;
      if (target?.closest?.(UI_TARGET)) return;
      hostRef.current?.tap(x, y);
    };
    const measure = () => {
      rect = wrap.getBoundingClientRect();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave, { passive: true });
    window.addEventListener("blur", onLeave);
    window.addEventListener("scroll", measure, { passive: true, capture: true });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("scroll", measure, { capture: true });
      hostRef.current?.pointer(0, 0, false);
    };
  }, [interactive]);

  return (
    <div ref={wrapRef} className={className ? `ascii-canvas ${className}` : "ascii-canvas"} aria-hidden="true">
      <canvas ref={backRef} />
      <canvas ref={glyphRef} />
    </div>
  );
}
