import { reciprocalRunwayIdent } from "./runways-wind";

/** Subset of NOTAM alert rows used to infer closed / unusable runways (API + briefing UI compatible). */
export type NotamRunwayClosureSource = {
  airport: string;
  type: string;
  message: string;
  affectedAssets: string[];
};

const NOTAM_RUNWAY_UNUSABLE_RE = /\b(CLOSED|CLSD|UNSERVICEABLE|U\/S|DO NOT USE|PROHIBITED)\b/i;

/** Leading runway designator number 01–36 (ignores L/C/R suffix). */
function runwayDesignatorBase(ident: string): number | null {
  const m = ident.trim().toUpperCase().match(/^(\d{1,2})/);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return n >= 1 && n <= 36 ? n : null;
}

function ingestExplicitRunwayEnd(token: string, explicit: Set<string>): void {
  const u = token.trim().toUpperCase();
  if (!/^\d{1,2}[LRC]?$/.test(u)) return;
  explicit.add(u);
  const rec = reciprocalRunwayIdent(u);
  if (rec) explicit.add(rec);
}

/** Record tokens from a NOTAM runway designator (e.g. `09L`, or `09/27` for both ends). */
function ingestRunwayClosureDesignator(stripped: string, explicit: Set<string>, bareBases: Set<number>): void {
  const u = stripped.trim().toUpperCase();
  if (!u) return;
  if (u.includes("/")) {
    for (const part of u.split("/")) {
      const p = part.trim();
      const base = runwayDesignatorBase(p);
      if (base != null) bareBases.add(base);
    }
    return;
  }
  ingestExplicitRunwayEnd(u, explicit);
}

function collectClosureSetsForAirport(icao: string, alerts: readonly NotamRunwayClosureSource[] | undefined) {
  const normIcao = icao.trim().toUpperCase();
  const explicit = new Set<string>();
  const bareBases = new Set<number>();
  if (!alerts?.length) return { explicit, bareBases };

  for (const a of alerts) {
    if (a.airport.trim().toUpperCase() !== normIcao) continue;
    if (!NOTAM_RUNWAY_UNUSABLE_RE.test(a.message)) continue;

    if (a.type === "RUNWAY") {
      for (const raw of a.affectedAssets) {
        const stripped = raw.replace(/^Runway\s+/i, "").trim();
        ingestRunwayClosureDesignator(stripped, explicit, bareBases);
      }
    } else if (a.type === "ILS") {
      for (const raw of a.affectedAssets) {
        const m = raw.toUpperCase().match(/RWY\s*(\d{2}[LRC]?(?:\/\d{2}[LRC]?)?)/);
        if (m?.[1]) ingestRunwayClosureDesignator(m[1], explicit, bareBases);
      }
    }
  }

  return { explicit, bareBases };
}

function isRunwayDesignatorNotamExcluded(
  ident: string,
  explicit: Set<string>,
  bareBases: Set<number>,
): boolean {
  const u = ident.trim().toUpperCase();
  if (explicit.has(u)) return true;
  const base = runwayDesignatorBase(u);
  if (base != null && bareBases.has(base)) return true;
  return false;
}

/**
 * Returns a predicate (true = exclude this runway for wind / Est. RWY) from merged NOTAM alerts.
 * Uses RUNWAY (and ILS RWY …) items whose message indicates closed / U/S / do not use.
 */
export function buildRunwayExcludedByNotamsPredicate(
  icao: string,
  alerts: readonly NotamRunwayClosureSource[] | undefined,
): (ident: string) => boolean {
  const { explicit, bareBases } = collectClosureSetsForAirport(icao, alerts);
  return (ident: string) => isRunwayDesignatorNotamExcluded(ident, explicit, bareBases);
}
