"use client";

import { useState } from "react";

type ApiSuccess = {
  ok?: boolean;
  briefing?: string;
  warnings?: string[];
  briefingId?: string | null;
  flight?: unknown;
  error?: string;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read file"));
        return;
      }
      const marker = "base64,";
      const idx = result.indexOf(marker);
      resolve(idx >= 0 ? result.slice(idx + marker.length) : result);
    };
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export function TestFlightRelease() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [meta, setMeta] = useState<ApiSuccess | null>(null);

  const runTest = async () => {
    setError(null);
    setBriefing(null);
    setMeta(null);

    if (!file) {
      setError("Select a PDF flight package first.");
      return;
    }

    setLoading(true);

    try {
      const pdfBase64 = await fileToBase64(file);

      const res = await fetch("/api/inbound-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "fly4stars@gmail.com",
          subject: "Flight Release TEST",
          file: pdfBase64,
        }),
      });

      const data = (await res.json()) as ApiSuccess;

      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `Error ${res.status}`);
        setMeta(data);
        return;
      }

      setMeta(data);
      setBriefing(typeof data.briefing === "string" ? data.briefing : null);
    } catch {
      setError("Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mb-6 rounded border border-slate-200 p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">Test with real flight package PDF</h2>
      <p className="mb-3 text-xs text-slate-600">
        Upload runs the same <code className="rounded bg-slate-100 px-1">/api/inbound-email</code>{" "}
        pipeline as production (PDF → text → briefing).
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept="application/pdf"
          className="text-sm"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setError(null);
            setBriefing(null);
            setMeta(null);
          }}
        />
        <span className="text-sm text-slate-600">
          {file ? `Selected: ${file.name}` : "No file selected"}
        </span>
      </div>

      <button
        type="button"
        onClick={runTest}
        disabled={loading || !file}
        className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {loading ? "Processing…" : "Run Test"}
      </button>

      {error && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{error}</p>
      )}

      {briefing && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold uppercase text-slate-700">Briefing</p>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            {briefing}
          </pre>
        </div>
      )}

      {meta && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-700">Full response (JSON)</summary>
          <pre className="mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
