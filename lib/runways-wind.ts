/**
 * Runway wind / selection (pure math). Rows come from getRunways() with `ident` = DB runwayID.
 * Use {@link getBestOpenRunwayForWind} to skip runways excluded by NOTAMs (e.g. closed).
 */

export type RunwayRow = {
  icao: string;
  ident: string;
  heading: number;
  latitudeDeg?: number;
  longitudeDeg?: number;
};

function angularDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b);
  return Math.min(d, 360 - d);
}

/** Magnetic heading (deg) → two-digit runway designator (no L/C/R). */
function runwayIdentFromHeading(headingDeg: number): string {
  const h = ((headingDeg % 360) + 360) % 360;
  const n = Math.round(h / 10) % 36 || 36;
  return String(n).padStart(2, "0");
}

/**
 * Other end of the same runway strip (e.g. 03 ↔ 21, 09L ↔ 27R).
 * Returns null if `ident` is not a standard numbered runway.
 */
export function reciprocalRunwayIdent(ident: string): string | null {
  const m = ident.trim().toUpperCase().match(/^(\d{1,2})([LRC])?$/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  if (n < 1 || n > 36) return null;
  const recNum = (n + 18) % 36 || 36;
  const suf = m[2];
  const newSuf = suf === "L" ? "R" : suf === "R" ? "L" : suf ?? "";
  return `${String(recNum).padStart(2, "0")}${newSuf}`;
}

type RunwayCandidate = { ident: string; runwayHeading: number };

function buildRunwayWindCandidates(runways: RunwayRow[]): RunwayCandidate[] {
  const candidates: RunwayCandidate[] = [];
  for (const r of runways) {
    const h = Number(r.heading);
    if (!Number.isFinite(h)) continue;
    const base = ((h % 360) + 360) % 360;
    candidates.push({ ident: r.ident, runwayHeading: base });
    const opp = (base + 180) % 360;
    const oppIdent = reciprocalRunwayIdent(r.ident) ?? runwayIdentFromHeading(opp);
    candidates.push({ ident: oppIdent, runwayHeading: opp });
  }
  return candidates;
}

/**
 * Best wind-aligned runway among candidates not excluded (e.g. by NOTAM closure).
 * Ranking matches {@link getBestRunway}: lowest crosswind component, then strongest headwind component.
 */
export function getBestOpenRunwayForWind(
  runways: RunwayRow[],
  windDir: number,
  isRunwayExcluded: (ident: string) => boolean,
): { ident: string; runwayHeading: number } | null {
  const candidates = buildRunwayWindCandidates(runways);
  if (candidates.length === 0) return null;

  type Scored = RunwayCandidate & { cross: number; headCos: number; idx: number };
  const scored: Scored[] = candidates.map((c, idx) => {
    const diff = angularDiffDeg(windDir, c.runwayHeading);
    const rad = (diff * Math.PI) / 180;
    return {
      ...c,
      idx,
      cross: Math.abs(Math.sin(rad)),
      headCos: Math.cos(rad),
    };
  });
  scored.sort((a, b) => {
    if (a.cross < b.cross - 1e-6) return -1;
    if (a.cross > b.cross + 1e-6) return 1;
    if (a.headCos > b.headCos + 1e-6) return -1;
    if (a.headCos < b.headCos - 1e-6) return 1;
    return a.idx - b.idx;
  });

  for (const s of scored) {
    if (!isRunwayExcluded(s.ident)) {
      return { ident: s.ident, runwayHeading: s.runwayHeading };
    }
  }
  return null;
}

/**
 * Best runway for operational alignment: smallest angular difference between wind FROM
 * and runway magnetic heading. Each DB row is expanded to both directions (e.g. 03 @ 030°
 * and 21 @ 210°) so we do not pick the wrong end when only one identifier is stored.
 */
export function getBestRunway(runways: RunwayRow[], windDir: number): { ident: string; runwayHeading: number } | null {
  return getBestOpenRunwayForWind(runways, windDir, () => false);
}

export type WindComponents = {
  crosswind: number;
  headwind: number;
  gustCrosswind: number | null;
};

/**
 * Wind FROM (deg), steady & gust (kt), runway magnetic heading (deg).
 * angleDeg = windDir − runwayHeading; crosswind/headwind from sin/cos of angleRad.
 */
export function computeWindComponents(
  windDir: number,
  windSpeed: number,
  gust: number | null,
  runwayHeading: number,
): WindComponents {
  const angleDeg = windDir - runwayHeading;
  const angleRad = (angleDeg * Math.PI) / 180;
  const crosswind = windSpeed * Math.sin(angleRad);
  const headwind = windSpeed * Math.cos(angleRad);
  const gustCrosswind =
    gust != null && gust > 0 ? gust * Math.sin(angleRad) : null;

  return {
    crosswind: Math.round(Math.abs(crosswind)),
    headwind: Math.round(headwind),
    gustCrosswind: gustCrosswind != null ? Math.round(Math.abs(gustCrosswind)) : null,
  };
}
