"use client";

import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource } from "mapbox-gl";

type FlightRouteMapProps = {
  departure?: string;
  destination?: string;
  /** From Supabase `airports` ARP (parent passes lat/lng from API); no geocoding fallback in this component. */
  depLatLng?: { lat: number; lng: number };
  destLatLng?: { lat: number; lng: number };
  /** When true, show overlays (after Generate Briefing). */
  briefingLoaded?: boolean;
  eobt?: string;
  flightTime?: string;
  /** e.g. FL350 from cruise/profile lines */
  cruiseFlightLevel?: string;
  pax?: number;
  registration?: string;
  aircraft?: string;
  /** From `PLAN … NJE837Q LEBL TO …` (flight ID). */
  callSign?: string;
  /** Planned distance (NM) from package `DEST …` fuel / planning row. */
  planDistanceNm?: number;
};

const DEFAULT_CENTER: [number, number] = [8.5, 46.2];
const DEFAULT_ZOOM = 4.2;

const PIN = {
  dep: { color: "#00d4ff" },
  dest: { color: "#a78bfa" },
};

function pinLabel(kind: "dep" | "dest", icao: string | null): string {
  const k = icao?.trim().toUpperCase() || "—";
  return kind === "dep" ? `DEP ${k}` : `DEST ${k}`;
}

function normalizeIcao(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().toUpperCase();
  return /^[A-Z0-9]{3,4}$/.test(s) ? s : null;
}

function formatEte(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  if (!t) return "—";
  const compact = t.replace(/:/g, "");
  if (/^\d{4}$/.test(compact)) return `${compact.slice(0, 2)}:${compact.slice(2)}`;
  return t;
}

