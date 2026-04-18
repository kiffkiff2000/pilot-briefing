/**
 * Operational risk engine: NOTAM extraction + timeline model.
 */

import { expandRecurringNotamUtcWindows, mergeNotamUtcWindows } from "./notam-recurring-schedule";

export type AlertSeverity = "CRITICAL" | "OPERATIONAL" | "INFO";
export type AlertType =
  | "RUNWAY"
  | "ILS"
  | "TAXIWAY"
  | "VOR"
  | "GATE"
  | "RAMP"
  | "OBSTACLE"
  | "WEATHER";

export type NotamCategory = "AIRPORT" | "NAV" | "LIGHTING" | "MISC";

export type AlertTimeline = {
  start: string;
  end: string;
  flightStart: string;
  flightEnd: string;
  overlapStart: string;
  overlapEnd: string;
  overlapRatio: number;
};

export type TimelineSegment = {
  label: "NOTAM ACTIVE" | "FLIGHT WINDOW" | "OVERLAP";
  start: number;
  end: number;
  color: "grey" | "blue" | "red";
};

export type OperationalRiskAlert = {
  airport: string;
  severity: AlertSeverity;
  type: AlertType;
  title: string;
  message: string;
  affectedAssets: string[];
  impact: string;
  activeDuringFlight: boolean;
  timeline: AlertTimeline;
  timelineUI: {
    type: "PROGRESS_BAR";
    segments: TimelineSegment[];
  };
  source: string;
  notamCategory?: NotamCategory;
};

export type FlightSchedule = {
  departureTimeUtc: string;
  arrivalTimeUtc: string;
};

type RawFinding = {
  airport: string;
  type: Exclude<AlertType, "WEATHER">;
  asset: string;
  status: string;
  severity: AlertSeverity;
  chunk: string;
  notamCategory?: NotamCategory;
};

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

function parseDdMonHhmm(token: string, year: number): Date | null {
  const m = token.toUpperCase().match(/^(\d{2})([A-Z]{3})(\d{2})(\d{2})$/);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  return new Date(Date.UTC(year, month, Number(m[1]), Number(m[3]), Number(m[4]), 0, 0));
}

function inferYear(text: string, fallbackYear: number): number {
  const y = text.match(/\b20(2[4-9]|3[0-9])\b/);
  if (y) return Number(y[0]);
  return fallbackYear;
}

export function parseNotamValidityWindow(
  chunk: string,
  referenceYear: number,
): { from: Date; to: Date; label: string } | null {
  const year = inferYear(chunk, referenceYear);

  const perm = chunk.match(/\b(?:\d{2}\s+)?(\d{2}[A-Z]{3}\d{4})\s*\/\s*PERM\b/i);
  if (perm) {
    const from = parseDdMonHhmm(perm[1], year);
    if (from) {
      const to = new Date(Date.UTC(2099, 11, 31, 23, 59, 59, 0));
      return { from, to, label: `${from.toISOString().replace('.000Z', 'Z')}–PERM` };
    }
  }

  const span = chunk.match(
    /\b(?:\d{2}\s+)?(\d{2}[A-Z]{3}\d{4})\s*\/\s*(?:\d{2}\s+)?(\d{2}[A-Z]{3}\d{4})(?:\s*[A-Z]{2,4})?\b/i,
  );
  if (span) {
    const from = parseDdMonHhmm(span[1], year);
    const to = parseDdMonHhmm(span[2], year);
    if (from && to) {
      if (to.getTime() < from.getTime()) to.setUTCFullYear(to.getUTCFullYear() + 1);
      return {
        from,
        to,
        label: `${from.toISOString().replace('.000Z', 'Z')}–${to.toISOString().replace('.000Z', 'Z')}`,
      };
    }
  }

  return null;
}

function overlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function mergeManyNotamWindows(ws: { from: Date; to: Date }[]): { from: Date; to: Date }[] {
  let acc: { from: Date; to: Date }[] = [];
  for (const w of ws) acc = mergeNotamUtcWindows(acc, [w]);
  return acc;
}

