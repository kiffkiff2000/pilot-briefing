export type MapPinCoordSource = "supabase_airports" | "none";

export type MapPinCoordTrace = {
  icao: string;
  coords: { lat: number; lng: number } | undefined;
  source: MapPinCoordSource;
  /** Step-by-step explanation for debugging */
  lines: string[];
};

/**
 * Map pins use **only** Supabase `airports` ARP lat/lng (see `getAirportLatLng`). No runways, static, or geocoding.
 */
export function mapPinCoordsForAirport(
  icao: string | undefined,
  airportArp: { lat: number; lng: number } | undefined,
): { lat: number; lng: number } | undefined {
  return explainMapPinCoords(icao, airportArp).coords;
}

/**
 * Trace: ICAO → `airportCoords[ICAO]` from API (loaded via `airports` table).
 */
export function explainMapPinCoords(
  icao: string | undefined,
  airportArp: { lat: number; lng: number } | undefined,
): MapPinCoordTrace {
  const k = (icao ?? "").trim().toUpperCase();
  const lines: string[] = [];

  lines.push(`Step 1 — ICAO from parsed briefing summary: "${k || "(empty)"}"`);

  if (!k) {
    lines.push(`Step 2 — Cannot look up airports without an ICAO.`);
    lines.push(`Step 3 — No depLatLng/destLatLng; map does not geocode airport pins.`);
    return { icao: k, coords: undefined, source: "none", lines };
  }

  lines.push(`Step 2 — Dictionary key: airportCoords["${k}"] (must match exactly).`);

  if (airportArp && Number.isFinite(airportArp.lat) && Number.isFinite(airportArp.lng)) {
    lines.push(`Step 3 — Row from Supabase table \`airports\` (ARP): lat=${airportArp.lat}, lng=${airportArp.lng}`);
    lines.push(`→ SOURCE FOR MAP: Supabase \`airports\` only (depLatLng / destLatLng on FlightRouteMap).`);
    return { icao: k, coords: airportArp, source: "supabase_airports", lines };
  }

  lines.push(`Step 3 — No coordinates for "${k}" (missing \`airports\` row or lat/lng columns).`);
  lines.push(`Step 4 — No static or geocode fallback; pin omitted until \`airports\` has data for this ICAO.`);
  return { icao: k, coords: undefined, source: "none", lines };
}
