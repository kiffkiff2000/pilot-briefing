const SEPARATOR = "\n========================\n";

export function isStructuredBriefing(text: string): boolean {
  return text.includes("========================") && text.includes("OPERATIONAL SUMMARY");
}

export type BriefingDisplaySections = {
  overview: string;
  weather: string;
  notam: string;
  operationalSummary: string;
};

/**
 * Worst severity present in risk lines. Uses bracket tags `[LEVEL]` from briefing output
 * so summary lines like "No CRITICAL risks" do not false-trigger CRITICAL.
 */
export function extractRiskLevel(text: string): "MINOR" | "MAJOR" | "CRITICAL" {
  if (text.includes("[CRITICAL]")) {
    return "CRITICAL";
  }
  if (text.includes("[MAJOR]")) {
    return "MAJOR";
  }
  return "MINOR";
}

function splitWeatherNotam(body: string): { weather: string; notam: string } {
  const trimmed = body.trim();
  const notamSplit = trimmed.split(/\nNOTAM:\n/);

  if (notamSplit.length < 2) {
    return { weather: trimmed, notam: "" };
  }

  const weatherPart = notamSplit[0]?.trim() ?? "";
  const notamPart = notamSplit.slice(1).join("\nNOTAM:\n").trim();

  return {
    weather: weatherPart,
    notam: notamPart,
  };
}

function classifyAlternateLine(line: string): "weather" | "notam" | "neutral" {
  const upper = line.toUpperCase();
  if (upper.includes("(NOTAM)") || upper.includes("[NOTAM]")) {
    return "notam";
  }
  if (upper.includes("(METAR)") || upper.includes("(TAF)") || upper.includes("[METAR]") || upper.includes("[TAF]")) {
    return "weather";
  }
  return "neutral";
}

function splitAlternatesBody(body: string): { weather: string; notam: string } {
  const weatherLines: string[] = [];
  const notamLines: string[] = [];
  const neutralLines: string[] = [];

  for (const line of body.split("\n")) {
    const kind = classifyAlternateLine(line);
    if (kind === "weather") {
      weatherLines.push(line);
    } else if (kind === "notam") {
      notamLines.push(line);
    } else {
      neutralLines.push(line);
    }
  }

  const header = neutralLines.filter((l) => l.trim().length > 0).join("\n");

  return {
    weather: header ? `${header}\n${weatherLines.join("\n")}`.trim() : weatherLines.join("\n"),
    notam: notamLines.join("\n").trim(),
  };
}

/**
 * Deterministic split of stored briefing_text into display sections (no backend changes).
 */
export function parseBriefingSections(text: string): BriefingDisplaySections {
  if (!text.includes("========================") || !text.includes("OPERATIONAL SUMMARY")) {
    return {
      overview: text.trim(),
      weather: "",
      notam: "",
      operationalSummary: "",
    };
  }

  const parts = text.split(SEPARATOR);
  const overview = parts[0]?.trim() ?? "";

  const opIndex = parts.findIndex((p) => p.trim() === "OPERATIONAL SUMMARY");
  const operationalSummary =
    opIndex >= 0 && parts[opIndex + 1] !== undefined ? parts[opIndex + 1].trim() : "";

  const weatherChunks: string[] = [];
  const notamChunks: string[] = [];

  const endIndex = opIndex >= 0 ? opIndex : parts.length;

  for (let i = 1; i < endIndex; i += 2) {
    const title = parts[i]?.trim() ?? "";
    const body = parts[i + 1] ?? "";

    if (!title || title === "OPERATIONAL SUMMARY") {
      break;
    }

    if (title === "ALTERNATES") {
      const { weather, notam } = splitAlternatesBody(body);
      if (weather) {
        weatherChunks.push(`### Alternates\n${weather}`);
      }
      if (notam) {
        notamChunks.push(`### Alternates\n${notam}`);
      }
      continue;
    }

    if (title.startsWith("DEPARTURE") || title.startsWith("DESTINATION")) {
      const { weather, notam } = splitWeatherNotam(body);
      weatherChunks.push(`### ${title}\n${weather}`);
      notamChunks.push(`### ${title}\n${notam}`);
    }
  }

  return {
    overview,
    weather: weatherChunks.join("\n\n").trim(),
    notam: notamChunks.join("\n\n").trim(),
    operationalSummary,
  };
}