function mergeOuterValidity(
  a: { from: Date; to: Date; label: string } | null,
  b: { from: Date; to: Date; label: string } | null,
): { from: Date; to: Date; label: string } | null {
  if (!a) return b;
  if (!b) return a;
  return {
    from: new Date(Math.min(a.from.getTime(), b.from.getTime())),
    to: new Date(Math.max(a.to.getTime(), b.to.getTime())),
    label: a.label,
  };
}

/** Parsed validity plus UTC windows used for flight overlap (recurring local slots when applicable). */
function effectiveWindowsForFinding(
  chunk: string,
  airportIcao: string,
  refYear: number,
): {
  outer: { from: Date; to: Date; label: string } | null;
  windows: { from: Date; to: Date }[] | null;
} {
  const outer = parseNotamValidityWindow(chunk, refYear);
  if (!outer) return { outer: null, windows: null };
  const expanded = expandRecurringNotamUtcWindows(chunk, airportIcao, outer);
  if (expanded && expanded.length > 0) return { outer, windows: expanded };
  return { outer, windows: [{ from: outer.from, to: outer.to }] };
}

function buildTimeline(validity: { from: Date; to: Date } | null, flight: FlightSchedule): AlertTimeline {
  const fs = new Date(flight.departureTimeUtc).getTime();
  const fe = new Date(flight.arrivalTimeUtc).getTime();
  const ns = validity ? validity.from.getTime() : fs;
  const ne = validity ? validity.to.getTime() : fe;

  const overlapStart = Math.max(ns, fs);
  const overlapEnd = Math.min(ne, fe);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  const baseMs = Math.max(1, ne - ns);
  const ratio = Math.max(0, Math.min(1, overlapMs / baseMs));

  return {
    start: new Date(ns).toISOString(),
    end: new Date(ne).toISOString(),
    flightStart: new Date(fs).toISOString(),
    flightEnd: new Date(fe).toISOString(),
    overlapStart: new Date(overlapStart).toISOString(),
    overlapEnd: new Date(overlapEnd).toISOString(),
    overlapRatio: Number(ratio.toFixed(3)),
  };
}

/**
 * Timeline when NOTAM activity is a union of UTC intervals (e.g. recurring local nights).
 * With a real flight schedule, overlap ratio is relative to the flight window; otherwise it
 * matches the single-interval model (overlap / NOTAM envelope span).
 */
function buildTimelineFromWindows(
  windows: { from: Date; to: Date }[] | null,
  validity: { from: Date; to: Date } | null,
  flight: FlightSchedule,
  hasRealFlightSchedule: boolean,
): AlertTimeline {
  const fs = new Date(flight.departureTimeUtc).getTime();
  const fe = new Date(flight.arrivalTimeUtc).getTime();

  if (!windows || windows.length === 0) {
    return buildTimeline(validity, flight);
  }

  const merged = mergeManyNotamWindows(windows);
  let overlapTotalMs = 0;
  let overlapStart = NaN;
  let overlapEnd = NaN;
  for (const w of merged) {
    const os = Math.max(w.from.getTime(), fs);
    const oe = Math.min(w.to.getTime(), fe);
    if (oe <= os) continue;
    overlapTotalMs += oe - os;
    if (Number.isNaN(overlapStart)) {
      overlapStart = os;
      overlapEnd = oe;
    } else {
      overlapStart = Math.min(overlapStart, os);
      overlapEnd = Math.max(overlapEnd, oe);
    }
  }

  const ns = Math.min(...merged.map((w) => w.from.getTime()));
  const ne = Math.max(...merged.map((w) => w.to.getTime()));

  if (Number.isNaN(overlapStart)) {
    overlapStart = Math.max(ns, fs);
    overlapEnd = Math.min(ne, fe);
    overlapTotalMs = Math.max(0, overlapEnd - overlapStart);
  }

  const baseMs = hasRealFlightSchedule ? Math.max(1, fe - fs) : Math.max(1, ne - ns);
  const ratio = Math.max(0, Math.min(1, overlapTotalMs / baseMs));

  return {
    start: new Date(ns).toISOString(),
    end: new Date(ne).toISOString(),
    flightStart: new Date(fs).toISOString(),
    flightEnd: new Date(fe).toISOString(),
    overlapStart: new Date(overlapStart).toISOString(),
    overlapEnd: new Date(overlapEnd).toISOString(),
    overlapRatio: Number(ratio.toFixed(3)),
  };
}

