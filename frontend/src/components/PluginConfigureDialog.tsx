import { useEffect } from "react";
import { commandRegistry } from "../lib/commands";
import { pluginConfigure, usePluginConfigure } from "../lib/pluginConfigure";
import { optionFields } from "../lib/pluginOptions";
import { useContributions } from "../lib/contributions";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { PluginOptions, usePluginOptionFields } from "./PluginOptions";
import { ViewFrame } from "./ViewFrame";
import type { Manifest } from "../lib/api";

/** True when a plugin has something to configure (fields or a custom options page). */
export function canConfigure(manifest: Manifest): boolean {
  return optionFields(manifest).length > 0 || pluginConfigure.hasPage(manifest.id);
}

function ConfigureBody({ manifest }: { manifest: Manifest }) {
  const fields = usePluginOptionFields(manifest);
  usePluginConfigure();
  const page = pluginConfigure.page(manifest.id);
  const showFields = fields.length > 0 && (!page || page.showFields !== false);
  return (
    <div className="plugin-configure">
      {page ? (
        <ViewFrame
          viewKey={`options:${manifest.id}`}
          html={page.html}
          owner={{ kind: "plugin", id: manifest.id, name: manifest.name }}
          permissions={manifest.permissions ?? []}
          surface="panel"
          initialHeight={Math.min(page.height ?? 260, 640)}
          minHeight={80}
          maxHeight={Math.min(page.height ?? 640, 900)}
          title={`${manifest.name} options`}
          className="plugin-configure-view"
          onClose={() => pluginConfigure.close()}
        />
      ) : null}
      {showFields ? <PluginOptions manifest={manifest} /> : null}
      {!page && !fields.length ? <p className="plugin-configure-empty">This plugin has no options.</p> : null}
    </div>
  );
}

/** Mounted once at the app root. Also registers "Configure <plugin>" palette commands. */
export function PluginConfigureDialog() {
  const { openId, version } = usePluginConfigure();
  const plugins = useAppStore((state) => state.plugins);
  const snapshot = useContributions();
  const info = openId ? plugins.find((item) => item.manifest.id === openId) : undefined;

  useEffect(() => {
    const commands = plugins
      .filter((item) => item.enabled && !item.problem && canConfigure(item.manifest))
      .map((item) => ({
        id: `plugin-configure:${item.manifest.id}`,
        title: `Configure ${item.manifest.name}`,
        category: "Plugins",
        keywords: `options settings preferences ${item.manifest.id}`,
        run: () => pluginConfigure.open(item.manifest.id),
      }));
    commandRegistry.unregisterPrefix("plugin-configure:");
    return commandRegistry.registerMany(commands);
  }, [plugins, snapshot, version]);

  if (!info) return null;
  const page = pluginConfigure.page(info.manifest.id);
  const width = page?.width ?? 0;
  return (
    <Modal
      open
      title={page?.title || `${info.manifest.name} options`}
      subtitle={info.manifest.description || undefined}
      onClose={() => pluginConfigure.close()}
      width={width > 560 ? "large" : "medium"}
      className="plugin-configure-modal"
      style={width ? { width: `min(${Math.max(320, Math.min(width, 1000))}px, calc(100vw - 32px))` } : undefined}
    >
      <ConfigureBody manifest={info.manifest} />
    </Modal>
  );
}
