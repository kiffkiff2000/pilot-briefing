/**
 * Flight-package “flight plan” coordinates (common European OFP layout):
 * - Latitude: N/S + 5 digits → degrees (2) + minutes with tenths (MM.M): e.g. N43366 → 43°36.6′ N
 * - Longitude: E/W + 6 digits → degrees (3) + minutes with tenths (MM.M): e.g. E007196 → 007°19.6′ E
 *
 * DEP = first pair, DEST = second. If `T/O FUEL` … `LANDING FUEL` exists and contains two pairs,
 * only pairs from that block are used (keeps NOTAM coordinates out).
 */

export type LatLngDecimal = { lat: number; lng: number };

function decodeLatitude(hem: string, d5: string): number | null {
  if (!/^[NS]$/.test(hem) || !/^\d{5}$/.test(d5)) return null;
  const deg = Number.parseInt(d5.slice(0, 2), 10);
  const minInt = Number.parseInt(d5.slice(2, 4), 10);
  const minTenth = Number.parseInt(d5.slice(4, 5), 10) / 10;
  const minutes = minInt + minTenth;
  if (deg > 90 || minutes >= 60) return null;
  const v = deg + minutes / 60;
  return hem === "S" ? -v : v;
}

function decodeLongitude(hem: string, d6: string): number | null {
  if (!/^[EW]$/.test(hem) || !/^\d{6}$/.test(d6)) return null;
  const deg = Number.parseInt(d6.slice(0, 3), 10);
  const minInt = Number.parseInt(d6.slice(3, 5), 10);
  const minTenth = Number.parseInt(d6.slice(5, 6), 10) / 10;
  const minutes = minInt + minTenth;
  if (deg > 180 || minutes >= 60) return null;
  const v = deg + minutes / 60;
  return hem === "W" ? -v : v;
}

/** Single line e.g. `N43366 E007196` */
export function parseLatLonPairLine(line: string): LatLngDecimal | null {
  const m = line.match(/\b([NS])(\d{5})\s+([EW])(\d{6})\b/);
  if (!m) return null;
  const lat = decodeLatitude(m[1]!, m[2]!);
  const lng = decodeLongitude(m[3]!, m[4]!);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * All `N/S ddmm.m E/W dddmm.m` pairs in reading order.
 */
export function collectLatLonPairsFromText(text: string): LatLngDecimal[] {
  const re = /\b([NS])(\d{5})\s+([EW])(\d{6})\b/g;
  const out: LatLngDecimal[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lat = decodeLatitude(m[1]!, m[2]!);
    const lng = decodeLongitude(m[3]!, m[4]!);
    if (lat == null || lng == null) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push({ lat, lng });
  }
  return out;
}

/**
 * First pair → DEP, second → DEST (when present).
 */
function extractFlightPlanSlice(upper: string): string | null {
  const start = upper.search(/\bT\/?O\s+FUEL\b/);
  const end = upper.search(/\bLANDING\s+FUEL\b/);
  if (start >= 0 && end > start) return upper.slice(start, end);
  return null;
}

export function extractDepDestLatLngFromFlightPackage(text: string): {
  dep?: LatLngDecimal;
  dest?: LatLngDecimal;
} {
  const u = text.toUpperCase();
  const slice = extractFlightPlanSlice(u);
  let pairs: LatLngDecimal[] = [];
  if (slice) {
    const inSlice = collectLatLonPairsFromText(slice);
    if (inSlice.length >= 2) pairs = inSlice;
  }
  if (pairs.length < 2) {
    pairs = collectLatLonPairsFromText(u);
  }
  return {
    ...(pairs[0] ? { dep: pairs[0] } : {}),
    ...(pairs[1] ? { dest: pairs[1] } : {}),
  };
}
