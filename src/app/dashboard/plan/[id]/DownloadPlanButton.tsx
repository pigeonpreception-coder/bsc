"use client";

import { useState, useTransition } from "react";

export default function DownloadPlanButton({
  action,
}: {
  action: () => Promise<{ docxUrl?: string; pdfUrl?: string }>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ docxUrl?: string; pdfUrl?: string } | null>(null);

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        const generated = await action();
        setResult(generated);
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
        onClick={handleClick}
        className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-light disabled:opacity-50"
      >
        {isPending ? "Generating documents… this can take a moment" : "Download Strategic Plan"}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-3 flex gap-4 text-sm">
          {result.pdfUrl && (
            <a href={result.pdfUrl} download className="font-medium text-navy underline hover:text-navy-light">
              Download PDF
            </a>
          )}
          {result.docxUrl && (
            <a href={result.docxUrl} download className="font-medium text-navy underline hover:text-navy-light">
              Download Word (.docx)
            </a>
          )}
        </div>
      )}
    </div>
  );
}
