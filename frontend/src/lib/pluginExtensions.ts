/**
 * What running plugins add to the app beyond contributions: inline editor
 * suggesters and the APIs plugins expose to each other. Pure state; the
 * plugin runtime clears an owner's entries when its frame stops.
 */

export interface SuggesterRegistration {
  pluginId: string;
  pluginName: string;
  /** Plugin-local id. */
  id: string;
  /** One character that opens the menu, e.g. "@" or "[" (not "/"). */
  trigger: string;
  /** Characters typed after the trigger before the plugin is asked. */
  minChars: number;
  maxItems: number;
  /** The plugin wants a callback when an item is picked. */
  onSelect: boolean;
}

export interface ExposedApi {
  pluginId: string;
  pluginName: string;
  version: string;
  methods: string[];
}

type Listener = () => void;

/** "/" is the slash menu and ":" the emoji picker. */
const RESERVED_TRIGGERS = new Set(["/", ":", " ", "\n", "\t"]);
export const MAX_SUGGESTERS_PER_PLUGIN = 8;
export const MAX_API_METHODS = 100;

class PluginExtensions {
  private suggesters = new Map<string, SuggesterRegistration>();
  private apis = new Map<string, ExposedApi>();
  private suggesterSnapshot: SuggesterRegistration[] = [];
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSuggesters = () => this.suggesterSnapshot;

  private changed() {
    this.suggesterSnapshot = Array.from(this.suggesters.values());
    for (const listener of Array.from(this.listeners)) listener();
  }

  addSuggester(entry: SuggesterRegistration) {
    const trigger = Array.from(entry.trigger);
    if (trigger.length !== 1 || RESERVED_TRIGGERS.has(entry.trigger)) throw new Error('A suggester trigger is one character other than "/", ":" or whitespace.');
    const key = `${entry.pluginId}:${entry.id}`;
    const owned = Array.from(this.suggesters.values()).filter((item) => item.pluginId === entry.pluginId);
    if (!this.suggesters.has(key) && owned.length >= MAX_SUGGESTERS_PER_PLUGIN) throw new Error(`A plugin can register at most ${MAX_SUGGESTERS_PER_PLUGIN} suggesters.`);
    this.suggesters.set(key, entry);
    this.changed();
  }

  removeSuggester(pluginId: string, id: string) {
    if (this.suggesters.delete(`${pluginId}:${id}`)) this.changed();
  }

  listSuggesters(pluginId?: string) {
    return this.suggesterSnapshot.filter((item) => !pluginId || item.pluginId === pluginId);
  }

  expose(api: ExposedApi) {
    if (api.methods.length > MAX_API_METHODS) throw new Error(`A plugin can expose at most ${MAX_API_METHODS} methods.`);
    this.apis.set(api.pluginId, api);
  }

  api(pluginId: string): ExposedApi | undefined {
    return this.apis.get(pluginId);
  }

  listApis(): ExposedApi[] {
    return Array.from(this.apis.values());
  }

  removeOwner(pluginId: string) {
    this.apis.delete(pluginId);
    let removed = false;
    for (const [key, item] of this.suggesters) {
      if (item.pluginId === pluginId) {
        this.suggesters.delete(key);
        removed = true;
      }
    }
    if (removed) this.changed();
  }
}

export const pluginExtensions = new PluginExtensions();
