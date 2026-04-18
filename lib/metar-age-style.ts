/** Surface behind the age text (dark = weather cards; light = white body copy). */
export type MetarAgeSurface = "light" | "dark";

/**
 * Tailwind text classes for METAR observation age.
 * Green under 1h, amber from 1h through 3h inclusive, red if older than 3h.
 */
export function metarAgeFreshnessClass(mins: number | null, surface: MetarAgeSurface): string {
  if (mins == null) return surface === "dark" ? "text-slate-400" : "text-slate-500";
  if (mins < 60) return surface === "dark" ? "text-emerald-400" : "text-emerald-600";
  if (mins <= 180) return surface === "dark" ? "text-amber-400" : "text-amber-600";
  return surface === "dark" ? "text-red-400" : "text-red-600";
}

/** Hex for inline styles on dark briefing UI. Same thresholds as {@link metarAgeFreshnessClass}. */
export function metarAgeFreshnessHex(mins: number | null): string {
  if (mins == null) return "#7a7a9a";
  if (mins < 60) return "#34d399";
  if (mins <= 180) return "#fbbf24";
  return "#f87171";
}
