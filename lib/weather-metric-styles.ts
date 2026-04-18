/** Tailwind text classes for METAR-derived weather values on cards. */

export function parseTempCelsius(temp: string): number | null {
  const m = temp.trim().match(/^(-?\d+)\s*°C$/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

export function tempValueClass(temp: string): string {
  const c = parseTempCelsius(temp);
  if (c == null) return "text-slate-400";
  if (c < 4) return "text-cyan-400";
  if (c <= 29) return "text-emerald-400";
  if (c <= 47) return "text-amber-400";
  return "text-red-400";
}

export function parseVisibilityMeters(vis: string): number | null {
  const v = vis.trim();
  if (!v || v === "N/A") return null;
  if (/^10\+/i.test(v)) return 10_000;
  const km = v.match(/^([\d.]+)\s*km$/i);
  if (km) {
    const n = Number.parseFloat(km[1]!);
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }
  const m = v.match(/^(\d+)\s*m$/i);
  if (m) return Number.parseInt(m[1]!, 10);
  return null;
}

export function visibilityValueClass(vis: string): string {
  const m = parseVisibilityMeters(vis);
  if (m == null) return "text-slate-400";
  if (m < 600) return "text-red-400";
  if (m <= 8000) return "text-amber-400";
  return "text-emerald-400";
}

function peakWindKt(speedKt: number, gustKt: number | null): number {
  return Math.max(speedKt, gustKt ?? 0);
}

export function windSpeedValueClass(speedKt: number, gustKt: number | null): string {
  const peak = peakWindKt(speedKt, gustKt);
  if (peak <= 20) return "text-emerald-400";
  if (peak <= 45) return "text-amber-400";
  return "text-red-400";
}

function peakCrosswindKt(crosswind: number, gustCrosswind: number | null): number {
  return Math.max(Math.abs(crosswind), gustCrosswind != null ? Math.abs(gustCrosswind) : 0);
}

export function crosswindValueClass(crosswind: number, gustCrosswind: number | null): string {
  const peak = peakCrosswindKt(crosswind, gustCrosswind);
  if (peak <= 15) return "text-emerald-400";
  if (peak <= 25) return "text-amber-400";
  return "text-red-400";
}

export type CeilingParse = number | "high" | null;

export function parseCeilingFeet(ceiling: string): CeilingParse {
  const u = ceiling.trim();
  if (!u || u === "N/A") return null;
  if (u === "CAVOK" || /\bno significant clouds\b/i.test(u)) return "high";
  if (u.startsWith(">")) {
    const n = u.match(/>(\d+)/);
    if (n) return Number.parseInt(n[1]!, 10);
    return "high";
  }
  const ft = u.match(/^(\d+)\s*ft$/i);
  if (ft) return Number.parseInt(ft[1]!, 10);
  return "high";
}

export function ceilingValueClass(ceiling: string): string {
  const p = parseCeilingFeet(ceiling);
  if (p == null) return "text-slate-400";
  if (p === "high") return "text-emerald-400";
  if (p < 250) return "text-red-400";
  if (p <= 2000) return "text-amber-400";
  return "text-emerald-400";
}
