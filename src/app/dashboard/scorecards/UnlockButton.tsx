"use client";

import { useState, useTransition } from "react";
import { unlockScorecard } from "./[id]/workflow-actions";

export default function UnlockButton({ scorecardId }: { scorecardId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-navy underline hover:text-navy-light">
        Unlock
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason for unlocking this BSC…"
        rows={2}
        className="w-56 rounded border border-gray-300 px-2 py-1 text-xs focus:border-gold focus:outline-none"
      />
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending || !reason.trim()}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              try {
                await unlockScorecard(scorecardId, reason);
                setOpen(false);
                setReason("");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
              }
            })
          }
          className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Unlocking…" : "Confirm unlock"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">
          Cancel
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
