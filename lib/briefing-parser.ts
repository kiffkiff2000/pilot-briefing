import {
  buildNotamFlightAlerts,
  parseFlightScheduleFromText,
  type OperationalRiskAlert,
} from "./notam-risk-engine";
import { extractDepDestLatLngFromFlightPackage } from "./flight-plan-coordinates";
import type { RunwayRow } from "./runways-wind";

export type { OperationalRiskAlert };
export type { RunwayRow };

/** Raw AVWX data only — no derived risks (alerts carry interpretation). */
export type AirportWeather = {
  updated: string;
  metar: string;
  taf: string;
  rawNotes?: string;
};

export type BriefingWeather = {
  [airport: string]: AirportWeather;
};

/** Optional passenger detail from package text (zeros omitted in UI). */
export type PaxBreakdown = {
  adults?: number;
  passengerCount?: number;
  children?: number;
  infants?: number;
  male?: number;
  female?: number;
  otherGender?: number;
  petUnder?: number;
  petOver?: number;
};

export type ParsedBriefing = {
  summary: {
    departure: string;
    destination: string;
    /** Primary enroute alternate (1st alt) — used for NOTAM/weather “alternate” role. */
    alternate: string;
    /** Take-off alternate when stated separately from 1st alt (e.g. T/O ALT EGGW). */
    takeoffAlternate?: string;
    /** Second alternate when stated (2nd alt); empty if N/A. */
    secondAlternate?: string;
    eobt: string;
    flightTime: string;
    aircraft: string;
    registration: string;
    /** `Regulation:` line when present (e.g. AIROPS) — shown in REG slot separately from tail. */
    regulation?: string;
    pax: number;
    /** Present when EOBT + ETA/block time could be parsed for NOTAM time filtering */
    departureTimeUtc?: string;
    arrivalTimeUtc?: string;
    /** From "ICAO - Handler/City" lines when present */
    departureHandler?: string;
    destinationHandler?: string;
    alternateHandler?: string;
    /** Fuel / W&B packages often state lbs explicitly */
    massUnit?: "lbs";
    /** Highest cruise / step-climb FL in the package (e.g. FL110 + 380/VESAN → FL380) */
    cruiseFlightLevel?: string;
    /** Flight ID from `PLAN 0978 NJE837Q LEBL TO …` (not aircraft type). */
    callSign?: string;
    /**
     * Planned distance (NM) from the fuel / planning table row
     * `DEST LEGR … 01/09 0394 1727Z` (DIST column; leading zeros → 394).
     */
    planDistanceNm?: number;
    /** DEP position from flight-plan block (`N… E…` first pair), decimal degrees */
    depLatLng?: { lat: number; lng: number };
    /** DEST position from flight-plan block (second pair), decimal degrees */
    destLatLng?: { lat: number; lng: number };
    /** NetJets-style cabin / gender / pet lines when parsed */
    paxBreakdown?: PaxBreakdown;
    /** PERFORMANCE DATA → Release Comments (text before first `ICAO - …` note line or Prohibited header) */
    releaseComments?: string;
    /** PERFORMANCE DATA → airport / ops lines after release block + Prohibited Ops/Critical Notes body (until ATOW) */
    prohibitedOpsNotes?: string;
  };
  fuel: {
    block: number;
    trip: number;
    minRequired: number;
    /** Taxi / taxi-out fuel (lb), when stated in package */
    taxi: number;
    /**
     * Departure / arrival fuel index from lines such as
     * `FUEL INDEX 050 CONT/123` (050 = departure, 123 = arrival).
     */
    fuelIndexDep?: string;
    fuelIndexArr?: string;
    /** Extra fuel from `XTRA 002151`-style line (lb); null if not stated. */
    extraFuelLb: number | null;
  };
  weights: {
    tow: number;
    ldw: number;
  };
  alerts: OperationalRiskAlert[];
};

export type EnrichedBriefing = ParsedBriefing & {
  weather: BriefingWeather;
  notams: string;
  /** Supabase `runways` rows keyed by ICAO (for CURRENT CONDITIONS crosswind). */
  runways?: Record<string, RunwayRow[]>;
  /** Supabase `airports` ARP lat/lng keyed by ICAO (map pins only). */
  airportCoords?: Record<string, { lat: number; lng: number }>;
};

