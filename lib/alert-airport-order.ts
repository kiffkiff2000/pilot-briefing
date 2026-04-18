/** Minimal summary fields needed to order alert blocks along the route. */
export type FlightRouteSummaryIcao = {
  departure: string;
  destination: string;
  alternate: string;
  takeoffAlternate?: string;
  secondAlternate?: string;
};

export function briefingIcaoKey(icao: string | undefined): string {
  return (icao ?? "").trim().toUpperCase();
}

/**
 * Lower = earlier in pilot scan: DEP → T/O ALT → DEST → 1st ALT → 2nd ALT → other airports.
 */
export function alertAirportRouteOrderRank(airport: string, summary: FlightRouteSummaryIcao): number {
  const k = briefingIcaoKey(airport);
  if (!k) return 10_000;
  if (briefingIcaoKey(summary.departure) === k) return 0;
  if (briefingIcaoKey(summary.takeoffAlternate) === k) return 1;
  if (briefingIcaoKey(summary.destination) === k) return 2;
  if (briefingIcaoKey(summary.alternate) === k) return 3;
  if (briefingIcaoKey(summary.secondAlternate) === k) return 4;
  return 1000;
}