export function FlightRouteMap({
  departure,
  destination,
  depLatLng,
  destLatLng,
  briefingLoaded,
  eobt,
  flightTime,
  cruiseFlightLevel,
  pax,
  registration,
  aircraft,
  callSign,
  planDistanceNm,
}: FlightRouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import("mapbox-gl").Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [noToken, setNoToken] = useState(false);
  /** Geographic midpoint of DEP–DEST for the route HUD (great-circle midpoint approx). */
  const [routeMid, setRouteMid] = useState<[number, number] | null>(null);
  /** Pixel position of route HUD inside the map container. */
  const [routeHudPx, setRouteHudPx] = useState<{ x: number; y: number } | null>(null);

  const showFlightOverlay = Boolean(briefingLoaded);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let cancelled = false;
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      setNoToken(true);
      return;
    }

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      await import("mapbox-gl/dist/mapbox-gl.css");
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = token;
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: true,
      });
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: false }), "top-right");
      map.on("load", () => {
        if (!cancelled) {
          mapRef.current = map;
          setMapReady(true);
        }
      });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!mapReady || noToken) return;
    const map = mapRef.current;
    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!map || !token) return;

    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      const depIcao = normalizeIcao(departure);
      const destIcao = normalizeIcao(destination);

      setRouteMid(null);

      const resolved: {
        dep?: { lng: number; lat: number };
        dest?: { lng: number; lat: number };
      } = {};

      if (depLatLng) {
        resolved.dep = { lng: depLatLng.lng, lat: depLatLng.lat };
      }
      if (destLatLng) {
        resolved.dest = { lng: destLatLng.lng, lat: destLatLng.lat };
      }

      if (cancelled) return;

      const airportCollection: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: [],
      };

      const depPt = resolved.dep;
      const destPt = resolved.dest;
      const sameCoords =
        depPt &&
        destPt &&
        Math.abs(depPt.lat - destPt.lat) < 1e-5 &&
        Math.abs(depPt.lng - destPt.lng) < 1e-5;
      const sameAirport =
        depPt &&
        destPt &&
        ((depIcao && destIcao && depIcao === destIcao) || sameCoords);

      if (sameAirport) {
        const icao = depIcao ?? destIcao ?? "—";
        airportCollection.features.push({
          type: "Feature",
          properties: {
            label: `DEP · DEST ${icao}`,
            color: PIN.dep.color,
          },
          geometry: { type: "Point", coordinates: [depPt.lng, depPt.lat] },
        });
      } else {
        if (depPt) {
          airportCollection.features.push({
            type: "Feature",
            properties: {
              label: pinLabel("dep", depIcao),
              color: PIN.dep.color,
            },
            geometry: { type: "Point", coordinates: [depPt.lng, depPt.lat] },
          });
        }
        if (destPt) {
          airportCollection.features.push({
            type: "Feature",
            properties: {
              label: pinLabel("dest", destIcao),
              color: PIN.dest.color,
            },
            geometry: { type: "Point", coordinates: [destPt.lng, destPt.lat] },
          });
        }
      }

      const lineCoords: [number, number][] = [];
      if (depPt && destPt && !sameAirport) {
        lineCoords.push([depPt.lng, depPt.lat], [destPt.lng, destPt.lat]);
        setRouteMid([(depPt.lng + destPt.lng) / 2, (depPt.lat + destPt.lat) / 2]);
      } else if (depPt && destPt && sameAirport) {
        setRouteMid([depPt.lng, depPt.lat]);
      } else {
        setRouteMid(null);
      }

      const lineCollection: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features:
          lineCoords.length >= 2
            ? [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: lineCoords },
                },
              ]
            : [],
      };

      const ensureLineLayer = () => {
        if (!map.getSource("flight-path")) {
          map.addSource("flight-path", { type: "geojson", data: lineCollection });
          map.addLayer({
            id: "flight-path-line",
            type: "line",
            source: "flight-path",
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#00d4ff",
              "line-width": 4,
              "line-opacity": 0.92,
              "line-dasharray": [2, 1.5],
            },
          });
        } else {
          (map.getSource("flight-path") as GeoJSONSource).setData(lineCollection);
        }
      };

      const ensureAirportLayers = () => {
        if (!map.getSource("flight-airports")) {
          map.addSource("flight-airports", { type: "geojson", data: airportCollection });
          map.addLayer({
            id: "flight-airports-pulse",
            type: "circle",
            source: "flight-airports",
            paint: {
              "circle-radius": 26,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.22,
              "circle-blur": 0.85,
            },
          });
          map.addLayer({
            id: "flight-airports-glow",
            type: "circle",
            source: "flight-airports",
            paint: {
              "circle-radius": 18,
              "circle-color": ["get", "color"],
              "circle-opacity": 0.42,
            },
          });
          map.addLayer({
            id: "flight-airports-dot",
            type: "circle",
            source: "flight-airports",
            paint: {
              "circle-radius": 7,
              "circle-color": ["get", "color"],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#0f0f18",
            },
          });
          map.addLayer({
            id: "flight-airports-labels",
            type: "symbol",
            source: "flight-airports",
            layout: {
              "text-field": ["get", "label"],
              "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Regular"],
              "text-size": 12,
              "text-offset": [0, 1.5],
              "text-anchor": "top",
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": ["get", "color"],
              "text-halo-color": "#0a0a12",
              "text-halo-width": 1.6,
            },
          });
        } else {
          (map.getSource("flight-airports") as GeoJSONSource).setData(airportCollection);
        }
      };

      ensureLineLayer();
      ensureAirportLayers();

      const bounds = new mapboxgl.LngLatBounds();
      if (depPt) bounds.extend([depPt.lng, depPt.lat]);
      if (destPt) bounds.extend([destPt.lng, destPt.lat]);
      for (const c of lineCoords) bounds.extend(c);

      if (!depPt && !destPt) {
        map.easeTo({ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, duration: 500 });
      } else if (depPt && destPt) {
        map.fitBounds(bounds, {
          padding: { top: 72, bottom: 48, left: 32, right: 32 },
          maxZoom: 12,
          duration: 650,
        });
      } else {
        const p = depPt ?? destPt!;
        map.easeTo({ center: [p.lng, p.lat], zoom: 8.5, duration: 600 });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    mapReady,
    noToken,
    departure,
    destination,
    depLatLng?.lat,
    depLatLng?.lng,
    destLatLng?.lat,
    destLatLng?.lng,
  ]);

  /** Subtle pulse on glow + outer blur ring (Mapbox paint animation). */
  useEffect(() => {
    if (!mapReady || noToken) return;
    let frame = 0;
    const tick = () => {
      const map = mapRef.current;
      if (!map?.getLayer("flight-airports-glow")) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const t = Date.now() / 1000;
      // Slightly slower + smaller amplitude than before so pins feel less “flashy”.
      const wave = 0.5 + 0.5 * Math.sin(t * 2.45);
      const wave2 = 0.5 + 0.5 * Math.sin(t * 1.9 + 1.1);
      try {
        map.setPaintProperty("flight-airports-glow", "circle-opacity", 0.28 + 0.33 * wave);
        map.setPaintProperty("flight-airports-glow", "circle-radius", 16 + 7 * wave);
        if (map.getLayer("flight-airports-pulse")) {
          map.setPaintProperty("flight-airports-pulse", "circle-opacity", 0.11 + 0.3 * wave2);
          map.setPaintProperty("flight-airports-pulse", "circle-radius", 22 + 14 * wave2);
        }
      } catch {
        /* layer removed */
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [mapReady, noToken, departure, destination, depLatLng?.lat, depLatLng?.lng, destLatLng?.lat, destLatLng?.lng]);

  useEffect(() => {
    if (!mapReady || noToken || !routeMid) {
      setRouteHudPx(null);
      return;
    }
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      try {
        const p = map.project(routeMid);
        setRouteHudPx({ x: p.x, y: p.y });
      } catch {
        setRouteHudPx(null);
      }
    };

    map.on("move", update);
    map.on("zoom", update);
    map.on("resize", update);
    update();

    return () => {
      map.off("move", update);
      map.off("zoom", update);
      map.off("resize", update);
    };
  }, [mapReady, noToken, routeMid]);

  const flDisplay = cruiseFlightLevel?.trim() || "—";
  const eteDisplay = formatEte(flightTime);
  const paxDisplay = typeof pax === "number" && pax >= 0 ? String(pax) : "—";
  const distDisplay =
    typeof planDistanceNm === "number" && planDistanceNm > 0 ? `${planDistanceNm} NM` : "—";

  if (noToken) {
    return (
      <div
        style={{
          width: "100%",
          height: "100%",
          minHeight: 220,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #0f1118 0%, #0a0a10 100%)",
          borderBottom: "1px solid rgba(255,255,255,.1)",
          padding: 20,
          textAlign: "center",
          fontFamily: "monospace",
          fontSize: 12,
          color: "#9a9ab5",
        }}
      >
        Set <span style={{ color: "#00d4ff" }}>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</span> in{" "}
        <span style={{ color: "#e8e8f0" }}>.env.local</span> to load the Mapbox map.
      </div>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 220 }}>
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {routeHudPx && routeMid ? (
        <div
          style={{
            position: "absolute",
            left: routeHudPx.x,
            top: routeHudPx.y,
            zIndex: 3,
            transform: "translate(-50%, calc(-100% - 44px))",
            pointerEvents: "none",
            fontFamily: "monospace",
            textAlign: "center",
            padding: "5px 8px",
            borderRadius: 7,
            background: "rgba(10,10,16,0.92)",
            border: "1px solid rgba(0,212,255,0.28)",
            boxShadow: "0 4px 16px rgba(0,0,0,.4)",
            maxWidth: 200,
          }}
        >
          <div style={{ fontSize: 8, letterSpacing: "0.16em", color: "#7a7a94", marginBottom: 3 }}>
            ENROUTE
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#00d4ff", lineHeight: 1.15 }}>
            {flDisplay}
          </div>
          <div style={{ marginTop: 3, fontSize: 10, fontWeight: 700, color: "#d8d8e8" }}>
            {distDisplay}
          </div>
          <div style={{ marginTop: 2, fontSize: 10, fontWeight: 700, color: "#d8d8e8" }}>
            ETE {eteDisplay}
          </div>
          <div style={{ marginTop: 2, fontSize: 9, fontWeight: 600, color: "#8e8ea8" }}>
            PAX {paxDisplay}
          </div>
        </div>
      ) : null}

      {showFlightOverlay ? (
        <div
          style={{
            position: "absolute",
            left: 12,
            top: 10,
            zIndex: 2,
            pointerEvents: "none",
            fontFamily: "monospace",
            fontSize: 13,
            color: "#e8e8f0",
            textShadow: "0 1px 3px rgba(0,0,0,.85)",
            lineHeight: 1.5,
            maxWidth: "min(92%, 520px)",
          }}
        >
          <div
            style={{
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: "0.06em",
              color: "#00d4ff",
              marginBottom: 5,
            }}
          >
            FLIGHT
          </div>
          <div>
            <span style={{ color: "#9a9ab5" }}>DEP </span>
            <span style={{ fontWeight: 700 }}>{(departure ?? "—").trim() || "—"}</span>
            <span style={{ color: "#5b5b78", margin: "0 8px" }}>→</span>
            <span style={{ color: "#9a9ab5" }}>DEST </span>
            <span style={{ fontWeight: 700 }}>{(destination ?? "—").trim() || "—"}</span>
          </div>
          <div>
            <span style={{ color: "#9a9ab5" }}>EOBT </span>
            <span style={{ fontWeight: 700 }}>{eobt?.trim() || "—"}</span>
          </div>
          {(registration || aircraft) && (
            <div style={{ marginTop: 3 }}>
              <span style={{ color: "#9a9ab5" }}>AC </span>
              <span style={{ fontWeight: 700 }}>{[registration, aircraft].filter(Boolean).join(" · ")}</span>
            </div>
          )}
          <div style={{ marginTop: 3 }}>
            <span style={{ color: "#9a9ab5" }}>CALL SIGN </span>
            <span style={{ fontWeight: 700 }}>{callSign?.trim() || "—"}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
