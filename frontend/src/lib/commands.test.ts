import { describe, expect, it, vi } from "vitest";
import { commandRegistry, type AppCommand } from "./commands";

const prefix = "test.registry.";

function command(id: string, title: string, category: string): AppCommand {
  return { id: prefix + id, title, category, run: () => undefined };
}

describe("command registry", () => {
  it("registers, sorts, notifies and unregisters", () => {
    const listener = vi.fn();
    const unsubscribe = commandRegistry.subscribe(listener);
    const dispose = commandRegistry.registerMany([
      command("b", "Zebra", "Writing"),
      command("a", "Alpha", "Navigation"),
    ]);
    const visible = commandRegistry.getSnapshot().filter((item) => item.id.startsWith(prefix));
    expect(visible.map((item) => item.title)).toEqual(["Alpha", "Zebra"]);
    expect(commandRegistry.get(prefix + "a")?.category).toBe("Navigation");
    expect(listener).toHaveBeenCalled();

    dispose();
    expect(commandRegistry.getSnapshot().some((item) => item.id.startsWith(prefix))).toBe(false);
    unsubscribe();
  });

  it("removes plugin commands by prefix", () => {
    commandRegistry.registerMany([command("x", "One", "Plugins"), command("y", "Two", "Plugins")]);
    commandRegistry.unregisterPrefix(prefix);
    expect(commandRegistry.getSnapshot().some((item) => item.id.startsWith(prefix))).toBe(false);
  });
});
