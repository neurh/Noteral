import { AppService } from "../../bindings/noteral/internal/service";
import type { Bootstrap, DuplicateResult, ExportResult } from "../../bindings/noteral/internal/service/models";
import type { Asset } from "../../bindings/noteral/internal/assets/models";
import type { CatalogEntry, Info, Manifest, Runtime } from "../../bindings/noteral/internal/plugins/models";
import type {
  AppSettings,
  PageDocument,
  PageMeta,
  SaveResult,
  SearchHit,
  Workspace,
  WorkspaceSnapshot,
} from "../../bindings/noteral/internal/store/models";

export type { AppSettings, Asset, Bootstrap, CatalogEntry, DuplicateResult, ExportResult, Info, Manifest, PageDocument, PageMeta, Runtime, SaveResult, SearchHit, Workspace, WorkspaceSnapshot };

export const api = {
  bootstrap: () => AppService.Bootstrap(),
  listWorkspaces: () => AppService.ListWorkspaces(),
  createWorkspace: (name: string) => AppService.CreateWorkspace(name),
  renameWorkspace: (id: string, name: string) => AppService.RenameWorkspace(id, name),
  openWorkspace: (id: string) => AppService.OpenWorkspace(id),
  openPage: (workspaceId: string, pageId: string) => AppService.OpenPage(workspaceId, pageId),
  createPage: (workspaceId: string, parentId: string) => AppService.CreatePage(workspaceId, parentId),
  renamePage: (workspaceId: string, pageId: string, title: string) => AppService.RenamePage(workspaceId, pageId, title),
  trashPage: (workspaceId: string, pageId: string) => AppService.TrashPage(workspaceId, pageId),
  restorePage: (workspaceId: string, pageId: string) => AppService.RestorePage(workspaceId, pageId),
  deletePagePermanently: (workspaceId: string, pageId: string) => AppService.DeletePagePermanently(workspaceId, pageId),
  emptyTrash: (workspaceId: string) => AppService.EmptyTrash(workspaceId),
  duplicatePage: (workspaceId: string, pageId: string) => AppService.DuplicatePage(workspaceId, pageId),
  movePage: (workspaceId: string, pageId: string, newParentId: string, beforeId: string) =>
    AppService.MovePage(workspaceId, pageId, newParentId, beforeId),
  savePage: (workspaceId: string, pageId: string, docJson: string, expectedRevision: number) =>
    AppService.SavePage(workspaceId, pageId, docJson, expectedRevision),
  saveTabs: (workspaceId: string, tabs: string[], active: string) => AppService.SaveUITabs(workspaceId, tabs, active),
  toggleFavorite: (workspaceId: string, pageId: string) => AppService.ToggleFavorite(workspaceId, pageId),
  getFavorites: (workspaceId: string) => AppService.GetFavorites(workspaceId),
  getRecent: (workspaceId: string) => AppService.GetRecent(workspaceId),
  getBacklinks: (workspaceId: string, pageId: string) => AppService.GetBacklinks(workspaceId, pageId),
  search: (workspaceId: string, query: string, limit = 20) => AppService.Search(workspaceId, query, limit),
  getPageTitles: (workspaceId: string) => AppService.GetPageTitles(workspaceId),
  saveAsset: (workspaceId: string, pageId: string, filename: string, base64: string) =>
    AppService.SaveAsset(workspaceId, pageId, filename, base64),
  importAsset: (workspaceId: string, pageId: string, imagesOnly: boolean) =>
    AppService.ImportAsset(workspaceId, pageId, imagesOnly),
  exportJson: (workspaceId: string, pageId: string) => AppService.ExportPageJSON(workspaceId, pageId),
  exportMarkdown: (workspaceId: string, pageId: string) => AppService.ExportPageMarkdown(workspaceId, pageId),
  getSettings: () => AppService.GetSettings(),
  saveSettings: (settings: AppSettings) => AppService.SaveSettings(settings),
  getDataDir: () => AppService.GetDataDir(),
  revealDataDir: () => AppService.RevealDataDir(),
  flushDone: () => AppService.FlushDone(),
  listPlugins: () => AppService.ListPlugins(),
  togglePlugin: (id: string, enabled: boolean) => AppService.TogglePlugin(id, enabled),
  uninstallPlugin: (id: string) => AppService.UninstallPlugin(id),
  installPlugin: () => AppService.InstallPlugin(),
  listPluginCatalog: () => AppService.ListPluginCatalog(),
  installCatalogPlugin: (id: string) => AppService.InstallCatalogPlugin(id),
  fetchPluginCatalog: (url: string) => AppService.FetchPluginCatalog(url),
  getPluginRuntime: (id: string) => AppService.GetPluginRuntime(id),
  getPluginSettings: (id: string) => AppService.GetPluginSettings(id),
  savePluginSettings: (id: string, patch: Record<string, unknown>) => AppService.SavePluginSettings(id, patch),
};

export function list<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  const text = String(error ?? "Something went wrong");
  return text.replace(/^Error:\s*/, "");
}