function toPct(v: number): number {
  return Number(Math.max(0, Math.min(100, v)).toFixed(1));
}

function buildTimelineUI(t: AlertTimeline): OperationalRiskAlert["timelineUI"] {
  const s = new Date(t.start).getTime();
  const e = new Date(t.end).getTime();
  const fs = new Date(t.flightStart).getTime();
  const fe = new Date(t.flightEnd).getTime();
  const os = new Date(t.overlapStart).getTime();
  const oe = new Date(t.overlapEnd).getTime();
  const span = Math.max(1, e - s);
  const fStart = toPct(((fs - s) / span) * 100);
  const fEnd = toPct(((fe - s) / span) * 100);
  const oStart = toPct(((os - s) / span) * 100);
  const oEnd = toPct(((oe - s) / span) * 100);

  return {
    type: "PROGRESS_BAR",
    segments: [
      { label: "NOTAM ACTIVE", start: 0, end: 100, color: "grey" },
      { label: "FLIGHT WINDOW", start: fStart, end: fEnd, color: "blue" },
      { label: "OVERLAP", start: oStart, end: oEnd, color: "red" },
    ],
  };
}

function mapStatusSeverity(upper: string, type: Exclude<AlertType, "WEATHER">): { status: string; severity: AlertSeverity } {
  if (upper.includes("DO NOT USE") || upper.includes("PROHIBITED") || upper.includes("CLOSED") || upper.includes("CLSD")) {
    return { status: "CLOSED", severity: type === "RUNWAY" || type === "ILS" ? "CRITICAL" : "OPERATIONAL" };
  }
  if (upper.includes("UNSERVICEABLE") || upper.includes("U/S")) {
    return { status: "UNSERVICEABLE", severity: type === "ILS" || type === "VOR" ? "CRITICAL" : "OPERATIONAL" };
  }
  if (upper.includes("RESTRICTED")) return { status: "RESTRICTED", severity: "OPERATIONAL" };
  if (upper.includes("WORK IN PROGRESS") || upper.includes("WIP")) return { status: "WORK IN PROGRESS", severity: "OPERATIONAL" };
  return { status: "RESTRICTED", severity: "INFO" };
}

function splitByNotamSubsections(text: string): Array<{ category: NotamCategory; body: string }> {
  const s = text.replace(/\r\n/g, "\n");
  const re = /---\s*(AIRPORT|NAV|LIGHTING|MISC)\s*---/gi;
  const matches = [...s.matchAll(re)];
  if (matches.length === 0) return [];
  const out: Array<{ category: NotamCategory; body: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : s.length;
    let body = s.slice(start, end).trim();
    if (i === 0 && m.index! > 0) {
      const pre = s.slice(0, m.index!).trim();
      if (pre) body = `${pre}\n\n${body}`.trim();
    }
    if (body) out.push({ category: m[1]!.toUpperCase() as NotamCategory, body });
  }
  return out;
}

function splitAptChunks(body: string): string[] {
  const normalized = body.replace(/\r\n/g, "\n");
  const re = /([A-Z]{4}\s+APT\s+\d+[\s\S]*?)(?=\n[A-Z]{4}\s+APT\s+\d+|$)/gi;
  const chunks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(normalized)) !== null) {
    const c = m[1]?.trim();
    if (c) chunks.push(c);
  }
  if (chunks.length === 0 && normalized.trim().length > 80) {
    const byId = normalized.split(/(?=\b[A-Z]\d{4}\/\d{2}\b)/g).map((s) => s.trim()).filter(Boolean);
    return byId.length > 1 ? byId : [normalized.trim()];
  }
  return chunks;
}

function splitNotamChunks(text: string): Array<{ chunk: string; category?: NotamCategory }> {
  const subs = splitByNotamSubsections(text);
  const blocks = subs.length > 0 ? subs : [{ category: undefined, body: text }];
  const out: Array<{ chunk: string; category?: NotamCategory }> = [];
  for (const block of blocks) {
    for (const chunk of splitAptChunks(block.body)) out.push({ chunk, category: block.category });
  }
  return out;
}

