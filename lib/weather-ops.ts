/**
 * Weather → operational risk alerts (METAR + time-sliced TAF, role-based flight windows).
 */

import type { OperationalRiskAlert, AlertSeverity } from "./notam-risk-engine";
import {
  airportRole,
  buildWeatherTimelineModel,
  hazardIntervalsFromTaf,
  mergeIntervalsToBounds,
  metarRepresentativeWindow,
  parseMetarObservationUtc,
  parseTafStructure,
  roleFlightWindow,
  type AirportRole,
} from "./taf-timeline";

function strongest(a: AlertSeverity, b: AlertSeverity): AlertSeverity {
  const rank: Record<AlertSeverity, number> = { CRITICAL: 0, OPERATIONAL: 1, INFO: 2 };
  return rank[a] <= rank[b] ? a : b;
}

function minVisibilityMeters(text: string): number | null {
  const stripped = text.toUpperCase().replace(/\bQ\d{4}\b/g, " ");
  let minV: number | null = null;
  for (const m of stripped.matchAll(/\b(\d{4})\b/g)) {
    const v = Number(m[1]);
    if (v === 9999 || v < 50) continue;
    if (v > 9999) continue;
    minV = minV === null ? v : Math.min(minV, v);
  }
  return minV;
}

function lowestCeilingFt(text: string): number | null {
  let minFt: number | null = null;
  for (const m of text.toUpperCase().matchAll(/\b(BKN|OVC)(\d{3})\b/g)) {
    const ft = Number(m[2]) * 100;
    if (ft > 0) minFt = minFt === null ? ft : Math.min(minFt, ft);
  }
  return minFt;
}

