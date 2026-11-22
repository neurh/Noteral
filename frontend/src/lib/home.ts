export const HOME_TEMPLATES = ["default", "library", "focus", "gallery"] as const;
export type HomeTemplate = (typeof HOME_TEMPLATES)[number];
export const HOME_TEMPLATE_LABELS: Record<HomeTemplate, string> = {
  default: "Default",
  library: "Library",
  focus: "Focus",
  gallery: "Gallery",
};

export const HOME_BACKGROUNDS = ["paper", "linen", "sage", "clay", "dusk"] as const;
export type HomeBackground = (typeof HOME_BACKGROUNDS)[number];
export const HOME_BACKGROUND_LABELS: Record<HomeBackground, string> = {
  paper: "Paper",
  linen: "Linen",
  sage: "Sage",
  clay: "Clay",
  dusk: "Dusk",
};

export interface HomeTabSettings {
  template: HomeTemplate;
  background: HomeBackground;
}

export const defaultHomeTabSettings: HomeTabSettings = {
  template: "default",
  background: "paper",
};

export function normalizeHomeTabSettings(value?: { template?: string; background?: string } | null): HomeTabSettings {
  const template = HOME_TEMPLATES.includes(value?.template as HomeTemplate)
    ? (value?.template as HomeTemplate)
    : defaultHomeTabSettings.template;
  const background = HOME_BACKGROUNDS.includes(value?.background as HomeBackground)
    ? (value?.background as HomeBackground)
    : defaultHomeTabSettings.background;
  return { template, background };
}
