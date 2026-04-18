export async function getMetar(icao: string) {
  const apiKey = process.env.AVWX_API_KEY;

  if (!apiKey) {
    throw new Error("AVWX_API_KEY is not set");
  }

  const response = await fetch(
    `https://avwx.rest/api/metar/${encodeURIComponent(icao)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`AVWX request failed with status ${response.status}`);
  }

  return response.json();
}

export async function getTaf(icao: string) {
  const apiKey = process.env.AVWX_API_KEY;

  if (!apiKey) {
    throw new Error("AVWX_API_KEY is not set");
  }

  const response = await fetch(
    `https://avwx.rest/api/taf/${encodeURIComponent(icao)}?format=json`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`AVWX request failed with status ${response.status}`);
  }

  return response.json();
}

/** Returns empty raw text on failure so callers can continue (e.g. NOTAM-only briefing). */
export async function fetchMetarText(icao: string): Promise<{ raw: string; error: string | null }> {
  try {
    const data = await getMetar(icao);
    return { raw: data.raw ?? "", error: null };
  } catch (e) {
    return {
      raw: "",
      error: e instanceof Error ? e.message : "AVWX METAR error",
    };
  }
}

/** Returns empty raw text on failure so callers can continue (e.g. NOTAM-only briefing). */
export async function fetchTafText(icao: string): Promise<{ raw: string; error: string | null }> {
  try {
    const data = await getTaf(icao);
    return { raw: data.raw ?? "", error: null };
  } catch (e) {
    return {
      raw: "",
      error: e instanceof Error ? e.message : "AVWX TAF error",
    };
  }
}
