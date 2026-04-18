import { NextResponse } from "next/server";

import type { BriefingWeather, EnrichedBriefing } from "@/lib/briefing-parser";
import { parseBriefing } from "@/lib/briefing-parser";
import { getAirportLatLng } from "@/lib/airports-supabase";
import { getRunways } from "@/lib/runways-supabase";
import { getMetar, getTaf } from "@/lib/avwx";
import { extractTextFromPDF } from "@/lib/pdf";
import type { OperationalRiskAlert } from "@/lib/notam-risk-engine";
import { buildMergedWeatherRiskAlert } from "@/lib/weather-ops";

type InboundEmailPayload = {
  from?: string;
  text?: string;
  subject?: string;
  /** Base64-encoded PDF from dashboard upload (same processing as email attachment). */
  file?: string;
  attachments?: Array<{
    filename?: string;
    contentType?: string;
    content?: string;
    base64?: string;
  }>;
};

function normalizeBase64Pdf(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("data:")) {
    const marker = "base64,";
    const idx = trimmed.indexOf(marker);
    return idx >= 0 ? trimmed.slice(idx + marker.length) : trimmed;
  }
  return trimmed;
}

function getPdfAttachment(payload: InboundEmailPayload): string | null {
  if (!payload.attachments || payload.attachments.length === 0) {
    return null;
  }

  const pdf = payload.attachments.find((attachment) => {
    const filename = attachment.filename?.toLowerCase() ?? "";
    const contentType = attachment.contentType?.toLowerCase() ?? "";
    return contentType.includes("pdf") || filename.endsWith(".pdf");
  });

  if (!pdf) {
    return null;
  }

  return pdf.base64 ?? pdf.content ?? null;
}

async function fetchAirportWeather(airport: string): Promise<{
  airport: string;
  metar: string;
  taf: string;
  raw: { metar: unknown; taf: unknown };
  timestamp: string;
}> {
  try {
    const [metarData, tafData] = await Promise.all([getMetar(airport), getTaf(airport)]);
    return {
      airport,
      metar: typeof metarData?.raw === "string" ? metarData.raw : "",
      taf: typeof tafData?.raw === "string" ? tafData.raw : "",
      raw: { metar: metarData, taf: tafData },
      timestamp: new Date().toISOString(),
    };
  } catch {
    return {
      airport,
      metar: "",
      taf: "",
      raw: { metar: null, taf: null },
      timestamp: new Date().toISOString(),
    };
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as InboundEmailPayload;
    const sender = payload.from?.trim() ?? null;
    const subject = payload.subject?.trim() ?? null;

    const fileField =
      typeof payload.file === "string" && payload.file.trim().length > 0
        ? normalizeBase64Pdf(payload.file)
        : "";
    const attachmentPdf = getPdfAttachment(payload);
    const pdfBase64 = fileField || attachmentPdf || null;
    const bodyText = payload.text?.trim() ?? "";

    let pdfText = "";

    if (pdfBase64) {
      pdfText = await extractTextFromPDF(Buffer.from(pdfBase64, "base64"));
    } else if (bodyText) {
      pdfText = bodyText;
    } else {
      return NextResponse.json(
        { error: "Missing PDF (file/attachments), or email text body, in inbound payload" },
        { status: 400 },
      );
    }

    const extractedLines = pdfText.split(/\r?\n/);
    const previewLines = extractedLines.slice(0, 50);
    const parsedBriefing = parseBriefing(pdfText);
    const airports = [
      parsedBriefing.summary.departure,
      parsedBriefing.summary.destination,
      parsedBriefing.summary.alternate,
      parsedBriefing.summary.takeoffAlternate,
      parsedBriefing.summary.secondAlternate,
    ].filter((a, i, arr): a is string => Boolean(a) && arr.indexOf(a) === i);
    const weatherResults = await Promise.all(airports.map((icao) => fetchAirportWeather(icao)));
    const runwayResults = await Promise.all(airports.map(async (icao) => [icao, await getRunways(icao)] as const));
    const airportCoordResults = await Promise.all(
      airports.map(async (icao) => [icao, await getAirportLatLng(icao)] as const),
    );
    const runways: NonNullable<EnrichedBriefing["runways"]> = {};
    for (const [icao, rows] of runwayResults) {
      runways[icao.trim().toUpperCase()] = rows;
    }
    const airportCoords: NonNullable<EnrichedBriefing["airportCoords"]> = {};
    for (const [icao, ll] of airportCoordResults) {
      const k = icao.trim().toUpperCase();
      if (ll) airportCoords[k] = ll;
    }

    const weather: BriefingWeather = {};
    const weatherAlerts: OperationalRiskAlert[] = [];
    for (const result of weatherResults) {
      const wkey = result.airport.trim().toUpperCase();
      weather[wkey] = {
        updated: result.timestamp,
        metar: result.metar,
        taf: result.taf,
      };
      const w = buildMergedWeatherRiskAlert(wkey, result.metar, result.taf, parsedBriefing.summary);
      if (w) {
        weatherAlerts.push(w);
      }
    }
    const enrichedBriefing: EnrichedBriefing = {
      ...parsedBriefing,
      weather,
      runways,
      airportCoords,
      alerts: [...parsedBriefing.alerts, ...weatherAlerts],
      notams: "",
    };
    console.log("[briefing:extract] first_50_lines_start");
    previewLines.forEach((line, idx) => {
      console.log(`[briefing:extract] ${idx + 1}: ${line}`);
    });
    console.log("[briefing:extract] first_50_lines_end");

    return NextResponse.json({
      ok: true,
      sender,
      subject,
      extractionMode: true,
      lineCount: extractedLines.length,
      previewLines,
      extractedText: pdfText,
      parsedBriefing: enrichedBriefing,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected inbound email error";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
