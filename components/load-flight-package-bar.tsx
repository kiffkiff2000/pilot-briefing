"use client";

import { useState } from "react";

type Props = {
  loading: boolean;
  error: string | null;
  onGenerate: (file: File) => void | Promise<void>;
};

/**
 * Keeps the selected PDF in local state so the parent briefing page (map, wx,
 * alerts) does not re-render on every file input change — improves INP.
 */
export function LoadFlightPackageBar({ loading, error, onGenerate }: Props) {
  const [file, setFile] = useState<File | null>(null);

  return (
    <>
      <div className="topbarLoadHead">Load Flight Package</div>
      <div className="topbarLoadRow">
        <input
          type="file"
          accept="application/pdf"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
          }}
        />
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (file) void onGenerate(file);
          }}
          disabled={loading || !file}
        >
          {loading ? "Processing..." : "Generate Briefing"}
        </button>
      </div>
      {error ? <div className="topbarLoadErr">{error}</div> : null}
    </>
  );
}
