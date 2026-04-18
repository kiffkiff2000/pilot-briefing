import Link from "next/link";

import { getBriefings } from "@/lib/db";

import { RiskBadge } from "./risk-badge";
import { TestFlightRelease } from "./test-flight-release";

export default async function DashboardPage() {
  let briefings: Awaited<ReturnType<typeof getBriefings>> = [];
  let loadError: string | null = null;

  try {
    briefings = await getBriefings();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load briefings";
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Briefing history</h1>

      <TestFlightRelease />

      {loadError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{loadError}</p>
      )}

      {!loadError && briefings.length === 0 && (
        <p className="text-slate-600">No briefings stored yet.</p>
      )}

      {!loadError && briefings.length > 0 && (
        <ul className="space-y-3">
          {briefings.map((briefing) => (
            <li key={briefing.id} className="rounded-md border border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/briefing/${briefing.id}`}
                  className="font-medium text-blue-700 underline hover:text-blue-900"
                >
                  {briefing.departure} → {briefing.destination}
                </Link>
                <RiskBadge briefingText={briefing.briefing_text} />
              </div>
              <p className="mt-1 text-sm text-slate-600">
                {new Date(briefing.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
