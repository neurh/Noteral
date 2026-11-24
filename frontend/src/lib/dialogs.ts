/**
 * Host-rendered dialogs (confirm, prompt, pick, ask) shared by plugins
 * (`ui.confirm` / `ui.prompt` / `ui.pick`), the assistant's approval gate and
 * the plugin store's permission review. Rendered by <HostDialogs />.
 */
import { useSyncExternalStore } from "react";

export interface ConfirmRequest {
  kind: "confirm";
  title: string;
  message?: string;
  /** Optional bullet list shown under the message (e.g. permissions). */
  details?: { label: string; description?: string; tone?: "danger" | "normal" }[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Who is asking, e.g. "Plugin · Reading time" or "Assistant". */
  source?: string;
}

export interface PromptRequest {
  kind: "prompt";
  title: string;
  message?: string;
  placeholder?: string;
  value?: string;
  multiline?: boolean;
  confirmLabel?: string;
  source?: string;
}

export interface PickItem {
  id: string;
  label: string;
  description?: string;
}

export interface PickRequest {
  kind: "pick";
  title: string;
  items: PickItem[];
  source?: string;
}

export interface AskRequest {
  kind: "ask";
  question: string;
  options: PickItem[];
  multiple?: boolean;
  allowText?: boolean;
  placeholder?: string;
  source?: string;
}

export interface AskAnswer {
  answer: string;
  choices: string[];
  cancelled: boolean;
}

export type DialogRequest = ConfirmRequest | PromptRequest | PickRequest | AskRequest;

export interface OpenDialog {
  id: number;
  request: DialogRequest;
  resolve: (value: unknown) => void;
}

let queue: OpenDialog[] = [];
let sequence = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function open<T>(request: DialogRequest): Promise<T> {
  if (queue.length > 20) return Promise.reject(new Error("Too many dialogs are waiting"));
  return new Promise<T>((resolve) => {
    sequence += 1;
    queue = [...queue, { id: sequence, request, resolve: resolve as (value: unknown) => void }];
    emit();
  });
}

export const dialogs = {
  confirm: (request: Omit<ConfirmRequest, "kind">) => open<boolean>({ ...request, kind: "confirm" }),
  prompt: (request: Omit<PromptRequest, "kind">) => open<string | null>({ ...request, kind: "prompt" }),
  pick: (request: Omit<PickRequest, "kind">) => open<string | null>({ ...request, kind: "pick" }),
  /** Resolves with { cancelled: true } when dismissed. */
  ask: (request: Omit<AskRequest, "kind">) => open<AskAnswer | null>({ ...request, kind: "ask" }).then((value) => value ?? { answer: "", choices: [], cancelled: true }),
  /** Settle the front dialog. Cancel values: confirm → false, others → null. */
  settle(id: number, value: unknown) {
    const dialog = queue.find((item) => item.id === id);
    if (!dialog) return;
    queue = queue.filter((item) => item.id !== id);
    dialog.resolve(value);
    emit();
  },
  cancelAll() {
    const pending = queue;
    queue = [];
    for (const dialog of pending) dialog.resolve(dialog.request.kind === "confirm" ? false : null);
    emit();
  },
  current: (): OpenDialog | null => queue[0] ?? null,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCurrentDialog(): OpenDialog | null {
  return useSyncExternalStore(dialogs.subscribe, dialogs.current, dialogs.current);
}
