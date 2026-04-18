/**
 * METAR observation time + TAF validity / FM segments for flight-window overlap.
 */

import type { AlertTimeline, OperationalRiskAlert } from "./notam-risk-engine";

export type AirportRole = "departure" | "arrival" | "alternate" | "other";

export function airportRole(airport: string, dep: string, dest: string, alt: string): AirportRole {
  if (airport === dep) return "departure";
  if (airport === dest) return "arrival";
  if (airport === alt) return "alternate";
  return "other";
}

/** Role-relevant UTC window: dep = early segment, arr = late segment, alt = full flight. */
export function roleFlightWindow(
  flightStart: Date,
  flightEnd: Date,
  role: AirportRole,
): { start: Date; end: Date } {
  const dur = Math.max(1, flightEnd.getTime() - flightStart.getTime());
  const cap = 45 * 60 * 1000;
  const frac = Math.min(cap, dur * 0.2);

  if (role === "departure") {
    const end = new Date(Math.min(flightStart.getTime() + frac, flightEnd.getTime()));
    return { start: flightStart, end };
  }
  if (role === "arrival") {
    const start = new Date(Math.max(flightEnd.getTime() - frac, flightStart.getTime()));
    return { start, end: flightEnd };
  }
  return { start: flightStart, end: flightEnd };
}

/** First `DDHHMMZ` token in the METAR body (published observation time), or null if missing. */
export function metarObservationToken(metar: string | undefined): string | null {
  const raw = metar?.trim() ?? "";
  const m = raw.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  return m ? `${m[1]}${m[2]}${m[3]}Z` : null;
}

/** METAR DDHHMMZ observation time → UTC Date (day in month from token). */
export function parseMetarObservationUtc(metar: string, ref: Date): Date | null {
  const m = metar.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!m) return null;
  const day = Number(m[1]);
  const hh = Number(m[2]);
  const mm = Number(m[3]);
  const y = ref.getUTCFullYear();
  let mo = ref.getUTCMonth();
  if (day < ref.getUTCDate() - 3) mo += 1;
  if (day > ref.getUTCDate() + 25) mo -= 1;
  return new Date(Date.UTC(y, mo, day, hh, mm, 0, 0));
}

/**
 * Human-readable age of the METAR observation vs `refNow`, e.g. `02h13 ago`, `45m ago`, `3d04h ago`.
 * Returns null if METAR is empty or has no parseable observation time.
 */
/** Minutes since METAR observation time; null if not parseable. */
export function metarObservationAgeMinutes(metar: string | undefined, refNow: Date = new Date()): number | null {
  const raw = metar?.trim() ?? "";
  if (!raw) return null;
  const obs = parseMetarObservationUtc(raw, refNow);
  if (!obs) return null;
  let diffMs = refNow.getTime() - obs.getTime();
  if (diffMs < 0) diffMs = 0;
  return Math.floor(diffMs / 60000);
}

