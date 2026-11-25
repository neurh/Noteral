import { AppService } from "../../bindings/noteral/internal/service";
import type { Bootstrap, DuplicateResult, ExportResult } from "../../bindings/noteral/internal/service/models";
import type { Asset } from "../../bindings/noteral/internal/assets/models";
import type { HomeCustomView, HomePrefs, HomeTabSettings } from "./home";
import type {
  CatalogEntry,
  CommunityPlugin,
  Info,
  Manifest,
  RegistryResult,
  Release,
  Runtime,
  Update as PluginUpdate,
} from "../../bindings/noteral/internal/plugins/models";
import type { PickedPlugin, PluginEnvironment, PluginSource } from "../../bindings/noteral/internal/service/models";
import type { ChatSummary, Model as AIModel, ProviderInput, ProviderView } from "../../bindings/noteral/internal/ai/models";
import type { Page as WebPage, Request as WebRequest, Response as WebResponse, SearchResponse, SearchResult } from "../../bindings/noteral/internal/web/models";
import type {
  AppSettings,
  PageDocument,
  PageMeta,
  SaveResult,
  SearchHit,
  Workspace,
  WorkspaceSnapshot,
} from "../../bindings/noteral/internal/store/models";

export type {
  AIModel,
  ChatSummary,
  CommunityPlugin,
  PickedPlugin,
  PluginEnvironment,
  PluginSource,
  PluginUpdate,
  ProviderInput,
  ProviderView,
  RegistryResult,
  Release,
  SearchResponse,
  SearchResult,
  WebPage,
  WebRequest,
  WebResponse,
};
export type { AppSettings, Asset, Bootstrap, CatalogEntry, DuplicateResult, ExportResult, Info, Manifest, PageDocument, PageMeta, Runtime, SaveResult, SearchHit, Workspace, WorkspaceSnapshot };

export const api = {
  bootstrap: () => AppService.Bootstrap(),
  listWorkspaces: () => AppService.ListWorkspaces(),
  createWorkspace: (name: string) => AppService.CreateWorkspace(name),
  renameWorkspace: (id: string, name: string) => AppService.RenameWorkspace(id, name),
  openWorkspace: (id: string) => AppService.OpenWorkspace(id),
  openPage: (workspaceId: string, pageId: string) => AppService.OpenPage(workspaceId, pageId),
  createPage: (workspaceId: string, parentId: string) => AppService.CreatePage(workspaceId, parentId),
  createItem: (workspaceId: string, parentId: string, kind: string, title: string, data: string) =>
    AppService.CreateItem(workspaceId, parentId, kind, title, data),
  createItems: (workspaceId: string, parentId: string, kind: string, items: { title: string; data: string }[]) =>
    AppService.CreateItems(workspaceId, parentId, kind, items as never),
  setPageData: (workspaceId: string, pageId: string, data: string) => AppService.SetPageData(workspaceId, pageId, data),
  renamePage: (workspaceId: string, pageId: string, title: string) => AppService.RenamePage(workspaceId, pageId, title),
  setPageAppearance: (workspaceId: string, pageId: string, icon: string, cover: string) =>
    AppService.SetPageAppearance(workspaceId, pageId, icon, cover),
  trashPage: (workspaceId: string, pageId: string) => AppService.TrashPage(workspaceId, pageId),
  restorePage: (workspaceId: string, pageId: string) => AppService.RestorePage(workspaceId, pageId),
  deletePagePermanently: (workspaceId: string, pageId: string) => AppService.DeletePagePermanently(workspaceId, pageId),
  emptyTrash: (workspaceId: string) => AppService.EmptyTrash(workspaceId),
  duplicatePage: (workspaceId: string, pageId: string) => AppService.DuplicatePage(workspaceId, pageId),
  movePage: (workspaceId: string, pageId: string, newParentId: string, beforeId: string) =>
    AppService.MovePage(workspaceId, pageId, newParentId, beforeId),
  savePage: (workspaceId: string, pageId: string, docJson: string, expectedRevision: number) =>
    AppService.SavePage(workspaceId, pageId, docJson, expectedRevision),
  saveTabs: (workspaceId: string, tabs: string[], activeTab: string, homeTabs: Record<string, HomeTabSettings>, layout: string, homeViews: HomeCustomView[], homePrefs: HomePrefs) =>
    AppService.SaveUITabs(workspaceId, tabs, activeTab, homeTabs, layout, homeViews, homePrefs),
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
  getPluginEnvironment: () => AppService.GetPluginEnvironment(),
  pickPluginBundle: () => AppService.PickPluginBundle(),
  installPluginBundle: (token: string, approved: string[]) => AppService.InstallPluginBundle(token, approved),
  listPluginCatalog: () => AppService.ListPluginCatalog(),
  installCatalogPlugin: (id: string, approved: string[]) => AppService.InstallCatalogPlugin(id, approved),
  fetchCommunityRegistry: (url = "") => AppService.FetchCommunityRegistry(url),
  getCommunityRelease: (repo: string, expectedId: string) => AppService.GetCommunityRelease(repo, expectedId),
  installCommunityPlugin: (repo: string, expectedId: string, approved: string[]) => AppService.InstallCommunityPlugin(repo, expectedId, approved),
  checkPluginUpdates: () => AppService.CheckPluginUpdates(),
  getPluginSource: (id: string) => AppService.GetPluginSource(id),
  installGeneratedPlugin: (manifest: Manifest, code: string, styles: string, approved: string[]) =>
    AppService.InstallGeneratedPlugin(manifest, code, styles, approved),
  pluginHTTP: (pluginId: string, request: WebRequest) => AppService.PluginHTTP(pluginId, request),
  getPluginRuntime: (id: string) => AppService.GetPluginRuntime(id),
  getPluginSettings: (id: string) => AppService.GetPluginSettings(id),
  savePluginSettings: (id: string, patch: Record<string, unknown>) => AppService.SavePluginSettings(id, patch),

  // Assistant: providers, streaming proxy, chats.
  listAIProviders: () => AppService.ListAIProviders(),
  saveAIProvider: (input: ProviderInput) => AppService.SaveAIProvider(input),
  deleteAIProvider: (id: string) => AppService.DeleteAIProvider(id),
  listAIModels: (providerId: string) => AppService.ListAIModels(providerId),
  startAIStream: (requestId: string, providerId: string, model: string, body: string) =>
    AppService.StartAIStream(requestId, providerId, model, body),
  cancelAIStream: (requestId: string) => AppService.CancelAIStream(requestId),
  getAISettings: () => AppService.GetAISettings(),
  saveAISettings: (json: string) => AppService.SaveAISettings(json),
  listAIChats: () => AppService.ListAIChats(),
  getAIChat: (id: string) => AppService.GetAIChat(id),
  saveAIChat: (json: string) => AppService.SaveAIChat(json),
  deleteAIChat: (id: string) => AppService.DeleteAIChat(id),

  // Free web tools (no API key): DuckDuckGo/Wikipedia search and readable fetch.
  webSearch: (query: string, limit = 8) => AppService.WebSearch(query, limit),
  webFetch: (url: string, maxChars = 20000) => AppService.WebFetch(url, maxChars),

  // Creator-mode customizations document (tokens, CSS snippets, layout).
  getCustomizations: () => AppService.GetCustomizations(),
  saveCustomizations: (json: string) => AppService.SaveCustomizations(json),
};

export function list<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, "");
  const text = String(error ?? "Something went wrong");
  return text.replace(/^Error:\s*/, "");
}
