import type { ReactNode } from "react";

import { isStructuredBriefing, parseBriefingSections } from "@/lib/briefing-utils";

type Props = {
  briefingText: string;
};

function SectionBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 border-b border-slate-200 pb-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
        {title}
      </h2>
      <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-800 shadow-sm">
        {children}
      </div>
    </section>
  );
}

export function BriefingContent({ briefingText }: Props) {
  if (!isStructuredBriefing(briefingText)) {
    return (
      <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-sm">
        {briefingText}
      </pre>
    );
  }

  const sections = parseBriefingSections(briefingText);

  return (
    <div className="space-y-2">
      <SectionBlock title="FLIGHT OVERVIEW">
        <pre className="font-mono text-sm whitespace-pre-wrap">{sections.overview}</pre>
      </SectionBlock>

      <SectionBlock title="WEATHER">
        {sections.weather ? (
          <pre className="font-mono text-sm whitespace-pre-wrap">{sections.weather}</pre>
        ) : (
          <p className="text-slate-500">No weather section extracted.</p>
        )}
      </SectionBlock>

      <SectionBlock title="NOTAM">
        {sections.notam ? (
          <pre className="font-mono text-sm whitespace-pre-wrap">{sections.notam}</pre>
        ) : (
          <p className="text-slate-500">No NOTAM section extracted.</p>
        )}
      </SectionBlock>

      <SectionBlock title="OPERATIONAL SUMMARY">
        {sections.operationalSummary ? (
          <pre className="font-mono text-sm whitespace-pre-wrap">{sections.operationalSummary}</pre>
        ) : (
          <p className="text-slate-500">No summary extracted.</p>
        )}
      </SectionBlock>
    </div>
  );
}
