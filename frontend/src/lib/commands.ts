import { useSyncExternalStore } from "react";

export interface AppCommand {
  id: string;
  title: string;
  category: string;
  description?: string;
  keywords?: string;
  shortcut?: string;
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
