"use client";

import { useEffect, useState } from "react";
import { MetarAgeSuffix, WeatherCard } from "@/components/weather-card";
import {
  computeRefuelEuUpliftLb,
  extraFuelLineColorClass,
  jetFuelLbToLiters,
  type PaxBreakdown,
} from "@/lib/briefing-parser";
import { alertAirportRouteOrderRank } from "@/lib/alert-airport-order";
import { alertSeverityDisplayLabel } from "@/lib/alert-severity-display";
import { metarAgeFreshnessClass, metarAgeFreshnessHex } from "@/lib/metar-age-style";
import { metarObservationAgeMinutes } from "@/lib/taf-timeline";
import type { RunwayRow } from "@/lib/runways-wind";
import { FlightRouteMap } from "@/components/flight-route-map";
import { mapPinCoordsForAirport } from "@/lib/airport-coordinates";

type NotamFlightAlert = {
  severity: "CRITICAL" | "OPERATIONAL" | "INFO";
  type: "RUNWAY" | "ILS" | "TAXIWAY" | "VOR" | "GATE" | "RAMP" | "OBSTACLE" | "WEATHER";
  airport: string;
  title: string;
  message: string;
  affectedAssets: string[];
  activeDuringFlight: boolean;
  impact: string;
  source: string;
  notamCategory?: string;
};

type ParsedBriefing = {
  summary: {
    departure: string;
    destination: string;
    alternate: string;
    takeoffAlternate?: string;
    secondAlternate?: string;
    eobt: string;
    flightTime: string;
    aircraft: string;
    registration: string;
    regulation?: string;
    pax: number;
    paxBreakdown?: PaxBreakdown;
    cruiseFlightLevel?: string;
    callSign?: string;
    planDistanceNm?: number;
    depLatLng?: { lat: number; lng: number };
    destLatLng?: { lat: number; lng: number };
    releaseComments?: string;
    prohibitedOpsNotes?: string;
  };
  fuel: {
    block: number;
    trip: number;
    minRequired: number;
    taxi: number;
    fuelIndexDep?: string;
    fuelIndexArr?: string;
    extraFuelLb: number | null;
  };
  weights: { tow: number; ldw: number };
  alerts: NotamFlightAlert[];
  weather: Record<string, { updated: string; metar: string; taf: string }>;
  runways?: Record<string, RunwayRow[]>;
  airportCoords?: Record<string, { lat: number; lng: number }>;
};

