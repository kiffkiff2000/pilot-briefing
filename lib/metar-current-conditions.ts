import { buildRunwayExcludedByNotamsPredicate, type NotamRunwayClosureSource } from "./runway-notam-closures";
import { computeWindComponents, getBestOpenRunwayForWind, type RunwayRow } from "./runways-wind";

export type CurrentConditionsBlock = {
  temp: string;
  visibility: string;
  wind: string;
  ceiling: string;
  qnh: string;
};

export type VisualConditions = {
  temp: string;
  visibility: string;
  ceiling: string;
  /** Altimeter / QNH for display (e.g. `1013 hPa` or `29.92 inHg`). */
  qnh: string;
  windDisplay: string;
  windDir: number | null;
  windSpeedKt: number;
  windGustKt: number | null;
  isVrb: boolean;
  bestRunway: { ident: string; heading: number } | null;
  components: { crosswind: number; headwind: number; gustCrosswind: number | null } | null;
};

function parseSignedTemp(token: string): string {
  if (!token) return "N/A";
  const t = token.toUpperCase();
  if (t.startsWith("M")) {
    const n = Number.parseInt(t.slice(1), 10);
    return Number.isFinite(n) ? `${-n}°C` : "N/A";
  }
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? `${n}°C` : "N/A";
}

