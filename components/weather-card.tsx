"use client";

import type { CSSProperties } from "react";
import { metarToVisualConditions } from "@/lib/metar-current-conditions";
import {
  ceilingValueClass,
  crosswindValueClass,
  tempValueClass,
  visibilityValueClass,
  windSpeedValueClass,
} from "@/lib/weather-metric-styles";
import type { NotamRunwayClosureSource } from "@/lib/runway-notam-closures";
import type { RunwayRow } from "@/lib/runways-wind";
import { formatMetarObsAgeAgo, metarObservationToken } from "@/lib/taf-timeline";

type WeatherCardProps = {
  /** Role (DEP, DEST, T/O ALT, …); used for accessibility — the visible title is `icao` only. */
  label: string;
  icao: string;
  metar?: string;
  runways?: RunwayRow[];
  /** NOTAM-derived alerts; used to skip closed runways for Est. RWY / crosswind. */
  notamAlerts?: readonly NotamRunwayClosureSource[];
  /** Merged onto the root card for layout accents (e.g. DEP/DEST tint). */
  className?: string;
  /** Overrides default slate age styling (e.g. fresh / stale tint). */
  metarAgeSuffixClassName?: string;
};

/** Smaller relative age (e.g. `02h13 ago`); optional `leading` (default ` · `). Tooltip shows raw `DDHHMMZ`. */
export function MetarAgeSuffix({
  metar,
  className = "font-mono text-[10px] font-medium text-slate-400",
  leading = " · ",
  style,
}: {
  metar?: string;
  className?: string;
  /** Set to `""` when spacing is handled by layout (e.g. flex gap). */
  leading?: string;
  style?: CSSProperties;
}) {
  const age = formatMetarObsAgeAgo(metar);
  if (!age) return null;
  const rawToken = metarObservationToken(metar);
  return (
    <span className={className} style={style} title={rawToken ? `METAR obs ${rawToken}` : undefined}>
      {leading}
      {age}
    </span>
  );
}

function windColor(crosswind: number | null, headwind: number | null): string {
  if (crosswind == null || headwind == null) return "text-sky-300";
  if (headwind < 0 || crosswind >= 15) return "text-red-400";
  if (crosswind >= 8) return "text-amber-400";
  return "text-emerald-400";
}

/** Shown when METAR has no discrete wind direction (e.g. calm / VRB) — keeps layout aligned with WindArrow. */
function WindDirectionPlaceholder({ colorClass }: { colorClass: string }) {
  return (
    <span
      className={`flex items-center justify-center ${colorClass}`}
      role="img"
      aria-label="Wind direction not reported"
      title="Wind direction not reported"
    >
      <svg className="h-3.5 w-7" viewBox="0 0 28 12" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
        <path d="M2 3.5 Q7 1 12 3.5 T22 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <path d="M2 7 Q7 5 12 7 T22 7" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
        <path d="M2 10.5 Q7 8.5 12 10.5 T22 10.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </svg>
    </span>
  );
}

export function WindArrow({
  direction,
  speedKt,
  gustKt,
  colorClass,
}: {
  direction: number | null;
  speedKt: number;
  gustKt: number | null;
  colorClass: string;
}) {
  if (direction == null) return null;
  const metarFrom = ((direction % 360) + 360) % 360;
  const toDirection = (metarFrom + 180) % 360;
  const windText =
    gustKt != null
      ? `${String(metarFrom).padStart(3, "0")}/${speedKt}G${gustKt}KT`
      : `${String(metarFrom).padStart(3, "0")}/${speedKt}KT`;
  return (
    <div className={`flex items-center justify-center gap-2 font-mono text-[10px] font-semibold ${colorClass}`}>
      <div className="relative h-3 w-6" aria-hidden style={{ transform: `rotate(${toDirection}deg)` }}>
        <div className="absolute left-0 top-1/2 h-[1.5px] w-6 -translate-y-1/2 bg-current" />
        <div className="absolute right-0 top-1/2 h-0 w-0 -translate-y-1/2 border-b-[4px] border-l-[6px] border-t-[4px] border-b-transparent border-l-current border-t-transparent" />
      </div>
      <span className="text-white">{windText}</span>
    </div>
  );
}

