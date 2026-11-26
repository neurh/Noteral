import { useSyncExternalStore } from "react";
import { matchesShortcut, shortcutId, type Shortcut } from "./shortcuts";

export interface AppCommand {
  id: string;
  title: string;
  category: string;
  description?: string;
  keywords?: string;
  shortcut?: string;
  /** A key binding that runs the command (see lib/shortcuts.ts); `shortcut` is its label. */
  keys?: Shortcut;
  run: () => void | Promise<void>;
}

type Listener = () => void;

class CommandRegistry {
  private items = new Map<string, AppCommand>();
  private snapshot: AppCommand[] = [];
  private listeners = new Set<Listener>();

  register(command: AppCommand): () => void {
    this.items.set(command.id, command);
    this.changed();
    return () => this.unregister(command.id);
  }

  registerMany(commands: AppCommand[]): () => void {
    for (const command of commands) this.items.set(command.id, command);
    this.changed();
    return () => {
      for (const command of commands) this.unregister(command.id);
    };
  }

  unregister(id: string) {
    if (this.items.delete(id)) this.changed();
  }

  unregisterPrefix(prefix: string) {
    let changed = false;
    for (const id of [...this.items.keys()]) {
      if (id.startsWith(prefix)) {
        this.items.delete(id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  get(id: string): AppCommand | undefined {
    return this.items.get(id);
  }

  /** The command bound to this shortcut, other than `exceptId`. */
  boundTo(keys: Shortcut, exceptId?: string): AppCommand | undefined {
    const id = shortcutId(keys);
    return [...this.items.values()].find((command) => command.id !== exceptId && command.keys && shortcutId(command.keys) === id);
  }

  /** The command whose key binding this key press is. */
  forKeyEvent(event: KeyboardEvent): AppCommand | undefined {
    for (const command of this.items.values()) {
      if (command.keys && matchesShortcut(command.keys, event)) return command;
    }
    return undefined;
  }

  getSnapshot = (): AppCommand[] => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private changed() {
    this.snapshot = [...this.items.values()].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
    for (const listener of this.listeners) listener();
  }
}

export const commandRegistry = new CommandRegistry();

export function useCommands(): AppCommand[] {
  return useSyncExternalStore(commandRegistry.subscribe, commandRegistry.getSnapshot, commandRegistry.getSnapshot);
}
