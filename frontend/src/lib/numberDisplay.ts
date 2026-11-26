import { OPTION_COLORS, type NumberDisplay, type NumberDisplayStyle, type NumberFormat, type OptionColor } from "./database";

/** The "Show as" choices for number properties, in menu order. */
export const NUMBER_DISPLAYS: { id: NumberDisplayStyle; name: string; hint: string }[] = [
  { id: "number", name: "Number", hint: "The value as text" },
  { id: "bar", name: "Bar", hint: "A progress bar" },
  { id: "ring", name: "Ring", hint: "A progress ring" },
  { id: "rating", name: "Rating", hint: "Stars out of a maximum" },
  { id: "heat", name: "Heat", hint: "Shaded by size" },
];
export const NUMBER_DISPLAY_IDS = NUMBER_DISPLAYS.map((item) => item.id);

/** Most stars a rating can show. */
export const MAX_RATING = 10;

/** The style to draw, "number" when there is no display. */
export function displayStyle(display: NumberDisplay | undefined): NumberDisplayStyle {
  return display && NUMBER_DISPLAY_IDS.includes(display.style) ? display.style : "number";
}

/** The value that counts as full: the saved max, else 5 for ratings, 1 for percents, 100 otherwise. */
export function displayMax(display: NumberDisplay | undefined, format?: NumberFormat): number {
  const style = displayStyle(display);
  const max = display?.max;
  if (style === "rating") {
    const stars = typeof max === "number" && Number.isFinite(max) ? Math.round(max) : 5;
    return Math.min(MAX_RATING, Math.max(1, stars));
  }
  if (typeof max === "number" && Number.isFinite(max) && max > 0) return max;
  return format === "percent" ? 1 : 100;
}

/** How full a value is, 0 to 1; null when the value is not a number. */
export function progressRatio(value: unknown, max: number): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || !Number.isFinite(max) || max <= 0) return null;
  return Math.min(1, Math.max(0, number / max));
}

/**
 * Rating stars filled for a value: rounded to the nearest half, within 0..stars.
 * A percent value (0.6 = 60%) fills that share of the stars.
 */
export function ratingFill(value: unknown, stars: number, format?: NumberFormat): number | null {
  const ratio = progressRatio(value, format === "percent" ? 1 : stars);
  if (ratio === null) return null;
  return Math.round(ratio * stars * 2) / 2;
}

/** The colour token suffix used by the CSS tones; "default" means the accent. */
export function displayTone(display: NumberDisplay | undefined): OptionColor {
  const color = display?.color;
  return color && OPTION_COLORS.includes(color) ? color : "default";
}

export function showsNumber(display: NumberDisplay | undefined): boolean {
  return display?.showNumber !== false;
}

/**
 * Validates a display from the SDK / assistant, merged over the current one.
 * Returns `undefined` to clear (style "number" or null); throws a readable
 * error on bad input.
 */
export function normalizeNumberDisplay(input: unknown, label: string, current?: NumberDisplay): NumberDisplay | undefined {
  if (input === null || input === undefined) return undefined;
  if (typeof input === "string") input = { style: input };
  if (typeof input !== "object" || Array.isArray(input)) throw new Error(`display for "${label}" must be an object like { style: "bar", max: 100 }.`);
  const raw = input as Record<string, unknown>;
  const style = raw.style ?? current?.style ?? "number";
  if (typeof style !== "string" || !NUMBER_DISPLAY_IDS.includes(style as NumberDisplayStyle)) {
    throw new Error(`Unknown display style "${String(style)}". Use one of: ${NUMBER_DISPLAY_IDS.join(", ")}.`);
  }
  // Plain numbers have no settings: "number" clears the display.
  if (style === "number") return undefined;
  const next: NumberDisplay = { style: style as NumberDisplayStyle };
  // A rating's max counts stars, so a bar/ring divisor never carries over to it (or back).
  const sameScale = !current || (current.style === "rating") === (next.style === "rating");
  const color = raw.color !== undefined ? raw.color : current?.color;
  if (color !== undefined && color !== null && color !== "") {
    if (typeof color !== "string" || !OPTION_COLORS.includes(color as OptionColor)) {
      throw new Error(`Unknown display color "${String(color)}". Use one of: ${OPTION_COLORS.join(", ")}.`);
    }
    if (color !== "default") next.color = color as OptionColor;
  }
  const max = raw.max !== undefined ? raw.max : sameScale ? current?.max : undefined;
  if (max !== undefined && max !== null) {
    if (typeof max !== "number" || !Number.isFinite(max) || max <= 0) throw new Error(`display max for "${label}" must be a positive number.`);
    if (next.style === "rating" && (max > MAX_RATING || Math.round(max) !== max)) throw new Error(`A rating shows 1 to ${MAX_RATING} whole stars.`);
    next.max = max;
  }
  const showNumber = raw.showNumber !== undefined ? raw.showNumber : current?.showNumber;
  if (showNumber !== undefined && showNumber !== null) {
    if (typeof showNumber !== "boolean") throw new Error(`display showNumber for "${label}" must be true or false.`);
    if (!showNumber) next.showNumber = false;
  }
  return next;
}