export function formatMetarObsAgeAgo(metar: string | undefined, refNow: Date = new Date()): string | null {
  const raw = metar?.trim() ?? "";
  if (!raw) return null;
  const obs = parseMetarObservationUtc(raw, refNow);
  if (!obs) return null;
  let diffMs = refNow.getTime() - obs.getTime();
  if (diffMs < 0) diffMs = 0;
  const totalMins = Math.floor(diffMs / 60000);
  if (totalMins < 1) return "just now";
  if (totalMins < 60) return `${totalMins}m ago`;
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h < 48) return `${String(h).padStart(2, "0")}h${String(m).padStart(2, "0")} ago`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}d${String(rh).padStart(2, "0")}h ago`;
}

/** METAR represents ~current conditions for this window after obs. */
export function metarRepresentativeWindow(obs: Date, minutesAfter = 50): { start: Date; end: Date } {
  return {
    start: new Date(obs.getTime() - 5 * 60 * 1000),
    end: new Date(obs.getTime() + minutesAfter * 60 * 1000),
  };
}

export type TafParsed = {
  issue: Date | null;
  validFrom: Date;
  validTo: Date;
  segments: Array<{ from: Date; to: Date; text: string }>;
};

/**
 * Parse TAF validity (DDHH/DDHH) and FMddHHmm segments. Uses ref for month/year.
 */
export function parseTafStructure(taf: string, ref: Date): TafParsed | null {
  const upper = taf.replace(/\r\n/g, "\n");
  const issueM = upper.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  let issue: Date | null = null;
  if (issueM) {
    const d = Number(issueM[1]);
    const hh = Number(issueM[2]);
    const mm = Number(issueM[3]);
    issue = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), d, hh, mm, 0, 0));
  }

  const valM = upper.match(/\b(\d{2})(\d{2})\/(\d{2})(\d{2})\b/);
  if (!valM) return null;

  const sd = Number(valM[1]);
  const sh = Number(valM[2]);
  const ed = Number(valM[3]);
  const eh = Number(valM[4]);

  const y = ref.getUTCFullYear();
  const mo = ref.getUTCMonth();
  const validFrom = new Date(Date.UTC(y, mo, sd, sh, 0, 0, 0));
  let validTo = new Date(Date.UTC(y, mo, ed, eh, 0, 0, 0));
  if (validTo.getTime() <= validFrom.getTime()) {
    validTo = new Date(Date.UTC(y, mo + 1, ed, eh, 0, 0, 0));
  }

  const fmRe = /\bFM(\d{2})(\d{2})(\d{2})\b/g;
  const fms: { index: number; time: Date }[] = [];
  let fm: RegExpExecArray | null;
  while ((fm = fmRe.exec(upper)) !== null) {
    const day = Number(fm[1]);
    const hh = Number(fm[2]);
    const mm = Number(fm[3]);
    const t = new Date(Date.UTC(y, mo, day, hh, mm, 0, 0));
    fms.push({ index: fm.index, time: t });
  }
  fms.sort((a, b) => a.time.getTime() - b.time.getTime());

  const segments: Array<{ from: Date; to: Date; text: string }> = [];
  if (fms.length === 0) {
    segments.push({ from: validFrom, to: validTo, text: upper });
  } else {
    segments.push({
      from: validFrom,
      to: fms[0]!.time,
      text: upper.slice(0, fms[0]!.index),
    });
    for (let i = 0; i < fms.length; i++) {
      const from = fms[i]!.time;
      const to = i + 1 < fms.length ? fms[i + 1]!.time : validTo;
      const t0 = fms[i]!.index;
      const t1 = i + 1 < fms.length ? fms[i + 1]!.index : upper.length;
      const endClamped = new Date(Math.min(to.getTime(), validTo.getTime()));
      if (from.getTime() < endClamped.getTime()) {
        segments.push({ from, to: endClamped, text: upper.slice(t0, t1) });
      }
    }
  }

  return { issue, validFrom, validTo, segments };
}

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function intersect(a0: number, a1: number, b0: number, b1: number): { start: number; end: number } | null {
  const s = Math.max(a0, b0);
  const e = Math.min(a1, b1);
  if (s >= e) return null;
  return { start: s, end: e };
}

function unionIntervals(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  let cur = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i]!;
    if (n.start <= cur.end) cur = { start: cur.start, end: Math.max(cur.end, n.end) };
    else {
      out.push(cur);
      cur = n;
    }
  }
  out.push(cur);
  return out;
}

function toPct(v: number, span: number): number {
  return Number(Math.max(0, Math.min(100, (v / span) * 100)).toFixed(1));
}

/**
 * Bar = TAF validity (or METAR-only window). Overlap = hazardous ∧ role window ∧ flight.
 */
export function buildWeatherTimelineModel(input: {
  barStart: Date;
  barEnd: Date;
  flightStart: Date;
  flightEnd: Date;
  /** Union of time ranges where hazards apply and overlap role + flight */
  hazardOverlapStart: Date;
  hazardOverlapEnd: Date;
}): { timeline: AlertTimeline; timelineUI: OperationalRiskAlert["timelineUI"] } {
  const s = input.barStart.getTime();
  const e = input.barEnd.getTime();
  const span = Math.max(1, e - s);
  const fs = input.flightStart.getTime();
  const fe = input.flightEnd.getTime();
  const os = input.hazardOverlapStart.getTime();
  const oe = input.hazardOverlapEnd.getTime();

  const i0 = Math.max(os, fs);
  const i1 = Math.min(oe, fe);
  const overlapMs = Math.max(0, i1 - i0);
  const overlapRatio = Number((overlapMs / Math.max(1, fe - fs)).toFixed(3));

  const timeline: AlertTimeline = {
    start: input.barStart.toISOString(),
    end: input.barEnd.toISOString(),
    flightStart: input.flightStart.toISOString(),
    flightEnd: input.flightEnd.toISOString(),
    overlapStart: input.hazardOverlapStart.toISOString(),
    overlapEnd: input.hazardOverlapEnd.toISOString(),
    overlapRatio,
  };

  const timelineUI: OperationalRiskAlert["timelineUI"] = {
    type: "PROGRESS_BAR",
    segments: [
      { label: "NOTAM ACTIVE", start: 0, end: 100, color: "grey" },
      {
        label: "FLIGHT WINDOW",
        start: toPct(fs - s, span),
        end: toPct(fe - s, span),
        color: "blue",
      },
      {
        label: "OVERLAP",
        start: toPct(os - s, span),
        end: toPct(oe - s, span),
        color: "red",
      },
    ],
  };

  return { timeline, timelineUI };
}

/** Collect TAF segment intervals that overlap role window and contain hazard (predicate). */
export function hazardIntervalsFromTaf(
  parsed: TafParsed,
  roleWin: { start: Date; end: Date },
  flightWin: { start: Date; end: Date },
  segmentHasHazard: (text: string) => boolean,
): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  for (const seg of parsed.segments) {
    if (!segmentHasHazard(seg.text)) continue;
    const a0 = seg.from.getTime();
    const a1 = seg.to.getTime();
    if (!rangesOverlap(a0, a1, roleWin.start.getTime(), roleWin.end.getTime())) continue;
    if (!rangesOverlap(a0, a1, flightWin.start.getTime(), flightWin.end.getTime())) continue;
    const r = intersect(a0, a1, roleWin.start.getTime(), roleWin.end.getTime());
    if (!r) continue;
    const f = intersect(r.start, r.end, flightWin.start.getTime(), flightWin.end.getTime());
    if (!f) continue;
    out.push(f);
  }
  return out;
}

export function mergeIntervalsToBounds(intervals: Array<{ start: number; end: number }>): {
  start: Date;
  end: Date;
} | null {
  const u = unionIntervals(intervals);
  if (u.length === 0) return null;
  return { start: new Date(u[0]!.start), end: new Date(u[u.length - 1]!.end) };
}