function hasWindGustOver25Kt(text: string): boolean {
  for (const m of text.toUpperCase().matchAll(/\b(?:\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/g)) {
    const gust = Number(m[2] ?? "0");
    const sus = Number(m[1] ?? "0");
    if (gust > 25 || sus > 25) return true;
  }
  return false;
}

function hasWindShearHint(text: string): boolean {
  const u = text.toUpperCase();
  return /\bWS\s|LLWS|WIND\s+SHEAR|LOW\s+LEVEL\s+WIND\s+SHEAR\b/.test(u);
}

function hasTafDeteriorationHint(taf: string): boolean {
  const u = taf.toUpperCase();
  return /\bBECMG\b/.test(u) && /\bTEMPO\b/.test(u) && (/\bFM\d{4}\b/.test(u) || /\bAT\d{4}\b/.test(u));
}

function hasFgOrBr(text: string): boolean {
  return /\bFG\b|\bBR\b/.test(text.toUpperCase());
}

function hasTsOrCb(text: string): boolean {
  const u = text.toUpperCase();
  return /\bTS\b|\bCB\b/.test(u);
}

function hasShra(text: string): boolean {
  return /\bSHRA\b/.test(text.toUpperCase());
}

function visSeverity(meters: number | null): { sev: AlertSeverity; hit: boolean } {
  if (meters === null) return { sev: "INFO", hit: false };
  if (meters < 600) return { sev: "CRITICAL", hit: true };
  if (meters < 3000) return { sev: "OPERATIONAL", hit: true };
  return { sev: "INFO", hit: false };
}

function ceilingSeverity(ft: number | null): { sev: AlertSeverity; hit: boolean } {
  if (ft === null) return { sev: "INFO", hit: false };
  if (ft < 200) return { sev: "CRITICAL", hit: true };
  if (ft < 1000) return { sev: "OPERATIONAL", hit: true };
  return { sev: "INFO", hit: false };
}

function intersectRange(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  c0: number,
  c1: number,
): { start: number; end: number } | null {
  const s = Math.max(a0, b0, c0);
  const e = Math.min(a1, b1, c1);
  if (s >= e) return null;
  return { start: s, end: e };
}

/**
 * One merged WEATHER alert per airport with time-sliced TAF overlap and role windows (dep/arr/alt).
 */
export function buildMergedWeatherRiskAlert(
  airport: string,
  metar: string,
  taf: string,
  summary: {
    departure: string;
    destination: string;
    alternate: string;
    departureTimeUtc?: string;
    arrivalTimeUtc?: string;
  },
): OperationalRiskAlert | null {
  if (!summary.departureTimeUtc || !summary.arrivalTimeUtc) return null;

  const flightStart = new Date(summary.departureTimeUtc);
  const flightEnd = new Date(summary.arrivalTimeUtc);
  const ref = flightStart;

  const role: AirportRole = airportRole(airport, summary.departure, summary.destination, summary.alternate);
  const roleWin = roleFlightWindow(flightStart, flightEnd, role);
  const flightWin = { start: flightStart, end: flightEnd };

  const obs = metar.trim() ? parseMetarObservationUtc(metar, ref) : null;
  const metarWin = obs ? metarRepresentativeWindow(obs, 55) : null;
  const metarRelevant = metarWin
    ? intersectRange(
        metarWin.start.getTime(),
        metarWin.end.getTime(),
        roleWin.start.getTime(),
        roleWin.end.getTime(),
        flightWin.start.getTime(),
        flightWin.end.getTime(),
      )
    : null;

  const tafParsed = taf.trim() ? parseTafStructure(taf, ref) : null;

  const metarText = metarRelevant ? metar : "";
  const segmentTexts: Array<{ from: Date; to: Date; text: string }> = [];
  if (tafParsed) {
    for (const seg of tafParsed.segments) {
      const ov = intersectRange(
        seg.from.getTime(),
        seg.to.getTime(),
        roleWin.start.getTime(),
        roleWin.end.getTime(),
        flightWin.start.getTime(),
        flightWin.end.getTime(),
      );
      if (ov) segmentTexts.push(seg);
    }
  }
  let tafOverlapText = segmentTexts.map((s) => s.text).join("\n");
  if (!tafParsed && taf.trim()) {
    tafOverlapText = taf;
  }
  const combinedForHazard = `${metarText}\n${tafOverlapText}`;

  const visMetar = metarText ? minVisibilityMeters(metarText) : null;
  const visTaf = tafOverlapText ? minVisibilityMeters(tafOverlapText) : null;
  const visWorst =
    visMetar !== null && visTaf !== null ? Math.min(visMetar, visTaf) : visMetar ?? visTaf ?? null;

  const ceilMetar = metarText ? lowestCeilingFt(metarText) : null;
  const ceilTaf = tafOverlapText ? lowestCeilingFt(tafOverlapText) : null;
  const ceilWorst =
    ceilMetar !== null && ceilTaf !== null ? Math.min(ceilMetar, ceilTaf) : ceilMetar ?? ceilTaf ?? null;

  const visMetSev = visSeverity(visMetar);
  const visTafSev = visSeverity(visTaf);
  const visAll = visSeverity(visWorst);

  const ceilMetSev = ceilingSeverity(ceilMetar);
  const ceilTafSev = ceilingSeverity(ceilTaf);
  const ceilAll = ceilingSeverity(ceilWorst);

  const parts: string[] = [];
  const assets: string[] = [];
  let severity: AlertSeverity = "INFO";

  const tsMet = metarText && hasTsOrCb(metarText);
  const tsTaf = tafOverlapText && hasTsOrCb(tafOverlapText);
  if (tsMet || tsTaf) {
    severity = strongest(severity, "CRITICAL");
    const src =
      tsMet && tsTaf ? "METAR + TAF (time-relevant)" : tsMet ? "METAR" : "TAF (time-sliced)";
    parts.push(`Thunderstorm / CB activity (${src})`);
    assets.push("TS/CB");
  }

  const shra = combinedForHazard && hasShra(combinedForHazard);
  const lowCeil = ceilAll.hit;
  if (shra && lowCeil) {
    const sev =
      ceilAll.sev === "CRITICAL" || visAll.sev === "CRITICAL" ? "CRITICAL" : "OPERATIONAL";
    severity = strongest(severity, sev);
    parts.push("Showers with low ceiling (SHRA + BKN/OVC)");
    assets.push("SHRA+ceiling");
  } else if (shra) {
    severity = strongest(severity, "OPERATIONAL");
    parts.push("Showers (SHRA)");
    assets.push("SHRA");
  }

  if (combinedForHazard && hasFgOrBr(combinedForHazard)) {
    const fgSev = visWorst !== null && visWorst < 600 ? "CRITICAL" : "OPERATIONAL";
    severity = strongest(severity, fgSev);
    parts.push("Mist / fog (FG/BR)");
    assets.push("FG/BR");
  }

  if (visAll.hit && !(shra && lowCeil)) {
    severity = strongest(severity, visAll.sev);
    const src =
      visMetSev.hit && visTafSev.hit ? "METAR + TAF convergence" : visMetSev.hit ? "METAR" : "TAF";
    parts.push(`Reduced visibility (${visWorst}m) (${src})`);
    assets.push(visWorst !== null && visWorst < 600 ? "VIS <600m" : "VIS <3000m");
  }

  if (ceilAll.hit && !(shra && lowCeil)) {
    severity = strongest(severity, ceilAll.sev);
    const src =
      ceilMetSev.hit && ceilTafSev.hit ? "METAR + TAF convergence" : ceilMetSev.hit ? "METAR" : "TAF";
    parts.push(`Low ceiling BKN/OVC (${src})`);
    assets.push(ceilWorst !== null && ceilWorst < 200 ? "Ceiling <200ft" : "Ceiling <1000ft");
  }

  if (combinedForHazard && hasWindGustOver25Kt(combinedForHazard)) {
    severity = strongest(severity, "OPERATIONAL");
    parts.push("Strong wind / gusts (>25 kt)");
    assets.push("Wind/gust");
  }

  if (combinedForHazard && hasWindShearHint(combinedForHazard)) {
    severity = strongest(severity, "OPERATIONAL");
    parts.push("Wind shear reported or forecast");
    assets.push("Wind shear");
  }

  if (taf.trim() && hasTafDeteriorationHint(taf)) {
    severity = strongest(severity, "OPERATIONAL");
    parts.push("TAF temporal changes (BECMG/TEMPO) — review trend");
    assets.push("TAF trend");
  }

  if (parts.length === 0) return null;

  const roleLabel =
    role === "departure"
      ? "Departure"
      : role === "arrival"
        ? "Arrival"
        : role === "alternate"
          ? "Alternate"
          : "Airport";

  const title = `${airport} Weather risk (${roleLabel} window)`;
  const message = parts.join(" · ");

  const impact =
    severity === "CRITICAL"
      ? `${roleLabel}: possible approach minima / alternate or delay decision`
      : `${roleLabel}: operational caution — monitor METAR/TAF updates`;

  /** Hazard predicate for TAF segments (overlap computed in hazardIntervalsFromTaf). */
  const segmentHazard = (text: string): boolean => {
    const c = text.toUpperCase();
    if (/\bTS\b|\bCB\b/.test(c)) return true;
    if (/\bSHRA\b/.test(c)) return true;
    if (/\bFG\b|\bBR\b/.test(c)) return true;
    if (minVisibilityMeters(text) !== null && visSeverity(minVisibilityMeters(text)).hit) return true;
    if (lowestCeilingFt(text) !== null && ceilingSeverity(lowestCeilingFt(text)).hit) return true;
    if (hasWindGustOver25Kt(text)) return true;
    if (hasWindShearHint(text)) return true;
    return false;
  };

  let barStart: Date;
  let barEnd: Date;
  if (tafParsed) {
    barStart = tafParsed.validFrom;
    barEnd = tafParsed.validTo;
  } else if (taf.trim()) {
    barStart = new Date(flightStart.getTime() - 12 * 3600000);
    barEnd = new Date(flightEnd.getTime() + 12 * 3600000);
  } else {
    barStart = new Date(flightStart.getTime() - 3 * 3600000);
    barEnd = new Date(flightEnd.getTime() + 3 * 3600000);
  }
  if (metarWin) {
    barStart = new Date(Math.min(barStart.getTime(), metarWin.start.getTime()));
    barEnd = new Date(Math.max(barEnd.getTime(), metarWin.end.getTime()));
  }

  const hazardIntervals: Array<{ start: number; end: number }> = [];

  if (metarRelevant && metarText) {
    const h = intersectRange(
      metarWin!.start.getTime(),
      metarWin!.end.getTime(),
      roleWin.start.getTime(),
      roleWin.end.getTime(),
      flightWin.start.getTime(),
      flightWin.end.getTime(),
    );
    if (h && segmentHazard(metarText)) {
      hazardIntervals.push(h);
    }
  }

  if (tafParsed) {
    const fromTaf = hazardIntervalsFromTaf(tafParsed, roleWin, flightWin, segmentHazard);
    hazardIntervals.push(...fromTaf);
  } else if (taf.trim() && segmentHazard(taf)) {
    const rs = roleWin.start.getTime();
    const re = roleWin.end.getTime();
    const fs = flightWin.start.getTime();
    const fe = flightWin.end.getTime();
    const s = Math.max(rs, fs);
    const e = Math.min(re, fe);
    if (s < e) hazardIntervals.push({ start: s, end: e });
  }

  const merged = mergeIntervalsToBounds(hazardIntervals);
  let hazardOverlapStart: Date;
  let hazardOverlapEnd: Date;
  if (merged) {
    hazardOverlapStart = merged.start;
    hazardOverlapEnd = merged.end;
  } else {
    hazardOverlapStart = roleWin.start;
    hazardOverlapEnd = roleWin.end;
  }

  const { timeline, timelineUI } = buildWeatherTimelineModel({
    barStart,
    barEnd,
    flightStart,
    flightEnd,
    hazardOverlapStart,
    hazardOverlapEnd,
  });

  return {
    airport,
    severity,
    type: "WEATHER",
    title,
    message,
    affectedAssets: [...new Set(assets)],
    impact,
    activeDuringFlight: timeline.overlapRatio > 0,
    timeline,
    timelineUI,
    source: "TAF + METAR",
  };
}
