/// <reference lib="webworker" />
// Runs one AsciiEngine off the main thread on transferred OffscreenCanvases.

import { AsciiEngine, type EngineOptions } from "./asciiEngine";

export type AsciiWorkerMessage =
  | { type: "init"; glyph: OffscreenCanvas; back: OffscreenCanvas; options: EngineOptions; width: number; height: number; dpr: number; playing: boolean }
  | { type: "resize"; width: number; height: number; dpr: number }
  | { type: "options"; options: Partial<EngineOptions> }
  | { type: "play"; playing: boolean }
  | { type: "pointer"; x: number; y: number; inside: boolean }
  | { type: "tap"; x: number; y: number }
  | { type: "destroy" };

let engine: AsciiEngine | null = null;

self.onmessage = (event: MessageEvent<AsciiWorkerMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      engine = new AsciiEngine(message.glyph, message.back, message.options);
      engine.resize(message.width, message.height, message.dpr);
      engine.setPlaying(message.playing);
      break;
    case "resize":
      engine?.resize(message.width, message.height, message.dpr);
      break;
    case "options":
      engine?.setOptions(message.options);
      break;
    case "play":
      engine?.setPlaying(message.playing);
      break;
    case "pointer":
      engine?.pointer(message.x, message.y, message.inside);
      break;
    case "tap":
      engine?.tap(message.x, message.y);
      break;
    case "destroy":
      engine?.destroy();
      engine = null;
      self.close();
      break;
  }
};
