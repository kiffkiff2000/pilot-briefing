import Link from "next/link";
import { notFound } from "next/navigation";

import { BriefingContent } from "@/app/briefing/briefing-content";
import { getBriefingById } from "@/lib/db";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function BriefingDetailPage({ params }: PageProps) {
  const { id } = await params;

  let briefing: Awaited<ReturnType<typeof getBriefingById>> = null;
  let loadError: string | null = null;

  try {
    briefing = await getBriefingById(id);
  } catch (error) {
    loadError = error instanceof Error ? error.message : "Failed to load briefing";
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <Link href="/dashboard" className="text-blue-700 underline hover:text-blue-900">
          ← Briefing history
        </Link>
        <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{loadError}</p>
      </main>
    );
  }

  if (!briefing) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <Link href="/dashboard" className="text-blue-700 underline hover:text-blue-900">
        ← Briefing history
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">
        {briefing.departure} → {briefing.destination}
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        {new Date(briefing.created_at).toLocaleString()}
      </p>
      {briefing.alternates && (
        <p className="mt-2 text-sm text-slate-600">Alternates: {briefing.alternates}</p>
      )}

      <div className="mt-6">
        <BriefingContent briefingText={briefing.briefing_text} />
      </div>
    </main>
  );
}
