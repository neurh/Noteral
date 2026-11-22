import { useEffect } from "react";
import { Events } from "@wailsio/runtime";
import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { api, errorMessage } from "./lib/api";
import { commandRegistry, type AppCommand } from "./lib/commands";
import { applyTheme, resolveTheme } from "./lib/theme";
import { useAppStore } from "./store";
import { useAppStore as store } from "./store";
import { PluginHost } from "./plugins/PluginHost";
import { TitleBar } from "./components/TitleBar";
import { Rail } from "./components/Rail";
import { LeftSidebar } from "./components/LeftSidebar";
import { EditorStack } from "./components/EditorStack";
import { RightSidebar } from "./components/RightSidebar";
import { StatusBar } from "./components/StatusBar";
import { Toasts } from "./components/Toasts";
import { CommandPalette } from "./components/CommandPalette";
import { WorkspaceDialog } from "./components/WorkspaceDialog";
import { LibraryDialog } from "./components/LibraryDialog";
import { PluginManager } from "./components/PluginManager";
import { SettingsDialog } from "./components/SettingsDialog";

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function makeCommands(): AppCommand[] {
  return [
    {
      id: "app.palette",
      title: "Command palette",
      category: "Navigation",
      description: "Find a page or run any command",
      keywords: "search find quick open",
      shortcut: "Ctrl/⌘ K",
      run: () => store.getState().setOverlay("palette"),
    },
    {
      id: "app.new-page",
      title: "New page",
      category: "Pages",
      description: "Create a page at the top level",
      keywords: "create note add",
      shortcut: "Ctrl/⌘ N",
      run: () => void store.getState().createPage(),
    },
    {
      id: "app.new-child-page",
      title: "New child page",
      category: "Pages",
      description: "Create a page inside the current page",
      keywords: "create nested",
      run: () => {
        const state = store.getState();
        void state.createPage(state.activePageId);
      },
    },
    {
      id: "app.new-tab",
      title: "New tab",
      category: "Tabs",
      description: "Open a fresh page in a new tab",
      keywords: "create",
      shortcut: "Ctrl/⌘ T",
      run: () => void store.getState().createPage(),
    },
    {
      id: "app.close-tab",
      title: "Close tab",
      category: "Tabs",
      description: "Save and close the active tab",
      keywords: "dismiss",
      shortcut: "Ctrl/⌘ W",
      run: () => {
        const state = store.getState();
        if (state.activePageId) void state.closeTab(state.activePageId);
      },
    },
    {
      id: "app.save",
      title: "Save now",
      category: "Pages",
      description: "Flush pending changes to the local database",
      keywords: "flush persist",
      shortcut: "Ctrl/⌘ S",
      run: () => {
        const state = store.getState();
        if (state.activePageId) void state.saveNow(state.activePageId);
      },
    },
    {
      id: "app.toggle-left",
      title: "Toggle sidebar",
      category: "View",
      description: "Show or hide the page sidebar",
      shortcut: "Ctrl/⌘ B",
      run: () => {
        const state = store.getState();
        state.updateSettings({ leftOpen: !state.settings.leftOpen });
      },
    },
    {
      id: "app.toggle-right",
      title: "Toggle inspector",
      category: "View",
      description: "Show or hide outline, backlinks, and page info",
      shortcut: "Ctrl/⌘ ⇧ B",
      run: () => {
        const state = store.getState();
        state.updateSettings({ rightOpen: !state.settings.rightOpen });
      },
    },
    {
      id: "app.library",
      title: "Search library",
      category: "Navigation",
      description: "Full-text search across this workspace",
      keywords: "find full text",
      run: () => store.getState().setOverlay("library"),
    },
    {
      id: "app.workspaces",
      title: "Switch workspace",
      category: "Workspaces",
      description: "Open, create, or rename a workspace",
      keywords: "library switch",
      run: () => store.getState().setOverlay("workspaces"),
    },
    {
      id: "app.plugins",
      title: "Manage plugins",
      category: "Plugins",
      description: "Install, enable, or remove sandboxed extensions",
      run: () => store.getState().setOverlay("plugins"),
    },
    {
      id: "app.settings",
      title: "Settings",
      category: "Noteral",
      description: "Appearance, storage, and keyboard shortcuts",
      run: () => store.getState().setOverlay("settings"),
    },
    {
      id: "app.toggle-favorite",
      title: "Toggle favorite",
      category: "Pages",
      description: "Pin or unpin the active page",
      keywords: "star bookmark",
      run: () => {
        const state = store.getState();
        if (state.activePageId) void state.toggleFavorite(state.activePageId);
      },
    },
    {
      id: "app.export-markdown",
      title: "Export page as Markdown",
      category: "Pages",
      description: "Save a readable Markdown copy with its attachments",
      keywords: "save download",
      run: async () => {
        const state = store.getState();
        if (!state.workspace || !state.activePageId) return;
        try {
          const result = await api.exportMarkdown(state.workspace.id, state.activePageId);
          if (result) state.notify(`Exported to ${result.path}`, "success");
        } catch (error) {
          state.notify(errorMessage(error), "error");
        }
      },
    },
    {
      id: "app.export-json",
      title: "Export page as JSON",
      category: "Pages",
      description: "Save the lossless BlockNote document and metadata",
      keywords: "backup save download",
      run: async () => {
        const state = store.getState();
        if (!state.workspace || !state.activePageId) return;
        try {
          const result = await api.exportJson(state.workspace.id, state.activePageId);
          if (result) state.notify(`Exported to ${result.path}`, "success");
        } catch (error) {
          state.notify(errorMessage(error), "error");
        }
      },
    },
    {
      id: "app.reload-page",
      title: "Reload page from disk",
      category: "Pages",
      description: "Discard local editor state and load the saved document",
      keywords: "refresh conflict",
      run: () => {
        const state = store.getState();
        if (state.activePageId) void state.reloadPage(state.activePageId);
      },
    },
    {
      id: "app.reveal-data",
      title: "Open data folder",
      category: "Noteral",
      description: "Show the portable Noteral library folder",
      run: () => void api.revealDataDir().catch((error) => store.getState().notify(errorMessage(error), "error")),
    },
  ];
}