function parseNumber(raw: string | null | undefined): number {
  if (!raw) {
    return 0;
  }
  const normalized = raw.replace(/,/g, "").trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `FUEL TIME DIST ARRIVE …` table row, e.g.
 * `DEST LEGR 001770 01/09 0394 1727Z …` → DIST = 394 NM.
 */
function parseDestPlanDistanceNm(upper: string, destIcao: string): number | null {
  const d = destIcao.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(d)) return null;
  const m = upper.match(
    new RegExp(`\\bDEST\\s+${d}\\s+\\d+\\s+\\d{1,2}/\\d{1,2}\\s+(\\d{3,5})\\s+\\d{4}Z\\b`),
  );
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Fallback total when structured cabin rows are missing.
 */
function parsePaxTotalFallback(upper: string): number {
  const fromPax = parseNumber(
    upper.match(/\bPAX(?:\s+TOTAL)?\s*[:=]\s*(\d{1,3})\b/)?.[1],
  );
  if (fromPax > 0) return fromPax;

  const fromPassengerCount = parseNumber(
    upper.match(/\bPASSENGER\s+COUNT\s*:?\s*(\d{1,3})\b/)?.[1],
  );
  if (fromPassengerCount > 0) return fromPassengerCount;

  const fromAdults = parseNumber(
    upper.match(/\b(?:NO|NUMBER)\.?\s+OF\s+ADULTS\s*:?\s*(\d{1,3})\b/)?.[1],
  );
  if (fromAdults > 0) return fromAdults;

  return parseNumber(upper.match(/\bPASSENGERS?\s*[:=]?\s*(\d{1,3})\b/)?.[1]);
}

/**
 * Cabin counts, gender split, pets — from NetJets-style blocks and `M … F: … X: …`, `Pet under/over`.
 */
function parsePaxBreakdown(text: string, upper: string): { total: number; breakdown?: PaxBreakdown } {
  const b: PaxBreakdown = {};

  const ml = text.match(
    /NO\.?\s+OF\s+ADULTS\s*:?[^\d\r\n]*[\r\n]+\s*PASSENGER\s+COUNT\s*:?[^\d\r\n]*[\r\n]+\s*NO\.?\s+OF\s+CHILDREN\s*:?[^\d\r\n]*[\r\n]+\s*NO\.?\s+OF\s+INFANTS\s*:?[^\d\r\n]*[\r\n]+\s*(\d{1,3})\s*[\r\n]+\s*(\d{1,3})\s*[\r\n]+\s*(\d{1,3})\s*[\r\n]+\s*(\d{1,3})/i,
  );
  if (ml) {
    b.adults = parseNumber(ml[1]);
    b.passengerCount = parseNumber(ml[2]);
    b.children = parseNumber(ml[3]);
    b.infants = parseNumber(ml[4]);
  }

  const quadLine = upper.match(
    /\b(?:NO|NUMBER)\.?\s+OF\s+INFANTS\s*:?\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\b/,
  );
  if (!ml && quadLine) {
    b.adults = parseNumber(quadLine[1]);
    b.passengerCount = parseNumber(quadLine[2]);
    b.children = parseNumber(quadLine[3]);
    b.infants = parseNumber(quadLine[4]);
  }

  const mfx = text.match(/\bM\s*(\d{1,3})\s+F\s*:\s*(\d{1,3})\s+X\s*:\s*(\d{1,3})\b/i);
  if (mfx) {
    b.male = parseNumber(mfx[1]);
    b.female = parseNumber(mfx[2]);
    b.otherGender = parseNumber(mfx[3]);
  }

  const petU = text.match(/\bPET\s+UNDER\s*:\s*(\d{1,3})\b/i);
  const petO = text.match(/\bPET\s+OVER\s*:\s*(\d{1,3})\b/i);
  if (petU) b.petUnder = parseNumber(petU[1]);
  if (petO) b.petOver = parseNumber(petO[1]);

  let total = 0;
  if (b.passengerCount != null && b.passengerCount > 0) {
    total = b.passengerCount;
  } else if (b.adults != null || b.children != null || b.infants != null) {
    total = (b.adults ?? 0) + (b.children ?? 0) + (b.infants ?? 0);
  }
  if (total === 0) {
    total = parsePaxTotalFallback(upper);
  }

  const hasStructured = Boolean(ml || quadLine || mfx || petU || petO);

  return hasStructured ? { total, breakdown: b } : { total };
}

/** Minimum ReFuelEU uplift (lb): 90% × (trip + taxi) when departure fuel index is `050`; otherwise not applicable. */
export function computeRefuelEuUpliftLb(fuel: {
  trip: number;
  taxi: number;
  fuelIndexDep?: string;
}): number | null {
  if (fuel.fuelIndexDep !== "050") return null;
  return Math.round(0.9 * (fuel.trip + fuel.taxi));
}

const LB_TO_KG = 0.45359237;

/** Jet fuel mass (lb) → volume (L) using density in kg/L (default 0.8). */
export function jetFuelLbToLiters(lb: number, densityKgPerL = 0.8): number {
  if (!Number.isFinite(lb) || lb <= 0 || !Number.isFinite(densityKgPerL) || densityKgPerL <= 0) return 0;
  return (lb * LB_TO_KG) / densityKgPerL;
}

/** Tailwind text colour classes for extra fuel (lb): red under 100, amber under 450, else green; slate when unknown. */
export function extraFuelLineColorClass(lb: number | null | undefined): string {
  if (lb == null) return "text-slate-500";
  if (lb < 100) return "text-red-600";
  if (lb < 450) return "text-amber-600";
  return "text-green-600";
}

/** NetJets-style "LIRZ - Perugia" lines in airport blocks */
function extractIcaoHandler(text: string, icao: string): string | undefined {
  if (!icao || icao.length !== 4) {
    return undefined;
  }
  const m = text.match(new RegExp(`\\b${icao}\\s*-\\s*([^\\n\\r]+)`, "i"));
  let s = m?.[1]?.trim();
  if (!s || s.length === 0) {
    return undefined;
  }
  const takeoffSplit = s.split(/\bTakeoff\s+Alt\s*:?/i);
  s = (takeoffSplit[0] ?? s).trim();
  return s.replace(/\s{2,}/g, " ").slice(0, 120) || undefined;
}

/** Labels that match [A-Z]{4} but are not airport ICAO codes (PDF line noise). */
const NOT_ICAO = new Set([
  "DATE",
  "TIME",
  "YEAR",
  "TYPE",
  "RULE",
  "FROM",
  "DEST",
  "SAME",
  "ROUT",
  "ROUTE",
  "FERRY",
  "PLAN",
  "NAME",
]);

/** ICAO or empty if token is N/A, NIL, ---, etc. */
function normalizeAlternateToken(raw: string | undefined): string {
  if (!raw) return "";
  const cleaned = raw.replace(/[,;.]$/, "").trim().toUpperCase();
  if (/^N\/?A$/.test(cleaned) || cleaned === "NIL" || cleaned === "---" || cleaned === "NONE") return "";
  if (!/^[A-Z]{4}$/.test(cleaned) || NOT_ICAO.has(cleaned)) return "";
  return cleaned;
}

/**
 * Collect every plausible cruise / step-climb FL in the package and return the highest (e.g. FL110 + 380/VESAN + 280 → FL380).
 * Ignores bare 3-digit numbers that are not FL-like (handled by line-only and slash-waypoint patterns).
 */
function parseHighestCruiseFlightLevel(upper: string): string | undefined {
  const levels = new Set<number>();
  const add = (n: number) => {
    if (Number.isFinite(n) && n >= 10 && n <= 600) levels.add(Math.round(n));
  };

  for (const m of upper.matchAll(/\bFL\s*(\d{2,3})\b/gi)) {
    add(Number(m[1]));
  }

  /** Step-climb segment like `380/VESAN` (digits + slash + waypoint, not `095/106` fuel-style). */
  for (const m of upper.matchAll(/\b(\d{2,3})\/([A-Z][A-Z0-9]{2,})\b/g)) {
    add(Number(m[1]));
  }

  /** Line that is only a level (e.g. `280` between profile rows). */
  for (const line of upper.split(/\r?\n/)) {
    const t = line.trim();
    const only = t.match(/^(\d{2,3})$/);
    if (only) {
      const v = Number(only[1]);
      if (v >= 100 && v <= 450) add(v);
    }
  }

  if (levels.size === 0) return undefined;
  const max = Math.max(...levels);
  return `FL${max}`;
}

/** Long digit runs / plan refs — not tail reg (e.g. `20346842-1`). */
function isLikelySerialOrPlanRefLine(s: string): boolean {
  const t = s.replace(/\s/g, "");
  if (/\d{6,}/.test(t)) return true;
  if (/^\d[\d\-]+$/.test(t) && t.length >= 8) return true;
  return false;
}

/**
 * eBrief / NetJets-style `Make/Model:` — TYPE is the first token on the first line after the label
 * (e.g. lines `Make/Model:` / `EMB-505E`), or the first token on the same line as the label.
 * Optional tail/reg is the next line (e.g. CSPJC) or second token on that first line.
 */
function parseMakeModelBlock(text: string): { model?: string; tailLine?: string } {
  const label = /\bMAKE\s*\/\s*MODEL\s*\s*:/i;
  const hit = label.exec(text);
  if (!hit) return {};

  const after = text.slice(hit.index + hit[0].length);
  /** Everything after `Make/Model:` up to next major section — split into non-empty lines. */
  const chunk = after.split(/\b(?:REGULATION|DEP|DEST|FLIGHT\s+PLAN|TYPE\s+OF\s+OPERATION)\s*:/i)[0] ?? after;
  const lines = chunk
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return {};

  /** Prefer a line that looks like a manufacturer model (e.g. EMB-505E, CL-604). */
  const looksLikeModelCode = (token: string) =>
    /^[A-Z]{2,6}-\d{2,4}[A-Z]?$/i.test(token) ||
    /^[A-Z]{1,4}\d{2,4}[A-Z]?$/i.test(token) ||
    /^[A-Z][A-Z0-9]{1,}-[A-Z0-9]+$/i.test(token);

  let modelLineIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    const t = lines[i].split(/\s+/).filter(Boolean)[0] ?? "";
    if (looksLikeModelCode(t)) {
      modelLineIdx = i;
      break;
    }
  }

  const firstTokens = lines[modelLineIdx].split(/\s+/).filter(Boolean);
  const modelRaw = firstTokens[0];
  if (!modelRaw) return {};

  let tailLine: string | undefined;
  if (firstTokens.length > 1) {
    const t = firstTokens[1].toUpperCase();
    if (/^[A-Z0-9\-]{3,14}$/i.test(t) && t !== modelRaw.toUpperCase() && !isLikelySerialOrPlanRefLine(firstTokens[1])) {
      tailLine = t;
    }
  }
  if (!tailLine && lines.length > modelLineIdx + 1) {
    const rawSecond = lines[modelLineIdx + 1].trim();
    if (
      rawSecond &&
      !isLikelySerialOrPlanRefLine(rawSecond) &&
      /^[A-Z0-9\-]{3,14}$/i.test(rawSecond) &&
      rawSecond.toUpperCase() !== modelRaw.toUpperCase()
    ) {
      tailLine = rawSecond.toUpperCase();
    }
  }

  return tailLine ? { model: modelRaw, tailLine } : { model: modelRaw };
}

