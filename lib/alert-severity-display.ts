import type { AlertSeverity } from "@/lib/notam-risk-engine";

/** User-facing label; internal `OPERATIONAL` maps to **CAUTION** everywhere in UI. */
export function alertSeverityDisplayLabel(severity: AlertSeverity): string {
  if (severity === "OPERATIONAL") return "CAUTION";
  return severity;
}