export function RunwayDiagram({
  runways,
}: {
  runways: RunwayRow[];
}) {
  /** Perpendicular offset so parallel L/C/R/G runways do not visually collapse (e.g. ESSA). */
  const runwayOffsetPx = (ident: string, headingDeg: number): number => {
    const suffix = ident.trim().toUpperCase().slice(-1);
    let base = 0;
    if (suffix === "L") base = -15;
    else if (suffix === "R") base = 15;
    else if (suffix === "C") base = 0;
    else if (suffix === "G") base = 22;

    // Mirror side on reciprocal headings so 04L aligns with 22R (and 04R with 22L).
    const normalized = ((headingDeg % 360) + 360) % 360;
    return normalized >= 180 ? -base : base;
  };

  return (
    <div className="relative mx-auto mt-1.5 h-28 w-full max-w-44 rounded-md border border-slate-700 bg-slate-900/80">
      <div className="absolute inset-0 m-2 rounded border border-slate-800/70" />
      {runways.map((r, idx) => {
        const heading = ((Number(r.heading) % 360) + 360) % 360;
        const cssRotation = heading - 90;
        const yOffset = runwayOffsetPx(r.ident, heading);
        return (
          <div
            key={`${r.ident}-${idx}`}
            className="absolute left-1/2 top-1/2 h-[2px] w-[52%] bg-white"
            style={{
              transform: `translate(calc(-50% + 12px), calc(-50% + ${yOffset}px)) rotate(${cssRotation}deg)`,
            }}
          >
            <span
              className="absolute left-0 top-1/2 font-mono text-[10px] font-semibold text-white"
              style={{ transform: "translate(-108%, -50%) rotate(90deg)", transformOrigin: "center" }}
            >
              {r.ident}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function WeatherIcons({
  temp,
  vis,
  ceiling,
  qnh,
  windMain,
  windSuffix,
  windSpeedKt,
  windGustKt,
  crosswind,
  gustCrosswind,
}: {
  temp: string;
  vis: string;
  ceiling: string;
  /** Altimeter string from METAR (`1013 hPa`, `29.92 inHg`); `N/A` hides QNH. */
  qnh: string;
  windMain: string;
  /** Runway / XW parenthetical; empty when not applicable. */
  windSuffix: string;
  windSpeedKt: number;
  windGustKt: number | null;
  crosswind: number | null;
  gustCrosswind: number | null;
}) {
  const speedClass = windSpeedValueClass(windSpeedKt, windGustKt);
  const xwClass =
    crosswind != null ? crosswindValueClass(crosswind, gustCrosswind) : speedClass;

  return (
    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] leading-snug">
      <p className="text-slate-200">
        🌡{" "}
        <span className={`font-mono text-sm font-semibold ${tempValueClass(temp)}`}>{temp}</span>
      </p>
      <p className="text-slate-200">
        👁{" "}
        <span className={`font-mono text-sm font-semibold ${visibilityValueClass(vis)}`}>{vis}</span>
      </p>
      <p className="col-span-2 text-slate-200">
        💨{" "}
        <span className={`font-mono text-sm font-semibold ${speedClass}`}>{windMain}</span>
        {windSuffix ? (
          <span className={`font-mono text-sm font-semibold ${xwClass}`}>{windSuffix}</span>
        ) : null}
      </p>
      <p className="col-span-2 min-w-0 truncate whitespace-nowrap text-xs leading-snug text-slate-200">
        ☁{" "}
        <span className={`font-mono font-semibold ${ceilingValueClass(ceiling)}`}>{ceiling}</span>
        {qnh !== "N/A" ? (
          <span className="ml-1.5 font-mono font-semibold text-slate-500">
            QNH {qnh}
          </span>
        ) : null}
      </p>
    </div>
  );
}

export function WeatherCard({
  label,
  icao,
  metar,
  runways = [],
  notamAlerts,
  className = "",
  metarAgeSuffixClassName,
}: WeatherCardProps) {
  const usableRunways = runways.filter((r) => !r.ident.trim().toUpperCase().endsWith("G"));
  const d = metarToVisualConditions(metar, icao, usableRunways, { notamAlerts });
  const cw = d.components?.crosswind ?? null;
  const hw = d.components?.headwind ?? null;
  const arrowColor = windColor(cw, hw);

  const windSuffix =
    d.isVrb || !d.bestRunway || !d.components
      ? ""
      : ` (Est. RWY ${d.bestRunway.ident}, XW ${d.components.crosswind}${
            d.windGustKt != null && d.components.gustCrosswind != null
              ? `G${d.components.gustCrosswind}`
              : ""
          }kt)`;

  return (
    <div
      className={`flex h-full min-h-0 flex-col rounded-md border border-slate-700 bg-slate-950 p-3 text-slate-100 shadow-sm ${className}`.trim()}
    >
      <div className="mb-1.5 flex min-w-0 shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="font-mono text-sm font-semibold text-white" aria-label={`${label}, ${icao}`}>
          {icao}
        </p>
        <MetarAgeSuffix
          metar={metar}
          leading=""
          className={
            metarAgeSuffixClassName ?? "font-mono text-[10px] font-medium text-slate-400"
          }
        />
      </div>
      <RunwayDiagram runways={usableRunways} />
      <div className="mt-1 flex min-h-[2.75rem] shrink-0 items-center justify-center">
        {d.windDir != null ? (
          <WindArrow direction={d.windDir} speedKt={d.windSpeedKt} gustKt={d.windGustKt} colorClass={arrowColor} />
        ) : (
          <WindDirectionPlaceholder colorClass={arrowColor} />
        )}
      </div>
      <WeatherIcons
        temp={d.temp}
        vis={d.visibility}
        ceiling={d.ceiling}
        qnh={d.qnh}
        windMain={d.windDisplay}
        windSuffix={windSuffix}
        windSpeedKt={d.windSpeedKt}
        windGustKt={d.windGustKt}
        crosswind={d.components?.crosswind ?? null}
        gustCrosswind={d.components?.gustCrosswind ?? null}
      />
    </div>
  );
}
