"use client";

import { useState, useTransition } from "react";
import { requestAmendment } from "./row-actions";

export default function RequestAmendmentControl({ rowId }: { rowId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (sent) {
    return <p className="mt-1 text-[10px] text-gray-400">Amendment requested — awaiting authorization.</p>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1 text-[10px] text-navy underline hover:text-navy-light">
        Request amendment
      </button>
    );
  }

  return (
    <div className="mt-1 flex max-w-[160px] flex-col gap-1">
      <textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Why does this need reopening?"
        rows={2}
        className="w-full rounded border border-gray-300 px-1.5 py-1 text-[10px] focus:border-gold focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending || !reason.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                await requestAmendment(rowId, reason);
                setSent(true);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
              }
            })
          }
          className="rounded bg-navy px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[10px] text-gray-400 hover:text-gray-600">
          Cancel
        </button>
      </div>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  );
}