function runwaySuffixRank(suffix: string): number {
  if (suffix === "L") return 0;
  if (suffix === "C") return 1;
  if (suffix === "R") return 2;
  return 3;
}

function normalizeRunwayPairToken(token: string): string {
  if (!token.includes("/")) return token;
  const parts = token.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length !== 2) return token;
  const parsed = parts.map((p) => p.match(/^(\d{2})([LRC]?)$/));
  if (!parsed[0] || !parsed[1]) return token;

  const aNum = Number.parseInt(parsed[0][1]!, 10);
  const bNum = Number.parseInt(parsed[1][1]!, 10);
  const aSuf = parsed[0][2] ?? "";
  const bSuf = parsed[1][2] ?? "";

  if (aNum !== bNum) return token;
  if (runwaySuffixRank(aSuf) <= runwaySuffixRank(bSuf)) return token;
  return `${parts[1]}/${parts[0]}`;
}

function extractFindingsFromChunk(chunk: string, airports: string[], notamCategory?: NotamCategory): RawFinding[] {
  const upper = chunk.toUpperCase();
  if (/\bOBST\s+LIGHTS?\b/.test(upper) || /\bOBSTACLE\s+LIGHTS?\b/.test(upper)) return [];

  const airport = chunk.match(/\b([A-Z]{4})\s+APT\b/i)?.[1]?.toUpperCase() ?? airports.find((a) => upper.includes(a)) ?? "";
  if (!airport || airport.length !== 4) return [];

  if (upper.includes("ILS") || upper.includes("INSTRUMENT LANDING SYSTEM")) {
    const rw = upper.match(/\b(?:ILS\)?\s*|INSTRUMENT LANDING SYSTEM\s*\(?ILS\)?\s*)(?:RWY\s*)?([0-9]{2}[LRC]?)\b/);
    if (!rw?.[1]) return [];
    const { status, severity } = mapStatusSeverity(upper, "ILS");
    return [{ airport, type: "ILS", asset: `ILS RWY ${rw[1]}`, status, severity, chunk, notamCategory }];
  }

  const rwy = upper.match(/\bRWY\s*([0-9]{2}[LRC]?(?:\/[0-9]{2}[LRC]?)?)\b/);
  if (rwy) {
    const { status, severity } = mapStatusSeverity(upper, "RUNWAY");
    const normalized = normalizeRunwayPairToken(rwy[1]!);
    return [{ airport, type: "RUNWAY", asset: `Runway ${normalized}`, status, severity, chunk, notamCategory }];
  }

  if (upper.includes("VOR") || upper.includes("NDB") || upper.includes("RNAV")) {
    const { status, severity } = mapStatusSeverity(upper, "VOR");
    const navAsset = upper.includes("RNAV") ? "RNAV Procedure" : upper.includes("VOR") ? "VOR" : "NDB";
    return [{ airport, type: "VOR", asset: navAsset, status, severity, chunk, notamCategory }];
  }

  const twy = upper.match(/\b(?:TWY|TAXIWAY)\s+([A-Z0-9]+)\b/);
  if (twy) {
    const { status, severity } = mapStatusSeverity(upper, "TAXIWAY");
    return [{ airport, type: "TAXIWAY", asset: `Taxiway ${twy[1]}`, status, severity, chunk, notamCategory }];
  }

  const gate = upper.match(/\bGATE\s+([A-Z0-9]+)\b/);
  if (gate?.[1]) {
    const { status, severity } = mapStatusSeverity(upper, "GATE");
    return [{ airport, type: "GATE", asset: `Gate ${gate[1]}`, status, severity, chunk, notamCategory }];
  }

  const ramp = upper.match(/\bRAMP\s+([A-Z0-9]+)\b/);
  if (ramp?.[1]) {
    const { status, severity } = mapStatusSeverity(upper, "RAMP");
    return [{ airport, type: "RAMP", asset: `Ramp ${ramp[1]}`, status, severity, chunk, notamCategory }];
  }

  if (/\bOBST(?:ACLE)?\b/.test(upper)) {
    return [];
  }

  return [];
}