export default function App() {
  const status = useAppStore((state) => state.status);
  const bootError = useAppStore((state) => state.bootError);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const activeTitle = useAppStore((state) => state.documents[state.activePageId]?.title ?? "Noteral");
  const bootstrapApp = useAppStore((state) => state.bootstrapApp);

  useEffect(() => {
    void bootstrapApp();
  }, [bootstrapApp]);

  useEffect(() => {
    const dispose = commandRegistry.registerMany(makeCommands());
    return dispose;
  }, []);

  useEffect(() => {
    document.title = activeTitle && activeTitle !== "Noteral" ? `${activeTitle} — Noteral` : "Noteral";
  }, [activeTitle]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      const state = store.getState();
      if (key === "k" || key === "p") {
        event.preventDefault();
        state.setOverlay("palette");
        return;
      }
      if (key === "s") {
        event.preventDefault();
        if (state.activePageId) void state.saveNow(state.activePageId);
        return;
      }
      if (key === "n" || key === "t") {
        event.preventDefault();
        void state.createPage();
      } else if (key === "w") {
        event.preventDefault();
        if (state.activePageId) void state.closeTab(state.activePageId);
      } else if (key === "b") {
        // Ctrl/Cmd+B is bold while writing; only toggle outside editable fields.
        if (isEditable(event.target) && !event.shiftKey) return;
        event.preventDefault();
        state.updateSettings(event.shiftKey ? { rightOpen: !state.settings.rightOpen } : { leftOpen: !state.settings.leftOpen });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const state = store.getState();
      if (state.settings.theme === "system") {
        const resolved = resolveTheme("system");
        applyTheme(resolved);
        store.setState({ resolvedTheme: resolved });
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const state = store.getState();
      if (window.innerWidth < 1100 && state.settings.rightOpen) state.updateSettings({ rightOpen: false }, false);
      if (window.innerWidth < 860 && state.settings.leftOpen) state.updateSettings({ leftOpen: false }, false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let dispose: (() => void) | undefined;
    try {
      dispose = Events.On("noteral:before-close", () => {
        void (async () => {
          try {
            await store.getState().saveAll();
          } finally {
            await api.flushDone();
          }
        })();
      });
    } catch (error) {
      console.warn("Could not subscribe to close event", error);
    }
    return () => dispose?.();
  }, []);

  if (status === "loading") {
    return (
      <div className="splash" role="status" aria-live="polite">
        <div className="splash-brand"><span aria-hidden="true">N</span></div>
        <h1>Noteral</h1>
        <p><LoaderCircle size={15} className="spin" /> Preparing your local library…</p>
      </div>
    );
  }

  if (status === "error" || !bootstrap) {
    return (
      <div className="fatal-screen" role="alert">
        <AlertTriangle size={28} />
        <h1>Noteral could not open its library.</h1>
        <p>{bootError || "The data folder is unavailable."}</p>
        <p className="fatal-hint">Check that the folder is writable, or start Noteral with <code>--data-dir &lt;path&gt;</code>.</p>
        <button type="button" className="primary-button" onClick={() => {
          useAppStore.setState({ status: "loading", bootError: "" });
          void bootstrapApp();
        }}>
          <RotateCcw size={15} /> Try again
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell" data-platform={bootstrap.platform}>
      <TitleBar />
      <div className="app-body">
        <Rail />
        <LeftSidebar />
        <div className="center-column">
          <EditorStack />
        </div>
        <RightSidebar />
      </div>
      <StatusBar />
      <PluginHost />
      <Toasts />
      <CommandPalette />
      <WorkspaceDialog />
      <LibraryDialog />
      <PluginManager />
      <SettingsDialog />
    </div>
  );
}
