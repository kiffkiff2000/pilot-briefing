/**
 * Recurring NOTAM schedules (e.g. MON–FRI 2200–0300 local) expanded to UTC intervals
 * for overlap with the flight window. Requires a known IANA timezone for the airport.
 */

/** Airfield → IANA (expand as needed). Unknown → no refinement (coarse validity only). */
const ICAO_TO_IANA: Record<string, string> = {
  LFSB: "Europe/Zurich",
  LFML: "Europe/Paris",
  LFPG: "Europe/Paris",
  LFBO: "Europe/Paris",
  LFPO: "Europe/Paris",
  LFMD: "Europe/Paris",
  LFLL: "Europe/Paris",
  LFBD: "Europe/Paris",
  LFRS: "Europe/Paris",
  LFKB: "Europe/Paris",
  LFKJ: "Europe/Paris",
  LFQQ: "Europe/Paris",
  EGLL: "Europe/London",
  EGKK: "Europe/London",
  EGSS: "Europe/London",
  EGGW: "Europe/London",
  EGKB: "Europe/London",
  EHAM: "Europe/Amsterdam",
  EBBR: "Europe/Brussels",
  EDDH: "Europe/Berlin",
  EDDF: "Europe/Berlin",
  EDDM: "Europe/Berlin",
  LSZH: "Europe/Zurich",
  LSZG: "Europe/Zurich",
  LOWW: "Europe/Vienna",
  LZIB: "Europe/Bratislava",
  LIRZ: "Europe/Rome",
  LIRF: "Europe/Rome",
  LIMC: "Europe/Rome",
  LIML: "Europe/Rome",
  LIPZ: "Europe/Rome",
  LIPR: "Europe/Rome",
  LEBL: "Europe/Madrid",
  LEMD: "Europe/Madrid",
  LEZL: "Europe/Madrid",
  LPPT: "Europe/Lisbon",
  LPFR: "Europe/Lisbon",
  EIDW: "Europe/Dublin",
  BIKF: "Atlantic/Reykjavik",
  CYUL: "America/Toronto",
  CYYZ: "America/Toronto",
  KJFK: "America/New_York",
  KLAX: "America/Los_Angeles",
  KSFO: "America/Los_Angeles",
  KORD: "America/Chicago",
  KMIA: "America/New_York",
  PANC: "America/Anchorage",
};

const WD3: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

export function timezoneForIcao(icao: string): string | null {
  return ICAO_TO_IANA[icao.trim().toUpperCase()] ?? null;
}

type ZonedParts = {
  y: number;
  mo: number;
  day: number;
  wd: number;
  h: number;
  mi: number;
};

function partsAt(utcMs: number, tz: string): ZonedParts {
  const d = new Date(utcMs);
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) {
    if (p.type !== "literal") o[p.type] = p.value;
  }
  const wk = (o.weekday ?? "???").toUpperCase().slice(0, 3);
  const wd = WD3[wk] ?? 0;
  return {
    y: Number(o.year),
    mo: Number(o.month),
    day: Number(o.day),
    wd,
    h: Number(o.hour),
    mi: Number(o.minute),
  };
}

/** Find UTC instant where local wall time in `tz` is y-mo-d h:mi (±36h search). */
function zonedWallToUtc(y: number, mo: number, day: number, h: number, mi: number, tz: string): Date {
  const anchor = Date.UTC(y, mo - 1, day, 12, 0, 0);
  for (let dh = -14; dh <= 14; dh++) {
    for (let dm = -3; dm <= 3; dm++) {
      const cand = new Date(anchor + (dh * 60 + dm) * 60000);
      const p = partsAt(cand.getTime(), tz);
      if (p.y === y && p.mo === mo && p.day === day && p.h === h && p.mi === mi) return cand;
    }
  }
  const coarse = Date.UTC(y, mo - 1, day, h, mi, 0);
  for (let step = -96; step <= 96; step++) {
    const cand = new Date(coarse + step * 15 * 60000);
    const p = partsAt(cand.getTime(), tz);
    if (p.y === y && p.mo === mo && p.day === day && p.h === h && p.mi === mi) return cand;
  }
  return new Date(coarse);
}

/** First UTC time ≥ startUtc where local time is endH:endMi on a later calendar day than startParts (overnight end). */
function findOvernightEndUtc(startUtc: Date, startParts: ZonedParts, endH: number, endMi: number, tz: string): Date {
  for (let addMin = 30; addMin <= 24 * 60; addMin += 5) {
    const t = new Date(startUtc.getTime() + addMin * 60000);
    const p = partsAt(t.getTime(), tz);
    const crossed =
      p.y !== startParts.y || p.mo !== startParts.mo || p.day !== startParts.day || p.wd !== startParts.wd;
    if (crossed && p.h === endH && p.mi === endMi) return t;
  }
  return new Date(startUtc.getTime() + 5 * 3600000);
}