type BriefingResponse = { parsedBriefing: ParsedBriefing; error?: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") return reject(new Error("Could not read file"));
      const marker = "base64,";
      const idx = result.indexOf(marker);
      resolve(idx >= 0 ? result.slice(idx + marker.length) : result);
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function rankSeveritySort(s: NotamFlightAlert["severity"]): number {
  if (s === "CRITICAL") return 0;
  if (s === "OPERATIONAL") return 1;
  return 2;
}

function compareAlertsUi(a: NotamFlightAlert, b: NotamFlightAlert): number {
  const sev = rankSeveritySort(a.severity) - rankSeveritySort(b.severity);
  if (sev !== 0) return sev;
  if (a.activeDuringFlight !== b.activeDuringFlight) return a.activeDuringFlight ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function alertDisplayMessageUi(a: NotamFlightAlert): string | null {
  const t = a.title.trim();
  const m = a.message.trim();
  if (!m || m === t) return null;
  const fold = (s: string) => s.replace(/\s+/g, " ").replace(/—/g, "-").toLowerCase();
  if (fold(m) === fold(t)) return null;
  if (m.startsWith(t)) {
    const rest = m.slice(t.length).replace(/^[\s—:,.-]+/, "").trim();
    return rest.length ? rest : null;
  }
  return m;
}

function severityEmojiUi(s: NotamFlightAlert["severity"]): string {
  if (s === "CRITICAL") return "🔴";
  if (s === "OPERATIONAL") return "🟠";
  return "🔵";
}

function alertStyle(s: NotamFlightAlert["severity"]): "crit" | "warn" | "info" {
  if (s === "CRITICAL") return "crit";
  if (s === "OPERATIONAL") return "warn";
  return "info";
}

function runwayKey(icao: string | undefined): string {
  return (icao ?? "").trim().toUpperCase();
}

/** Rows for PAX card: omit zeros; C / I / Pet abbreviations; gender as `M · F · X`. */
function paxBreakdownRows(d: PaxBreakdown): { key: string; label: string; value: string }[] {
  const rows: { key: string; label: string; value: string }[] = [];
  if (d.adults != null && d.adults > 0) rows.push({ key: "adults", label: "No of Adults", value: String(d.adults) });
  if (d.passengerCount != null && d.passengerCount > 0) {
    rows.push({ key: "pc", label: "Passenger Count", value: String(d.passengerCount) });
  }
  if (d.children != null && d.children > 0) rows.push({ key: "ch", label: "C", value: String(d.children) });
  if (d.infants != null && d.infants > 0) rows.push({ key: "inf", label: "I", value: String(d.infants) });
  const g: string[] = [];
  if (d.male != null && d.male > 0) g.push(`M ${d.male}`);
  if (d.female != null && d.female > 0) g.push(`F ${d.female}`);
  if (d.otherGender != null && d.otherGender > 0) g.push(`X ${d.otherGender}`);
  if (g.length) rows.push({ key: "gen", label: "", value: g.join(" · ") });
  const petU = d.petUnder != null && d.petUnder > 0;
  const petO = d.petOver != null && d.petOver > 0;
  if (petU || petO) {
    const parts: string[] = [];
    if (petU) parts.push(`u${d.petUnder}`);
    if (petO) parts.push(`o${d.petOver}`);
    rows.push({ key: "pet", label: "Pet", value: parts.join(" · ") });
  }
  return rows;
}

export default function BriefingPage() {
  const [data, setData] = useState<BriefingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const runBriefing = async () => {
    setError(null);
    setData(null);
    if (!file) {
      setError("Select a PDF flight package first.");
      return;
    }
    setLoading(true);
    try {
      const pdfBase64 = await fileToBase64(file);
      const response = await fetch("/api/inbound-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "pilot@test.local",
          subject: "Flight Release Upload",
          file: pdfBase64,
        }),
      });
      const json = (await response.json()) as BriefingResponse;
      if (!response.ok) throw new Error(json.error ?? "Failed to process uploaded PDF");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected client error");
    } finally {
      setLoading(false);
    }
  };

  const [nowUtc, setNowUtc] = useState(() => {
    const now = new Date();
    const d = `${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
    const t = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}Z`;
    return `${d} ${t}`;
  });
  useEffect(() => {
    const format = () => {
      const now = new Date();
      const d = `${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
      const t = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}Z`;
      setNowUtc(`${d} ${t}`);
    };
    const id = window.setInterval(format, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const summary = data?.parsedBriefing.summary;
  const weights = data?.parsedBriefing.weights;
  const weather = data?.parsedBriefing.weather ?? {};
  const runways = data?.parsedBriefing.runways ?? {};
  const airportCoords = data?.parsedBriefing.airportCoords ?? {};
  const alerts = data?.parsedBriefing.alerts ?? [];
  const groupedAlerts = alerts.reduce<Record<string, NotamFlightAlert[]>>((acc, a) => {
    if (!acc[a.airport]) acc[a.airport] = [];
    acc[a.airport].push(a);
    return acc;
  }, {});
  const sortedAlertAirports = Object.keys(groupedAlerts).sort((a, b) => {
    if (!summary) return a.localeCompare(b);
    const ra = alertAirportRouteOrderRank(a, summary);
    const rb = alertAirportRouteOrderRank(b, summary);
    if (ra !== rb) return ra - rb;
    const worst = (k: string) => Math.min(...groupedAlerts[k]!.map((x) => rankSeveritySort(x.severity)));
    const d = worst(a) - worst(b);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });

  const airportScore = (icao: string): number => {
    const scoped = alerts.filter((a) => a.airport === icao);
    if (scoped.some((a) => a.severity === "CRITICAL")) return 88;
    if (scoped.some((a) => a.severity === "OPERATIONAL")) return 55;
    return scoped.length ? 25 : 10;
  };

  const depCoords = summary
    ? mapPinCoordsForAirport(summary.departure, airportCoords[runwayKey(summary.departure)])
    : undefined;
  const destCoords = summary
    ? mapPinCoordsForAirport(summary.destination, airportCoords[runwayKey(summary.destination)])
    : undefined;

  return (
    <div className="uiLab">
      <style jsx global>{`
        .uiLab{background:#09090f;color:#e8e8f0;min-height:100vh;font-family: 'DM Sans', sans-serif}
        .uiApp{display:grid;grid-template-rows:minmax(60px,auto) minmax(220px,36vh) minmax(0,1fr);min-height:100vh;max-width:1400px;margin:0 auto}
        .mapStage{border-bottom:1px solid rgba(255,255,255,.12);background:#0c0c14;min-height:0;position:relative}
        .topbar{display:flex;align-items:center;border-bottom:1px solid rgba(255,255,255,.12);background:#0f0f18;padding:0 18px;gap:14px;min-height:60px;box-sizing:border-box}
        .logo{font-family:'Syne',sans-serif;font-weight:800;letter-spacing:.08em;color:#00d4ff}
        .topbarCluster{display:flex;flex-wrap:wrap;align-items:center;gap:10px;flex-shrink:0}
        .topbarLoad{display:flex;flex-direction:column;justify-content:center;gap:3px;padding:0 12px;border-left:1px solid rgba(255,255,255,.08);border-right:1px solid rgba(255,255,255,.08);flex:0 1 auto;min-width:0;max-width:min(260px,34vw)}
        .topbarLoadHead{font-family:monospace;font-size:7px;font-weight:600;letter-spacing:.14em;color:#9a9ab5;text-transform:uppercase;line-height:1;margin:0}
        .topbarLoadRow{display:flex;align-items:center;gap:6px;flex-wrap:nowrap;min-width:0}
        .topbarLoadRow input[type="file"]{font-size:10px;max-width:min(130px,18vw);min-width:0;color:#c4c4da}
        .topbarLoadRow button.btn{padding:5px 10px;font-size:10px;margin-top:0;border-radius:6px;font-weight:600;white-space:nowrap}
        .topbarLoadErr{font-size:9px;color:#ff8080;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .flightId{font-family:monospace;background:#1c1c2a;border:1px solid rgba(255,255,255,.12);padding:6px 11px;border-radius:8px;font-size:12px;font-weight:600}
        .route{flex:1;display:flex;justify-content:center;align-items:center;gap:10px;font-family:monospace;min-width:0}
        .routeIcao{font-size:20px;font-weight:800;letter-spacing:.04em;color:#f4f4ff}
        .routeArrow{color:#00d4ff;font-size:18px;font-weight:700}
        .eobtPill{font-size:11px;font-weight:600;color:#a8a8c0;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:#14141f}
        .main{display:grid;grid-template-columns:260px 1fr 300px;min-height:0;overflow:hidden}
        .left,.right{background:#0f0f18;overflow:auto}
        .left{border-right:1px solid rgba(255,255,255,.07)} .right{border-left:1px solid rgba(255,255,255,.07)}
        .centre{padding:22px 20px 28px;overflow:auto}
        .pl{padding:14px 16px 8px;font-family:monospace;font-size:10px;letter-spacing:.15em;color:#9a9ab5;text-transform:uppercase}
        .facts{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 16px 18px}
        .fact{background:#14141f;border:1px solid rgba(255,255,255,.09);border-radius:10px;padding:11px 12px;transition:background .15s ease,border-color .15s ease}
        .fact:hover{background:#18182a;border-color:rgba(255,255,255,.14)}
        .k{font-size:10px;color:#9a9ab5;font-family:monospace;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
        .v{font-family:monospace;font-weight:800;font-size:15px;color:#f4f4ff;margin-top:4px;line-height:1.25}
        .paxDetailScroll{margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;gap:2px;font-size:9px;line-height:1.25;font-weight:600;color:#a8a8c0;font-family:monospace}
        .leftDivider{height:1px;margin:4px 16px 12px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent)}
        .secHeader{display:flex;gap:10px;align-items:baseline;margin-bottom:14px;margin-top:8px}
        .secTitle{font-family:'Syne',sans-serif;font-weight:700;font-size:19px;letter-spacing:-.02em}
        .secSub{font-family:monospace;font-size:11px;color:#9a9ab5}
        .wxLiveSub{font-family:monospace;font-size:10px;font-weight:600;color:#9a9ab5;letter-spacing:.12em;margin-bottom:10px}
        .wxDepWrap{border-radius:10px;padding:2px 2px 0;background:linear-gradient(135deg,rgba(56,189,248,.12),transparent)}
        .wxDestWrap{border-radius:10px;padding:2px 2px 0;background:linear-gradient(135deg,rgba(167,139,250,.22),rgba(109,40,217,.08))}
        .wxLiveShell{border-radius:10px;padding:12px;background:rgba(20,20,31,.85);border:1px solid rgba(255,255,255,.08);margin-bottom:18px}
        .wxTop{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:stretch}
        .wxAlt{margin-top:14px}
        .wxAlt details,.prohibitedOpsBlock details,.releaseCommentsBlock details{background:#14141f;border:1px solid rgba(255,255,255,.08);border-radius:10px;transition:border-color .15s ease,background .15s ease}
        .wxAlt details:hover,.prohibitedOpsBlock details:hover,.releaseCommentsBlock details:hover{border-color:rgba(255,255,255,.16)}
        .wxAlt summary,.prohibitedOpsBlock summary,.releaseCommentsBlock summary{cursor:pointer;list-style:none;padding:11px 14px;font-family:monospace;font-size:12px;color:#c4c4da;display:flex;align-items:center;gap:8px}
        .wxAlt summary::-webkit-details-marker,.prohibitedOpsBlock summary::-webkit-details-marker,.releaseCommentsBlock summary::-webkit-details-marker{display:none}
        .wxAlt summary .chev,.prohibitedOpsBlock summary .chev,.releaseCommentsBlock summary .chev{color:#7a7a9a;font-size:11px;transition:transform .2s ease;display:inline-block}
        .wxAlt details[open] summary .chev,.prohibitedOpsBlock details[open] summary .chev,.releaseCommentsBlock details[open] summary .chev{transform:rotate(90deg)}
        .wxAltBody{padding:0 12px 12px}
        .notesSection{margin-top:26px;margin-bottom:22px}
        .notesSection>h2.pl{margin:0;font-weight:600;font-size:10px}
        .notesStack{display:flex;flex-direction:column;gap:10px}
        @keyframes riskAlertCritPulse{
          0%,100%{box-shadow:0 0 0 0 rgba(255,59,59,.12),inset 0 0 0 1px rgba(255,59,59,.08);border-left-color:#ff3b3b}
          50%{box-shadow:0 0 14px 1px rgba(255,59,59,.22),inset 0 0 12px rgba(255,59,59,.06);border-left-color:#ff5c5c}
        }
        @media (prefers-reduced-motion:reduce){
          .alert.crit{animation:none!important}
        }
        .alert{border-left:5px solid;border-radius:10px;padding:12px 14px;margin-bottom:12px;background:#14141f;transition:box-shadow .15s ease,background .15s ease}
        .alert:hover{box-shadow:0 4px 20px rgba(0,0,0,.35)}
        .alert.crit{border-color:#ff3b3b;background:rgba(255,59,59,.1);animation:riskAlertCritPulse 2.75s ease-in-out infinite}
        .alert.warn{border-color:#f5a623;background:rgba(245,166,35,.1)}
        .alert.info{border-color:#4a9eff;background:rgba(74,158,255,.1)}
        .tag{font-family:monospace;font-size:10px;padding:3px 7px;border-radius:4px;margin-right:6px;font-weight:600}
        .btn{background:#2563eb;color:white;border:0;border-radius:8px;padding:9px 14px;margin-top:8px;font-weight:600}
      `}</style>

      <div className="uiApp">
        <header className="topbar">
          <div className="topbarCluster">
            <div className="logo">BRIEF<span style={{ color: "#7a7a9a", fontWeight: 400 }}>PAK</span></div>
            <div className="flightId">{summary?.registration || summary?.aircraft || "FLIGHT"}</div>
          </div>
          <div className="topbarLoad">
            <div className="topbarLoadHead">Load Flight Package</div>
            <div className="topbarLoadRow">
              <input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <button className="btn" onClick={runBriefing} disabled={loading || !file}>
                {loading ? "Processing..." : "Generate Briefing"}
              </button>
            </div>
            {error ? <div className="topbarLoadErr">{error}</div> : null}
          </div>
          <div className="route">
            <span className="routeIcao">{summary?.departure || "----"}</span>
            <span className="routeArrow" aria-hidden>
              →
            </span>
            <span className="routeIcao">{summary?.destination || "----"}</span>
            <span className="eobtPill">EOBT {summary?.eobt || "--:--Z"}</span>
          </div>
          <div style={{ fontFamily: "monospace", color: "#9a9ab5", fontSize: 11, marginLeft: "auto", flexShrink: 0 }}>
            {nowUtc}
          </div>
        </header>

        <div className="mapStage" aria-label="Route map">
          <FlightRouteMap
            briefingLoaded={!!data}
            departure={summary?.departure}
            destination={summary?.destination}
            depLatLng={depCoords}
            destLatLng={destCoords}
            eobt={summary?.eobt}
            flightTime={summary?.flightTime}
            cruiseFlightLevel={summary?.cruiseFlightLevel}
            pax={summary?.pax}
            registration={summary?.registration}
            aircraft={summary?.aircraft}
            callSign={summary?.callSign}
            planDistanceNm={summary?.planDistanceNm}
          />
        </div>

        <div className="main">
          <aside className="left">
            <div className="pl">Flight info</div>
            <div className="facts">
              <div className="fact">
                <div className="k">TAIL</div>
                <div className="v">{(summary?.registration ?? "").trim() || "—"}</div>
              </div>
              <div className="fact">
                <div className="k">TYPE</div>
                <div className="v">{(summary?.aircraft ?? "").trim() || "—"}</div>
              </div>
              <div className="fact">
                <div className="k">REG</div>
                <div className="v">{(summary?.regulation ?? "").trim() || "—"}</div>
              </div>
              <div className="fact">
                <div className="k">PAX</div>
                <div className="v">{summary?.pax ?? 0}</div>
                {summary?.paxBreakdown ? (
                  <div className="paxDetailScroll">
                    {paxBreakdownRows(summary.paxBreakdown).map((r) => (
                      <div
                        key={r.key}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "baseline",
                          gap: 4,
                        }}
                      >
                        {r.label ? <span style={{ color: "#7a7a94", fontWeight: 600 }}>{r.label}</span> : <span />}
                        <span style={{ color: "#e0e0f0", fontWeight: 700, textAlign: "right" }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="fact">
                <div className="k">TOW</div>
                <div className="v">{weights?.tow != null && weights.tow > 0 ? `${weights.tow} lbs` : "—"}</div>
              </div>
              <div className="fact">
                <div className="k">LDW</div>
                <div className="v">{weights?.ldw != null && weights.ldw > 0 ? `${weights.ldw} lbs` : "—"}</div>
              </div>
            </div>
            <div className="leftDivider" aria-hidden />
            <div className="pl">Fuel state</div>
            <div
              style={{
                padding: "0 16px 14px",
                borderBottom: "1px solid rgba(255,255,255,.07)",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              {(() => {
                const f = data?.parsedBriefing.fuel;
                const refuel =
                  f != null
                    ? computeRefuelEuUpliftLb({
                        trip: f.trip ?? 0,
                        taxi: f.taxi ?? 0,
                        fuelIndexDep: f.fuelIndexDep,
                      })
                    : null;
                const refuelL = refuel != null ? Math.round(jetFuelLbToLiters(refuel)) : null;
                const upliftColor = refuel != null ? "#f59e0b" : "#22c55e";
                return (
                  <>
                    <div style={{ marginBottom: 6 }}>Trip: {f?.trip ?? 0} lbs</div>
                    <div style={{ marginBottom: 6 }}>Min Req: {f?.minRequired ?? 0} lbs</div>
                    <div
                      style={{ marginBottom: 6, fontSize: 10, lineHeight: 1.35 }}
                      className={extraFuelLineColorClass(f?.extraFuelLb ?? null)}
                    >
                      Extra Fuel: {f?.extraFuelLb != null ? `${f.extraFuelLb} lbs` : "—"}
                    </div>
                    <div style={{ marginBottom: 6 }}>Total Fuel: {f?.block ?? 0} lbs</div>
                    <div style={{ marginBottom: 0, fontSize: 10, lineHeight: 1.35 }}>
                      ReFuelEU:{" "}
                      {refuel != null ? (
                        <span style={{ color: upliftColor, fontWeight: 600 }}>
                          {refuel} lbs ({refuelL} L){" "}
                          <span style={{ fontWeight: 500, opacity: 0.92 }}>(minimum)</span>
                        </span>
                      ) : (
                        <span style={{ color: upliftColor, fontWeight: 600 }}>N/A</span>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            <div className="leftDivider" aria-hidden />
            <div className="pl">Risk score by airport</div>
            <div style={{ padding: "0 16px 16px", fontFamily: "monospace", fontSize: 12 }}>
              {[summary?.departure, summary?.destination, summary?.alternate].filter(Boolean).map((icao) => (
                <div key={icao} style={{ marginBottom: 8, display: "grid", gridTemplateColumns: "44px 1fr 36px", gap: 8 }}>
                  <span>{icao}</span>
                  <div style={{ background: "#1c1c2a", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{ height: 6, width: `${airportScore(icao!)}%`, background: airportScore(icao!) > 70 ? "#ff3b3b" : airportScore(icao!) > 40 ? "#f5a623" : "#2dce72" }} />
                  </div>
                  <span style={{ textAlign: "right" }}>{airportScore(icao!)}</span>
                </div>
              ))}
            </div>
          </aside>

          <main className="centre">
            <p className="wxLiveSub">LIVE CONDITIONS (METAR)</p>
            <div className="wxLiveShell">
              <div className="wxTop">
                {summary?.departure ? (
                  <div className="wxDepWrap">
                    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#38bdf8", margin: "0 0 6px 4px" }}>
                      DEP
                    </p>
                    <WeatherCard
                      label="DEP"
                      icao={runwayKey(summary.departure)}
                      metar={weather[runwayKey(summary.departure)]?.metar}
                      runways={runways[runwayKey(summary.departure)]}
                      notamAlerts={alerts}
                      metarAgeSuffixClassName={`font-mono text-[10px] font-semibold ${metarAgeFreshnessClass(
                        metarObservationAgeMinutes(weather[runwayKey(summary.departure)]?.metar),
                        "dark",
                      )}`}
                    />
                  </div>
                ) : null}
                {summary?.destination ? (
                  <div className="wxDestWrap">
                    <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#c4b5fd", margin: "0 0 6px 4px" }}>
                      DEST
                    </p>
                    <WeatherCard
                      label="DEST"
                      icao={runwayKey(summary.destination)}
                      metar={weather[runwayKey(summary.destination)]?.metar}
                      runways={runways[runwayKey(summary.destination)]}
                      notamAlerts={alerts}
                      className="ring-1 ring-violet-500/35"
                      metarAgeSuffixClassName={`font-mono text-[10px] font-semibold ${metarAgeFreshnessClass(
                        metarObservationAgeMinutes(weather[runwayKey(summary.destination)]?.metar),
                        "dark",
                      )}`}
                    />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="wxAlt">
              {summary?.takeoffAlternate ? (
                <details>
                  <summary>
                    <span className="chev" aria-hidden>
                      ▸
                    </span>
                    <span>
                      <span style={{ color: "#9a9ab5", fontWeight: 600 }}>T/O ALT</span>
                      <span style={{ color: "#5b5b78" }}> — </span>
                      <span style={{ color: "#f4f4ff", fontWeight: 700 }}>{runwayKey(summary.takeoffAlternate)}</span>
                      <MetarAgeSuffix
                        metar={weather[runwayKey(summary.takeoffAlternate)]?.metar}
                        className="font-mono text-[10px] font-semibold"
                        style={{ color: metarAgeFreshnessHex(metarObservationAgeMinutes(weather[runwayKey(summary.takeoffAlternate)]?.metar)) }}
                      />
                    </span>
                  </summary>
                  <div className="wxAltBody">
                    <WeatherCard
                      label="T/O ALT"
                      icao={runwayKey(summary.takeoffAlternate)}
                      metar={weather[runwayKey(summary.takeoffAlternate)]?.metar}
                      runways={runways[runwayKey(summary.takeoffAlternate)]}
                      notamAlerts={alerts}
                    />
                  </div>
                </details>
              ) : null}
              {summary?.alternate ? (
                <details style={{ marginTop: 10 }}>
                  <summary>
                    <span className="chev" aria-hidden>
                      ▸
                    </span>
                    <span>
                      <span style={{ color: "#9a9ab5", fontWeight: 600 }}>1ST ALT</span>
                      <span style={{ color: "#5b5b78" }}> — </span>
                      <span style={{ color: "#f4f4ff", fontWeight: 700 }}>{runwayKey(summary.alternate)}</span>
                      <MetarAgeSuffix
                        metar={weather[runwayKey(summary.alternate)]?.metar}
                        className="font-mono text-[10px] font-semibold"
                        style={{ color: metarAgeFreshnessHex(metarObservationAgeMinutes(weather[runwayKey(summary.alternate)]?.metar)) }}
                      />
                    </span>
                  </summary>
                  <div className="wxAltBody">
                    <WeatherCard
                      label="1ST ALT"
                      icao={runwayKey(summary.alternate)}
                      metar={weather[runwayKey(summary.alternate)]?.metar}
                      runways={runways[runwayKey(summary.alternate)]}
                      notamAlerts={alerts}
                    />
                  </div>
                </details>
              ) : null}
              {summary?.secondAlternate ? (
                <details style={{ marginTop: 10 }}>
                  <summary>
                    <span className="chev" aria-hidden>
                      ▸
                    </span>
                    <span>
                      <span style={{ color: "#9a9ab5", fontWeight: 600 }}>2ND ALT</span>
                      <span style={{ color: "#5b5b78" }}> — </span>
                      <span style={{ color: "#f4f4ff", fontWeight: 700 }}>{runwayKey(summary.secondAlternate)}</span>
                      <MetarAgeSuffix
                        metar={weather[runwayKey(summary.secondAlternate)]?.metar}
                        className="font-mono text-[10px] font-semibold"
                        style={{ color: metarAgeFreshnessHex(metarObservationAgeMinutes(weather[runwayKey(summary.secondAlternate)]?.metar)) }}
                      />
                    </span>
                  </summary>
                  <div className="wxAltBody">
                    <WeatherCard
                      label="2ND ALT"
                      icao={runwayKey(summary.secondAlternate)}
                      metar={weather[runwayKey(summary.secondAlternate)]?.metar}
                      runways={runways[runwayKey(summary.secondAlternate)]}
                      notamAlerts={alerts}
                    />
                  </div>
                </details>
              ) : null}
            </div>

            <section className="notesSection" aria-labelledby="notes-heading">
              <h2 id="notes-heading" className="pl" style={{ paddingTop: 0 }}>
                Notes
              </h2>
              <div className="notesStack">
                <div className="releaseCommentsBlock">
                  <details>
                    <summary>
                      <span className="chev" aria-hidden>
                        ▸
                      </span>
                      <span>
                        <span style={{ color: "#9a9ab5", fontWeight: 600 }}>Release Comments</span>
                      </span>
                    </summary>
                    <div className="wxAltBody">
                      <div
                        style={{
                          padding: "12px 14px",
                          background: "rgba(20,20,31,.75)",
                          border: "1px solid rgba(255,255,255,.08)",
                          borderRadius: 10,
                          fontFamily: "monospace",
                          fontSize: 12,
                          lineHeight: 1.55,
                          color: "#d4d4e8",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {(summary?.releaseComments ?? "").trim() || "—"}
                      </div>
                    </div>
                  </details>
                </div>

                <div className="prohibitedOpsBlock">
                  <details>
                    <summary>
                      <span className="chev" aria-hidden>
                        ▸
                      </span>
                      <span>
                        <span style={{ color: "#9a9ab5", fontWeight: 600 }}>Prohibited Ops / Critical Notes</span>
                      </span>
                    </summary>
                    <div className="wxAltBody">
                      <div
                        style={{
                          padding: "12px 14px",
                          background: "rgba(20,20,31,.75)",
                          border: "1px solid rgba(255,255,255,.08)",
                          borderRadius: 10,
                          fontFamily: "monospace",
                          fontSize: 12,
                          lineHeight: 1.55,
                          color: "#d4d4e8",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {(summary?.prohibitedOpsNotes ?? "").trim() || "—"}
                      </div>
                    </div>
                  </details>
                </div>
              </div>
            </section>
          </main>

          <aside className="right">
            <div className="pl">Risk Alerts</div>
            <div style={{ padding: "0 12px 16px", fontSize: 11 }}>
              <div style={{ fontSize: 10, lineHeight: 1.35, color: "#9a9ab5", marginBottom: 12, fontFamily: "monospace" }}>
                {alerts.length} items · airports: DEP → T/O ALT → DEST → alts, then severity & in-flight
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {sortedAlertAirports.map((ap) => {
                  const items = [...(groupedAlerts[ap] ?? [])].sort(compareAlertsUi);
                  return (
                    <div key={ap}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          marginBottom: 8,
                          paddingBottom: 4,
                          borderBottom: "1px solid rgba(255,255,255,.1)",
                          gap: 6,
                        }}
                      >
                        <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 800, color: "#f4f4ff" }}>{ap}</span>
                        {items.length > 1 ? (
                          <span style={{ fontSize: 9, fontWeight: 700, color: "#9a9ab5", letterSpacing: "0.06em", flexShrink: 0 }}>
                            {items.length} ALERTS
                          </span>
                        ) : null}
                      </div>
                      {items.map((a, idx) => {
                        const msg = alertDisplayMessageUi(a);
                        return (
                          <div key={`${ap}-${idx}`} className={`alert ${alertStyle(a.severity)}`} style={{ padding: "10px 10px", marginBottom: idx < items.length - 1 ? 8 : 0 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 14 }} aria-hidden title={alertSeverityDisplayLabel(a.severity)}>
                                {severityEmojiUi(a.severity)}
                              </span>
                              <span className="tag" style={{ background: "rgba(255,255,255,.1)", fontSize: 9 }}>
                                {alertSeverityDisplayLabel(a.severity)}
                              </span>
                              <span className="tag" style={{ background: "rgba(255,255,255,.06)", fontSize: 9 }}>
                                {a.type}
                              </span>
                              <span
                                style={{
                                  marginLeft: "auto",
                                  fontFamily: "monospace",
                                  fontSize: 8,
                                  fontWeight: 800,
                                  letterSpacing: "0.04em",
                                  padding: "2px 6px",
                                  borderRadius: 6,
                                  border: "1px solid",
                                  ...(a.activeDuringFlight
                                    ? { color: "#fecaca", background: "rgba(127,29,29,.35)", borderColor: "rgba(248,113,113,.4)" }
                                    : { color: "#9a9ab5", background: "rgba(255,255,255,.05)", borderColor: "rgba(255,255,255,.1)" }),
                                }}
                              >
                                ACTIVE: {a.activeDuringFlight ? "YES" : "NO"}
                              </span>
                            </div>
                            <div style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 800, lineHeight: 1.35, color: "#f8f8ff" }}>{a.title}</div>
                            {msg ? (
                              <div style={{ marginTop: 5, fontSize: 10, lineHeight: 1.45, color: "#a8a8c0" }}>{msg}</div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