function impactByType(type: AlertType, airport: string, dep: string, dest: string, alt: string): string {
  const role = airport === dep ? "Departure" : airport === dest ? "Arrival" : airport === alt ? "Alternate" : "En-route";
  if (type === "RUNWAY" || type === "ILS") return `${role}: departure/arrival procedures affected`;
  if (type === "TAXIWAY" || type === "GATE" || type === "RAMP") return `${role}: ground routing affected`;
  if (type === "VOR") return `${role}: navigation procedure affected`;
  if (type === "WEATHER") return `${role}: weather-related operational impact`;
  return `${role}: operational review required`;
}

function strongest(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  const rank: Record<AlertSeverity, number> = { CRITICAL: 0, OPERATIONAL: 1, INFO: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function stripRunwayLabel(asset: string): string {
  return asset.replace(/^Runway\s+/i, "").trim();
}

/** Leading runway designator number 01–36 (ignores L/R/C suffix for pairing). */
function runwayNumericBase(token: string): number | null {
  const m = token.trim().match(/^(\d{2})/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (n < 1 || n > 36) return null;
  return n;
}

function reciprocalRwyNum(n: number): number {
  return n > 18 ? n - 18 : n + 18;
}

/**
 * One NOTAM group keeps every `Runway …` asset string; chunks often repeat the same strip as
 * `15/33`, `15`, and `33`. Drop singles already named by a pair, and merge lone reciprocal singles.
 */
function dedupeRunwayAssets(assets: string[]): string[] {
  const non = assets.filter((a) => !/^Runway\s+/i.test(a));
  const runways = assets.filter((a) => /^Runway\s+/i.test(a));
  if (runways.length <= 1) return [...non, ...runways];

  const labeled = runways.map((full) => ({ full, lab: stripRunwayLabel(full) }));
  const pairs = labeled.filter((x) => x.lab.includes("/"));
  const singles = labeled.filter((x) => !x.lab.includes("/"));

  const coveredBases = new Set<number>();
  for (const { lab } of pairs) {
    for (const part of lab.split("/")) {
      const b = runwayNumericBase(part.trim());
      if (b != null) {
        coveredBases.add(b);
        coveredBases.add(reciprocalRwyNum(b));
      }
    }
  }

  const singlesAfterPairCover = singles.filter(({ lab }) => {
    const b = runwayNumericBase(lab);
    if (b == null) return true;
    return !coveredBases.has(b);
  });

  const stripGroups = new Map<number, { labs: Set<string>; bases: Set<number> }>();
  const passThrough: string[] = [];

  for (const { full, lab } of singlesAfterPairCover) {
    const b = runwayNumericBase(lab);
    if (b == null) {
      passThrough.push(full);
      continue;
    }
    const key = Math.min(b, reciprocalRwyNum(b));
    let g = stripGroups.get(key);
    if (!g) {
      g = { labs: new Set(), bases: new Set() };
      stripGroups.set(key, g);
    }
    g.labs.add(lab);
    g.bases.add(b);
  }

  const mergedSingles: string[] = [];
  for (const [, g] of stripGroups) {
    if (g.bases.size >= 2) {
      const lo = Math.min(...g.bases);
      const hi = Math.max(...g.bases);
      mergedSingles.push(`Runway ${String(lo).padStart(2, "0")}/${String(hi).padStart(2, "0")}`);
    } else {
      mergedSingles.push(`Runway ${[...g.labs][0]}`);
    }
  }

  const pairSeen = new Set<string>();
  const pairOut: string[] = [];
  for (const { full, lab } of pairs) {
    const parts = lab.split("/").map((p) => runwayNumericBase(p.trim())).filter((n): n is number => n != null);
    const key =
      parts.length === 2 ? `${Math.min(parts[0], parts[1])}/${Math.max(parts[0], parts[1])}` : lab;
    if (pairSeen.has(key)) continue;
    pairSeen.add(key);
    pairOut.push(full);
  }

  const runwayOut = [...pairOut, ...mergedSingles, ...passThrough].sort((a, b) =>
    stripRunwayLabel(a).localeCompare(stripRunwayLabel(b), undefined, { numeric: true }),
  );
  return [...non, ...runwayOut];
}

export function parseFlightScheduleFromText(text: string, now: Date = new Date()): FlightSchedule | null {
  const upper = text.toUpperCase();
  let eobtM = upper.match(/\b(?:EOBT|ETD|STD|DEP)\s+(\d{2})(\d{2})\s*Z\b/);
  if (!eobtM) {
    eobtM = upper.match(/\bFOR\s+EOBT\s+(\d{2})(\d{2})\s*Z\b/) ?? upper.match(/\bEOBT\s+FOR\s+(\d{2})(\d{2})\s*Z\b/);
  }
  if (!eobtM) return null;

  let year = now.getUTCFullYear();
  let month = now.getUTCMonth();
  let day = now.getUTCDate();
  const yMonD = text.match(
    /\b(\d{4})\s*\/\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*\/\s*(\d{1,2})\b/i,
  );
  const usMdY = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/);
  if (yMonD) {
    year = Number(yMonD[1]);
    month = MONTHS[yMonD[2]!.toUpperCase()] ?? month;
    day = Number(yMonD[3]);
  } else if (usMdY) {
    month = Number(usMdY[1]) - 1;
    day = Number(usMdY[2]);
    year = 2000 + Number(usMdY[3]);
  }

  const dep = new Date(Date.UTC(year, month, day, Number(eobtM[1]), Number(eobtM[2]), 0, 0));
  const etaM = upper.match(/\b(?:ETA|ELDT|ARR|STA)\s*[:\s]+(\d{2})(\d{2})\s*Z\b/);
  if (etaM) {
    const arr = new Date(Date.UTC(year, month, day, Number(etaM[1]), Number(etaM[2]), 0, 0));
    if (arr.getTime() <= dep.getTime()) arr.setUTCDate(arr.getUTCDate() + 1);
    return { departureTimeUtc: dep.toISOString(), arrivalTimeUtc: arr.toISOString() };
  }

  const block = upper.match(/\b(?:BLOCK|FLIGHT)\s+TIME\s*[:\s]+(\d{1,2}):(\d{2})\b/);
  const arr = new Date(dep);
  if (block) {
    arr.setUTCHours(arr.getUTCHours() + Number(block[1]), arr.getUTCMinutes() + Number(block[2]));
  } else {
    const destDur = upper.match(/\bDEST\s+[A-Z]{4}\s+[0-9]{4,8}\s+(\d{2})\/(\d{2})\b/);
    if (destDur) {
      arr.setUTCHours(arr.getUTCHours() + Number(destDur[1]), arr.getUTCMinutes() + Number(destDur[2]));
    } else {
      arr.setUTCHours(arr.getUTCHours() + 2);
    }
  }
  return { departureTimeUtc: dep.toISOString(), arrivalTimeUtc: arr.toISOString() };
}

function scheduleForNotamTimeline(schedule: FlightSchedule | null, refYear: number): FlightSchedule {
  if (schedule) return schedule;
  return {
    departureTimeUtc: new Date(Date.UTC(refYear, 0, 1, 0, 0, 0, 0)).toISOString(),
    arrivalTimeUtc: new Date(Date.UTC(refYear, 11, 31, 23, 59, 59, 0)).toISOString(),
  };
}

/** Prefer a dedicated `NOTAMS` header line so we do not slice at "NOTAM" inside "WEATHER and NOTAMs". */
function sliceFromNotamsHeader(fullText: string): string {
  const upper = fullText.toUpperCase();
  const byLine = upper.match(/\n\s*NOTAMS\s*\r?\n/);
  if (byLine && byLine.index !== undefined) {
    return fullText.slice(byLine.index + byLine[0].length);
  }
  const lo = upper.search(/\bNOTAMS?\b/);
  return lo >= 0 ? fullText.slice(lo) : fullText;
}

export function buildNotamFlightAlerts(
  fullText: string,
  schedule: FlightSchedule | null,
  summary: { departure: string; destination: string; alternate: string },
): OperationalRiskAlert[] {
  const notamSection = sliceFromNotamsHeader(fullText);
  const chunks = splitNotamChunks(notamSection);
  const refYear = schedule
    ? new Date(schedule.departureTimeUtc).getUTCFullYear()
    : new Date().getUTCFullYear();
  const timelineSchedule = scheduleForNotamTimeline(schedule, refYear);
  const flightForOverlap = schedule
    ? {
        start: new Date(schedule.departureTimeUtc).getTime(),
        end: new Date(schedule.arrivalTimeUtc).getTime(),
      }
    : null;

  const findings: RawFinding[] = [];
  for (const { chunk, category } of chunks) {
    findings.push(...extractFindingsFromChunk(chunk, [summary.departure, summary.destination, summary.alternate].filter(Boolean), category));
  }

  const grouped = new Map<
    string,
    {
      items: RawFinding[];
      validity: { from: Date; to: Date; label: string } | null;
      effectiveWindows: { from: Date; to: Date }[] | null;
    }
  >();
  for (const f of findings) {
    const { outer, windows } = effectiveWindowsForFinding(f.chunk, f.airport, refYear);
    if (outer && outer.to.getTime() < Date.now()) continue;
    if (flightForOverlap && windows) {
      const touches = windows.some((w) =>
        overlap(w.from.getTime(), w.to.getTime(), flightForOverlap.start, flightForOverlap.end),
      );
      if (!touches) continue;
    }

    const assetKey = f.type === "RUNWAY" || f.type === "TAXIWAY" ? f.type : `${f.type}|${f.asset}`;
    const key = `${f.airport}|${assetKey}`;
    const prev = grouped.get(key);
    if (!prev) {
      grouped.set(key, { items: [f], validity: outer, effectiveWindows: windows });
    } else {
      prev.items.push(f);
      prev.validity = mergeOuterValidity(prev.validity, outer);
      if (windows) {
        prev.effectiveWindows = prev.effectiveWindows
          ? mergeNotamUtcWindows(prev.effectiveWindows, windows)
          : [...windows];
      }
    }
  }

  const out: OperationalRiskAlert[] = [];
  for (const [, bucket] of grouped) {
    const first = bucket.items[0]!;
    let severity = first.severity;
    const assets = new Set<string>();
    const statuses = new Set<string>();
    for (const it of bucket.items) {
      assets.add(it.asset);
      statuses.add(it.status);
      severity = strongest(severity, it.severity);
    }
    if ((first.type === "RUNWAY" || first.type === "ILS" || first.type === "VOR") && severity === "OPERATIONAL") {
      severity = "CRITICAL";
    }

    const timeline = buildTimelineFromWindows(
      bucket.effectiveWindows,
      bucket.validity,
      timelineSchedule,
      Boolean(schedule),
    );
    const affectedAssets =
      first.type === "RUNWAY" ? dedupeRunwayAssets([...assets]) : [...assets];
    const title = `${first.airport} ${first.type === "RUNWAY" || first.type === "TAXIWAY" ? `${first.type === "RUNWAY" ? "Runways" : "Taxiways"} ${affectedAssets.map((a) => a.replace(/^(Runway|Taxiway)\s+/i, "")).join(", ")}` : affectedAssets.join(", ")}`;

    out.push({
      airport: first.airport,
      severity,
      type: first.type,
      title,
      message: `${title} ${[...statuses].join("/")}`,
      affectedAssets,
      impact: impactByType(first.type, first.airport, summary.departure, summary.destination, summary.alternate),
      activeDuringFlight: !schedule || timeline.overlapRatio > 0,
      timeline,
      timelineUI: buildTimelineUI(timeline),
      source: "NOTAM",
      notamCategory: first.notamCategory,
    });
  }

  out.sort((a, b) => {
    const rank: Record<AlertSeverity, number> = { CRITICAL: 0, OPERATIONAL: 1, INFO: 2 };
    return rank[a.severity] - rank[b.severity] || a.airport.localeCompare(b.airport);
  });

  return out;
}