/**
 * PERFORMANCE DATA: `Release Comments:` (often `N/A` only) and `Prohibited Ops/Critical Notes:`.
 * Airport note lines (`ICAO - Other - …`) after release text are grouped under prohibited notes.
 */
function extractPerformanceDataSections(text: string): { releaseComments?: string; prohibitedOpsNotes?: string } {
  const n = text.replace(/\r\n/g, "\n");
  const atowIdx = n.search(/(?:^|\n)\s*ATOW\b/i);
  const bounded = atowIdx >= 0 ? n.slice(0, atowIdx) : n;

  let releaseComments: string | undefined;
  let prohibitedOpsNotes: string | undefined;

  const relM = bounded.match(/\bRelease\s+Comments\s*:\s*([\s\S]*)/i);
  if (relM?.[1] != null) {
    let fromRel = relM[1];
    const proIdx = fromRel.search(/\bProhibited\s+Ops\/\s*Critical\s+Notes\s*:/i);
    const beforePro = proIdx >= 0 ? fromRel.slice(0, proIdx) : fromRel;
    const afterPro =
      proIdx >= 0
        ? fromRel.slice(proIdx).replace(/^\s*Prohibited\s+Ops\/\s*Critical\s+Notes\s*:\s*/i, "")
        : "";

    const beforeLines = beforePro.split("\n");
    const relLines: string[] = [];
    let i = 0;
    for (; i < beforeLines.length; i++) {
      const t = beforeLines[i].trim();
      if (/^[A-Z]{4}\s+-\s/.test(t)) break;
      relLines.push(beforeLines[i]);
    }
    const rc = relLines.join("\n").trim();
    if (rc) releaseComments = rc;

    const middle = beforeLines.slice(i).join("\n").trim();
    const parts: string[] = [];
    if (middle) parts.push(middle);
    const ap = afterPro.trim();
    if (ap) parts.push(ap);
    if (parts.length) prohibitedOpsNotes = parts.join("\n\n");
  } else {
    const proOnly = bounded.match(/\bProhibited\s+Ops\/\s*Critical\s+Notes\s*:\s*([\s\S]*)/i);
    if (proOnly?.[1]?.trim()) prohibitedOpsNotes = proOnly[1].trim();
  }

  return {
    ...(releaseComments ? { releaseComments } : {}),
    ...(prohibitedOpsNotes ? { prohibitedOpsNotes } : {}),
  };
}

