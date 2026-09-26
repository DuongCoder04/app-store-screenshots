import type { Slide, SlideTypography } from "./types";

/** Relative scale on layout default font sizes (1 = default). */
export const FONT_SCALE_MIN = 0.5;
export const FONT_SCALE_MAX = 2;
export const FONT_SCALE_DEFAULT = 1;

export function clampFontScale(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return FONT_SCALE_DEFAULT;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, value));
}

export function slideFontScales(slide: Slide) {
  return {
    labelScale: clampFontScale(slide.typography?.labelScale),
    headlineScale: clampFontScale(slide.typography?.headlineScale),
    appNameScale: clampFontScale(slide.typography?.appNameScale),
  };
}

/** Persist only non-default scales so JSON stays tidy. Values are clamped
 * first, so invalid or out-of-range input from a loaded project never ends up
 * stored as a no-op `1` or outside the slider range. */
export function cleanTypography(raw: SlideTypography | undefined): SlideTypography | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: SlideTypography = {};
  for (const key of ["labelScale", "headlineScale", "appNameScale"] as const) {
    const value = clampFontScale(raw[key]);
    if (value !== FONT_SCALE_DEFAULT) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