function parseWeekdaySet(chunk: string): Set<number> | null {
  const u = chunk.toUpperCase();
  if (/\bMON\s*-\s*FRI\b/.test(u)) return new Set([1, 2, 3, 4, 5]);
  if (/\bMON\s*-\s*THU\b/.test(u)) return new Set([1, 2, 3, 4]);
  if (/\bTUE\s*-\s*SAT\b/.test(u)) return new Set([2, 3, 4, 5, 6]);
  if (/\bSAT\s*-\s*SUN\b/.test(u)) return new Set([0, 6]);
  if (/\bDAILY\b/.test(u) || /\bEVERY\s+DAY\b/.test(u)) return new Set([0, 1, 2, 3, 4, 5, 6]);
  return null;
}

/** Local start/end minutes 0..1440, overnight if end < start (e.g. 2200–0300). */
function parseLocalTimeBand(chunk: string): { startMin: number; endMin: number; overnight: boolean } | null {
  const m = chunk.match(/\b(\d{2})(\d{2})\s*[-–]\s*(\d{2})(\d{2})\b/);
  if (!m) return null;
  const sh = Number.parseInt(m[1]!, 10);
  const sm = Number.parseInt(m[2]!, 10);
  const eh = Number.parseInt(m[3]!, 10);
  const em = Number.parseInt(m[4]!, 10);
  if (
    sh > 23 ||
    eh > 23 ||
    sm > 59 ||
    em > 59 ||
    Number.isNaN(sh + sm + eh + em)
  ) {
    return null;
  }
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const overnight = endMin < startMin;
  return { startMin, endMin, overnight };
}

function mergeIntervals(slots: { from: Date; to: Date }[]): { from: Date; to: Date }[] {
  if (slots.length === 0) return [];
  const sorted = [...slots].sort((a, b) => a.from.getTime() - b.from.getTime());
  const out: { from: Date; to: Date }[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (!last || last.to.getTime() < s.from.getTime()) {
      out.push({ from: s.from, to: s.to });
    } else {
      last.to = new Date(Math.max(last.to.getTime(), s.to.getTime()));
    }
  }
  return out;
}

function clipToOuter(w: { from: Date; to: Date }, outer: { from: Date; to: Date }): { from: Date; to: Date } | null {
  const fs = Math.max(w.from.getTime(), outer.from.getTime());
  const fe = Math.min(w.to.getTime(), outer.to.getTime());
  if (fe <= fs) return null;
  return { from: new Date(fs), to: new Date(fe) };
}

/**
 * When the chunk names a weekday + local time band (e.g. MON–FRI 2200–0300), return UTC
 * windows for those nights only, clipped to `outer`. Returns null if no recurring rule or no TZ.
 */
export function expandRecurringNotamUtcWindows(
  chunk: string,
  airportIcao: string,
  outer: { from: Date; to: Date } | null,
): { from: Date; to: Date }[] | null {
  if (!outer) return null;
  const tz = timezoneForIcao(airportIcao);
  if (!tz) return null;

  const dows = parseWeekdaySet(chunk);
  const band = parseLocalTimeBand(chunk);
  if (!dows || !band) return null;

  const sh = Math.floor(band.startMin / 60);
  const sm = band.startMin % 60;
  const eh = Math.floor(band.endMin / 60);
  const em = band.endMin % 60;

  const slots: { from: Date; to: Date }[] = [];

  const scanStart = outer.from.getTime() - 36 * 3600000;
  const scanEnd = outer.to.getTime() + 36 * 3600000;
  const dayKeys = new Set<string>();
  for (let t = scanStart; t <= scanEnd; t += 30 * 60 * 1000) {
    const p = partsAt(t, tz);
    dayKeys.add(`${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`);
  }

  for (const key of dayKeys) {
    const [ys, mos, ds] = key.split("-");
    const y = Number(ys);
    const mo = Number(mos);
    const day = Number(ds);
    if (!Number.isFinite(y + mo + day)) continue;

    const noonUtc = zonedWallToUtc(y, mo, day, 12, 0, tz);
    const pNoon = partsAt(noonUtc.getTime(), tz);
    if (pNoon.y !== y || pNoon.mo !== mo || pNoon.day !== day) continue;
    if (!dows.has(pNoon.wd)) continue;

    const dayStart = zonedWallToUtc(y, mo, day, 0, 0, tz);
    const dayEnd = zonedWallToUtc(y, mo, day, 23, 59, tz);
    if (dayEnd.getTime() < outer.from.getTime() || dayStart.getTime() > outer.to.getTime()) continue;

    if (band.overnight) {
      const startUtc = zonedWallToUtc(y, mo, day, sh, sm, tz);
      const startParts = partsAt(startUtc.getTime(), tz);
      const endUtc = findOvernightEndUtc(startUtc, startParts, eh, em, tz);
      const clipped = clipToOuter({ from: startUtc, to: endUtc }, outer);
      if (clipped) slots.push(clipped);
    } else {
      const startUtc = zonedWallToUtc(y, mo, day, sh, sm, tz);
      const endUtc = zonedWallToUtc(y, mo, day, eh, em, tz);
      if (endUtc.getTime() <= startUtc.getTime()) continue;
      const clipped = clipToOuter({ from: startUtc, to: endUtc }, outer);
      if (clipped) slots.push(clipped);
    }
  }

  if (slots.length === 0) return null;
  return mergeIntervals(slots);
}

export function mergeNotamUtcWindows(a: { from: Date; to: Date }[], b: { from: Date; to: Date }[]): { from: Date; to: Date }[] {
  return mergeIntervals([...a, ...b]);
}
