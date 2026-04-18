import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** In-memory cache: successful loads only (never cache empty). */
const airportCoordCache = new Map<string, { lat: number; lng: number } | null>();
const CACHE_KEY_VER = "v1-airports-arp";

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function coordsFromAirportRow(r: Record<string, unknown>): { lat: number; lng: number } | null {
  const latRaw =
    r.latitude_deg ??
    r.Latitude_Deg ??
    r.latitudeDeg ??
    r.latitude ??
    r.lat ??
    r.Latitude;
  const lngRaw =
    r.longitude_deg ??
    r.Longitude_Deg ??
    r.longitudeDeg ??
    r.longitude ??
    r.lng ??
    r.lon ??
    r.Longitude;
  let lat = latRaw != null ? Number(latRaw) : NaN;
  let lng = lngRaw != null ? Number(lngRaw) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  /** Only fix obvious column swap (values out of valid ranges). */
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    const t = lat;
    lat = lng;
    lng = t;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * One airport reference point from Supabase `airports` (OurAirports-style: `ident` / `icao` + lat/lng).
 * Map pins use this only — not the `runways` table.
 */
export async function getAirportLatLng(icao: string): Promise<{ lat: number; lng: number } | null> {
  const key = icao.trim().toUpperCase();
  if (!key) return null;

  const cacheKey = `${CACHE_KEY_VER}:${key}`;
  if (airportCoordCache.has(cacheKey)) {
    return airportCoordCache.get(cacheKey) ?? null;
  }

  const supabase = getClient();
  if (!supabase) {
    airportCoordCache.set(cacheKey, null);
    return null;
  }

  const queries = [
    () => supabase.from("airports").select("*").eq("ident", key).limit(1),
    () => supabase.from("airports").select("*").eq("icao", key).limit(1),
    () => supabase.from("airports").select("*").eq("gps_code", key).limit(1),
    () => supabase.from("airports").select("*").ilike("ident", key).limit(1),
  ] as const;

  for (const run of queries) {
    const { data, error } = await run();
    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[getAirportLatLng]", key, error.message);
      }
      continue;
    }
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const first = rows[0];
    if (!first) continue;
    const ll = coordsFromAirportRow(first);
    if (ll) {
      airportCoordCache.set(cacheKey, ll);
      return ll;
    }
  }

  airportCoordCache.set(cacheKey, null);
  return null;
}