function formatVisibility(metar: string): string {
  const u = metar.toUpperCase().replace(/\s+/g, " ");
  if (/\bCAVOK\b/.test(u)) return "10+ km";
  const wm = u.match(/\b(\d{3}\d{2,3}(?:G\d{2,3})?KT|VRB\d{2,3}KT|00000KT)\b/);
  const rest = wm ? u.slice((wm.index ?? 0) + wm[0].length).trim() : u;
  const tok = rest.match(/^(\d{4}|9999)\b/);
  const raw = tok?.[1];
  if (!raw) {
    if (/\b9999\b/.test(u)) return "10+ km";
    return "N/A";
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return "N/A";
  if (n >= 9999) return "10+ km";
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} km`;
  return `${n} m`;
}

/** METAR wind token + parsed values for CURRENT CONDITIONS. */
function formatWind(metar: string): {
  display: string;
  windFrom: number | null;
  speedKt: number;
  gustKt: number | null;
  isVrb: boolean;
  isCalm: boolean;
} {
  const u = metar.toUpperCase();
  const calm = u.match(/\b00000KT\b/);
  if (calm) {
    return { display: "000/00KT", windFrom: 0, speedKt: 0, gustKt: null, isVrb: false, isCalm: true };
  }
  const vrb = u.match(/\bVRB(\d{2,3})KT\b/);
  if (vrb) {
    const sp = Number.parseInt(vrb[1], 10);
    return {
      display: `VRB${vrb[1]}KT`,
      windFrom: null,
      speedKt: sp,
      gustKt: null,
      isVrb: true,
      isCalm: false,
    };
  }
  const w = u.match(/\b(\d{3})(\d{2,3})(G(\d{2,3}))?KT\b/);
  if (!w) {
    return { display: "N/A", windFrom: null, speedKt: 0, gustKt: null, isVrb: false, isCalm: false };
  }
  const dir = Number.parseInt(w[1], 10);
  const spd = Number.parseInt(w[2], 10);
  const gust = w[4] ? Number.parseInt(w[4], 10) : null;
  const gustPart = gust != null ? `G${gust}` : "";
  const display = `${dir}/${spd}${gustPart}KT`;
  return { display, windFrom: dir, speedKt: spd, gustKt: gust, isVrb: false, isCalm: false };
}

function cloudHeightFt(code: string, h3: string): number {
  const hundreds = Number.parseInt(h3, 10);
  if (!Number.isFinite(hundreds)) return Number.POSITIVE_INFINITY;
  if (code === "VV") return hundreds * 100;
  return hundreds * 100;
}

/** QNH from `Q1013` (hPa) or `A2992` (inHg × 100); returns `N/A` if absent. */
function formatQnh(metar: string): string {
  const u = metar.toUpperCase().replace(/\s+/g, " ");
  const q = u.match(/\bQ(\d{4})\b/);
  if (q) {
    const hpa = Number.parseInt(q[1]!, 10);
    if (Number.isFinite(hpa) && hpa > 0) return `${hpa} hPa`;
  }
  const a = u.match(/\bA(\d{4})\b/);
  if (a) {
    const v = Number.parseInt(a[1]!, 10);
    if (Number.isFinite(v) && v > 0) {
      const inches = v / 100;
      return `${inches.toFixed(2)} inHg`;
    }
  }
  return "N/A";
}

function formatCeiling(metar: string): string {
  const u = metar.toUpperCase();
  if (/\bCAVOK\b/.test(u)) return "CAVOK";

  const layers: number[] = [];
  const re = /\b(BKN|OVC|VV)(\d{3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(u)) !== null) {
    layers.push(cloudHeightFt(m[1]!, m[2]!));
  }
  const finite = layers.filter((x) => Number.isFinite(x) && x < Number.POSITIVE_INFINITY);
  if (finite.length > 0) return `${Math.min(...finite)} ft`;

  if (/\b(NSC)\b/.test(u)) return "No significant clouds";
  if (/\bSKC\b/.test(u) || /\bFEW\d{3}\b/.test(u) || /\bSCT\d{3}\b/.test(u)) {
    return ">5000 ft";
  }
  return "N/A";
}

function parseTemperature(metar: string): string {
  const u = metar.toUpperCase();
  const beforeQ = u.match(/\s(M?\d{2})\/(M?\d{2})\s+Q\d{4}\b/);
  const tm = beforeQ ?? u.match(/\b(M?\d{2})\/(M?\d{2})\b/);
  if (!tm) return "N/A";
  return parseSignedTemp(tm[1]!);
}

function formatWindWithRunways(
  windInfo: ReturnType<typeof formatWind>,
  runways: RunwayRow[] | undefined,
  icao: string,
  notamAlerts: readonly NotamRunwayClosureSource[] | undefined,
): string {
  if (windInfo.isVrb || windInfo.isCalm) return windInfo.display;
  if (windInfo.windFrom == null || windInfo.speedKt === 0) return windInfo.display;
  if (!runways?.length) return windInfo.display;

  const isExcluded = buildRunwayExcludedByNotamsPredicate(icao, notamAlerts);
  const best = getBestOpenRunwayForWind(runways, windInfo.windFrom, isExcluded);
  if (!best) return windInfo.display;

  const c = computeWindComponents(
    windInfo.windFrom,
    windInfo.speedKt,
    windInfo.gustKt,
    best.runwayHeading,
  );

  const xwPart =
    windInfo.gustKt != null && c.gustCrosswind != null
      ? `XW ${c.crosswind}G${c.gustCrosswind}kt`
      : `XW ${c.crosswind}kt`;

  return `${windInfo.display} (Est. RWY ${best.ident}, ${xwPart})`;
}

/**
 * Human-readable “current conditions” from a single METAR string (AVWX `raw`).
 * TAF must not be passed in. Optional `runways` from Supabase for RWY / XW / HW.
 */
export function metarToCurrentConditions(
  metarRaw: string | undefined,
  icao: string,
  runways?: RunwayRow[],
  notamAlerts?: readonly NotamRunwayClosureSource[],
): CurrentConditionsBlock {
  const raw = metarRaw?.trim() ?? "";
  if (!raw) {
    return {
      temp: "N/A",
      visibility: "N/A",
      wind: "N/A",
      ceiling: "N/A",
      qnh: "N/A",
    };
  }

  const temp = parseTemperature(raw);
  const visibility = formatVisibility(raw);
  const windBase = formatWind(raw);
  const wind = formatWindWithRunways(windBase, runways, icao, notamAlerts);
  const ceiling = formatCeiling(raw);
  const qnh = formatQnh(raw);

  return { temp, visibility, wind, ceiling, qnh };
}

export type MetarVisualOptions = {
  /** When set, Est. RWY skips runways marked closed / U-S / do not use in NOTAM-derived alerts for this station. */
  notamAlerts?: readonly NotamRunwayClosureSource[];
};

/** Structured form for visual weather cards and runway diagrams. */
export function metarToVisualConditions(
  metarRaw: string | undefined,
  icao: string,
  runways?: RunwayRow[],
  options?: MetarVisualOptions,
): VisualConditions {
  const raw = metarRaw?.trim() ?? "";
  if (!raw) {
    return {
      temp: "N/A",
      visibility: "N/A",
      ceiling: "N/A",
      qnh: "N/A",
      windDisplay: "N/A",
      windDir: null,
      windSpeedKt: 0,
      windGustKt: null,
      isVrb: false,
      bestRunway: null,
      components: null,
    };
  }

  const temp = parseTemperature(raw);
  const visibility = formatVisibility(raw);
  const ceiling = formatCeiling(raw);
  const qnh = formatQnh(raw);
  const windInfo = formatWind(raw);
  let bestRunway: VisualConditions["bestRunway"] = null;
  let components: VisualConditions["components"] = null;

  if (!windInfo.isVrb && !windInfo.isCalm && windInfo.windFrom != null && windInfo.speedKt > 0 && runways?.length) {
    const isExcluded = buildRunwayExcludedByNotamsPredicate(icao, options?.notamAlerts);
    const best = getBestOpenRunwayForWind(runways, windInfo.windFrom, isExcluded);
    if (best) {
      bestRunway = { ident: best.ident, heading: best.runwayHeading };
      components = computeWindComponents(windInfo.windFrom, windInfo.speedKt, windInfo.gustKt, best.runwayHeading);
    }
  }

  return {
    temp,
    visibility,
    ceiling,
    qnh,
    windDisplay: windInfo.display,
    windDir: windInfo.windFrom,
    windSpeedKt: windInfo.speedKt,
    windGustKt: windInfo.gustKt,
    isVrb: windInfo.isVrb,
    bestRunway,
    components,
  };
}
