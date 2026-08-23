"use client";

import { useState, useTransition } from "react";
import { exportTenantData } from "./data-export-actions";

export default function ExportDataButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleExport = () => {
    setError(null);
    startTransition(async () => {
      try {
        const { url } = await exportTenantData();
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        disabled={isPending}
        onClick={handleExport}
        className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        {isPending ? "Preparing export…" : "Export all data (JSON)"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