export function parseBriefing(text: string): ParsedBriefing {
  const upper = text.toUpperCase();

  /** Some NetJets PDFs put 1st alternate on the Dest line as `DEST: N/A LZIB` with 1st Alt blank. */
  const destLineNaPlusIcao = upper.match(/\bDEST(?:INATION)?\s*:\s*N\/A\s+([A-Z]{4})\b/);

  const departure =
    upper.match(/\bDEP(?:ARTURE)?\s*:\s*([A-Z]{4})\b/)?.[1] ??
    upper.match(/\b([A-Z]{4})\s+TO\s+([A-Z]{4})\b/)?.[1] ??
    "";

  let destination =
    upper.match(/\bDEST(?:INATION)?\s*:\s*([A-Z]{4})\b/)?.[1] ??
    upper.match(/\b([A-Z]{4})\s+TO\s+([A-Z]{4})\b/)?.[2] ??
    "";

  if (!destination && destLineNaPlusIcao) {
    destination =
      upper.match(/\b([A-Z]{4})\s*-\s*VIENNA\b/)?.[1] ??
      upper.match(/\b([A-Z]{4})\s*-\s*AIRCRAFT\s+HANDLING\b/)?.[1] ??
      "";
  }

  const takeoffAlternateRaw =
    upper.match(/\bTAKEOFF\s+ALT\s*:\s*([A-Z]{4})\b/)?.[1] ??
    upper.match(/\bT\/O\s+ALT\s*:\s*([A-Z]{4})\b/)?.[1] ??
    upper.match(/\bT\/O\s+ALT\s+([A-Z]{4})\b/)?.[1] ??
    upper.match(/\bTAKE\s+OFF\s+ALT\s*:\s*([A-Z]{4})\b/)?.[1] ??
    upper.match(/\bTAKE\s+OFF\s+ALT\s+([A-Z]{4})\b/)?.[1] ??
    upper.match(/\bTAKE\s*-\s*OFF\s+ALT\s*:\s*([A-Z]{4})\b/)?.[1] ??
    upper.match(/\bTAKE\s*-\s*OFF\s+ALT\s+([A-Z]{4})\b/)?.[1] ??
    "";
  const takeoffAlternate = normalizeAlternateToken(takeoffAlternateRaw);

  const firstAlternateWithColon =
    upper.match(/\b(?:1\s*ST|1ST|FIRST)\s+ALT\s*:\s*([A-Z]{4})\b/)?.[1] ?? "";
  /** Spaces only (not newlines) so we do not pick up "DATE" on the line after `1st Alt:` */
  const firstAlternateNoColon =
    upper.match(/\b(?:1\s*ST|1ST|FIRST)\s+ALT[ \t]+([A-Z]{4})\b/)?.[1] ?? "";
  let firstAlternate = normalizeAlternateToken(firstAlternateWithColon || firstAlternateNoColon);

  if (!firstAlternate && destLineNaPlusIcao) {
    firstAlternate = normalizeAlternateToken(destLineNaPlusIcao[1]);
  }

  const secondRaw =
    upper.match(/\b(?:2\s*ND|2ND|SECOND)\s+ALT\s*:\s*(\S+)/)?.[1] ??
    upper.match(/\b(?:2\s*ND|2ND|SECOND)\s+ALT\s+(\S+)/)?.[1] ??
    "";
  const secondAlternate = normalizeAlternateToken(secondRaw);

  const alternate =
    firstAlternate ||
    upper.match(/\bALT(?:ERNATE)?\s*:\s*([A-Z]{4})\b/)?.[1] ||
    (!takeoffAlternate ? upper.match(/\bALTN\s+([A-Z]{4})\b/)?.[1] ?? "" : "") ||
    "";
  const eobt = upper.match(/\bEOBT\s+(\d{4}Z)\b/)?.[1] ?? "";
  const destDuration = upper.match(/\bDEST\s+[A-Z]{4}\s+[0-9]{4,8}\s+(\d{2})\/(\d{2})\b/);
  const destFlightTime = destDuration ? `${destDuration[1]}${destDuration[2]}` : "";
  const nonstopComputed = upper.match(/\bNONSTOP\s+COMPUTED\s+(\d{4}Z)\b/)?.[1] ?? "";
  const genericFlightTime =
    upper.match(/\bFLIGHT\s+TIME\s*[:=]\s*([0-9]{2}:?[0-9]{2})\b/)?.[1] ?? "";
  const flightTime = destFlightTime || nonstopComputed || genericFlightTime;

  const makeModel = parseMakeModelBlock(text);
  const regulationRaw = text.match(/\bREGULATION:\s*(\S+)/i)?.[1]?.trim();
  const regulation = regulationRaw ? regulationRaw.toUpperCase() : "";

  const callSign = upper.match(/\bPLAN\s+\d+\s+([A-Z0-9]+)\s+/)?.[1] ?? "";

  const aircraftFromPlan =
    upper.match(/\bAIRCRAFT(?:\s+TYPE)?\s*:\s*([A-Z0-9\-]+)\b/)?.[1] ?? "";
  const aircraft =
    (makeModel.model && makeModel.model.length > 0 ? makeModel.model : undefined) ?? aircraftFromPlan ?? "";

  const registration =
    upper.match(/\bTAIL\s+NO\.?\s*:\s*([A-Z0-9\-]+)\b/)?.[1] ??
    upper.match(/\bREG(?:ISTRATION)?\s*:\s*([A-Z0-9\-]+)\b/)?.[1] ??
    makeModel.tailLine ??
    "";
  const { total: pax, breakdown: paxBreakdown } = parsePaxBreakdown(text, upper);

  const cruiseFlightLevel = parseHighestCruiseFlightLevel(upper);

  const blockFuel = parseNumber(
    upper.match(/\bTREQ\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1] ??
      upper.match(/\bBLOCK\s+FUEL\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1],
  );
  const tripFuel = parseNumber(
    upper.match(/\bTRIP\s+FUEL\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1] ??
      upper.match(/\bDEST\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1],
  );
  const minRequired = parseNumber(
    upper.match(/\bMIN(?:IMUM)?\s+REQUIRED\s+FUEL\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1],
  );
  const taxiFuel = parseNumber(
    upper.match(/\bTAXI\s+FUEL\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1] ??
      upper.match(/\bTAXI\s+OUT\b[^0-9]{0,15}([0-9]{2,6}(?:\.[0-9]+)?)/)?.[1],
  );

  const fuelIndexMatch = upper.match(/\bFUEL\s+INDEX\s+(\d{3})\s+CONT\s*\/\s*(\d{3})\b/);
  const fuelIndexDep = fuelIndexMatch?.[1];
  const fuelIndexArr = fuelIndexMatch?.[2];

  const xtraMatch = upper.match(/\bXTRA\s+([0-9]{3,8})\b/i);
  const extraFuelLb = xtraMatch ? parseNumber(xtraMatch[1]) : null;

  const tow = parseNumber(
    upper.match(/\bTAKEOFF\s+GROSS\s+WEIGHT\/MASS\b[^0-9]{0,20}([0-9]{3,6}(?:\.[0-9]+)?)/)?.[1] ??
      upper.match(/\bTOW\b[^0-9]{0,10}([0-9]{3,6}(?:\.[0-9]+)?)/)?.[1],
  );
  const ldw = parseNumber(
    upper.match(/\bLANDING\s+WEIGHT\/MASS\b[^0-9]{0,20}([0-9]{3,6}(?:\.[0-9]+)?)/)?.[1] ??
      upper.match(/\bLDW\b[^0-9]{0,10}([0-9]{3,6}(?:\.[0-9]+)?)/)?.[1],
  );

  const schedule = parseFlightScheduleFromText(text);
  const alerts = buildNotamFlightAlerts(text, schedule, { departure, destination, alternate });

  const massUnit =
    /\bin\s+lbs\b/i.test(text) || (/\blbs\b/i.test(text) && /\b(?:FUEL|WEIGHT|MASS|TREQ|TOW|LDW)\b/i.test(text))
      ? ("lbs" as const)
      : undefined;

  const departureHandler = extractIcaoHandler(text, departure);
  const destinationHandler = extractIcaoHandler(text, destination);
  const alternateHandler = extractIcaoHandler(text, alternate);

  const planCoords = extractDepDestLatLngFromFlightPackage(text);
  const performanceNotes = extractPerformanceDataSections(text);
  const planDistanceNm = parseDestPlanDistanceNm(upper, destination);

  return {
    summary: {
      departure,
      destination,
      alternate,
      ...(takeoffAlternate ? { takeoffAlternate } : {}),
      ...(secondRaw !== "" ? { secondAlternate } : {}),
      eobt,
      flightTime,
      aircraft,
      registration,
      ...(regulation ? { regulation } : {}),
      pax,
      ...(paxBreakdown ? { paxBreakdown } : {}),
      ...(schedule
        ? {
            departureTimeUtc: schedule.departureTimeUtc,
            arrivalTimeUtc: schedule.arrivalTimeUtc,
          }
        : {}),
      ...(departureHandler ? { departureHandler } : {}),
      ...(destinationHandler ? { destinationHandler } : {}),
      ...(alternateHandler ? { alternateHandler } : {}),
      ...(massUnit ? { massUnit } : {}),
      ...(cruiseFlightLevel ? { cruiseFlightLevel } : {}),
      ...(callSign ? { callSign } : {}),
      ...(planDistanceNm != null ? { planDistanceNm } : {}),
      ...(planCoords.dep ? { depLatLng: planCoords.dep } : {}),
      ...(planCoords.dest ? { destLatLng: planCoords.dest } : {}),
      ...(performanceNotes.releaseComments ? { releaseComments: performanceNotes.releaseComments } : {}),
      ...(performanceNotes.prohibitedOpsNotes ? { prohibitedOpsNotes: performanceNotes.prohibitedOpsNotes } : {}),
    },
    fuel: {
      block: blockFuel,
      trip: tripFuel,
      minRequired,
      taxi: taxiFuel,
      extraFuelLb,
      ...(fuelIndexDep && fuelIndexArr ? { fuelIndexDep, fuelIndexArr } : {}),
    },
    weights: {
      tow,
      ldw,
    },
    alerts,
  };
}
