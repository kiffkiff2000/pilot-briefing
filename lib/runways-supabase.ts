import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { RunwayRow } from "./runways-wind";

export type { RunwayRow };

/** In-memory cache: successful loads only (never cache empty — DB can be filled later without redeploy). */
const runwayCache = new Map<string, RunwayRow[]>();
const CACHE_KEY_VER = "v4-supabase-pins-only";

function getClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function normalizeDbRows(raw: Record<string, unknown>[], logicalIcao: string): RunwayRow[] {
  const rows: RunwayRow[] = [];
  for (const r of raw) {
    const airportKey =
      (typeof r.icao === "string" ? r.icao : null) ??
      (typeof r.ident === "string" ? r.ident : null) ??
      (typeof r.icao_code === "string" ? r.icao_code : null);
    if (!airportKey) continue;
    if (airportKey.trim().toUpperCase() !== logicalIcao) continue;

    const identVal = r.runwayID ?? r.runway_id ?? r.runway_ident ?? r.rwy ?? airportKey;
    const headingVal = r.heading ?? r.bearing ?? r.runway_heading ?? 0;
    const headingParsed = Number(headingVal);
    const heading = Number.isFinite(headingParsed) ? headingParsed : 0;

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
    if (Number.isFinite(lat) && Number.isFinite(lng) && (Math.abs(lat) > 90 || Math.abs(lng) > 180)) {
      const t = lat;
      lat = lng;
      lng = t;
    }

    rows.push({
      icao: logicalIcao,
      ident: String(identVal),
      heading,
      ...(Number.isFinite(lat) ? { latitudeDeg: lat } : {}),
      ...(Number.isFinite(lng) ? { longitudeDeg: lng } : {}),
    });
  }
  return rows;
}

/**
 * Load runways for an airport and include optional lat/lng from DB columns
 * (`latitude_deg`, `longitude_deg`). Supports either `icao` or `ident` as airport key.
 */
export async function getRunways(icao: string): Promise<RunwayRow[]> {
  const key = icao.trim().toUpperCase();
  if (!key) return [];

  const hit = runwayCache.get(`${CACHE_KEY_VER}:${key}`);
  if (hit) return hit;

  const supabase = getClient();
  if (!supabase) {
    return [];
  }

  const attempts = [
    () => supabase.from("runways").select("*").eq("icao", key),
    () => supabase.from("runways").select("*").ilike("icao", key),
    () => supabase.from("runways").select("*").ilike("icao", `${key}%`),
    () => supabase.from("runways").select("*").eq("ident", key),
    () => supabase.from("runways").select("*").ilike("ident", key),
  ] as const;

  for (const run of attempts) {
    const { data, error } = await run();
    if (error) {
      if (process.env.NODE_ENV === "development") {
        console.warn("[getRunways]", key, error.message);
      }
      continue;
    }
    const raw = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const rows = normalizeDbRows(raw, key);
    if (rows.length > 0) {
      runwayCache.set(`${CACHE_KEY_VER}:${key}`, rows);
      return rows;
    }
  }

  return [];
}
