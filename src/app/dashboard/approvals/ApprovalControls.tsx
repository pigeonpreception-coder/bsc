"use client";

import { useState, useTransition } from "react";
import { approveScorecardRow } from "@/app/dashboard/scorecards/[id]/row-actions";

export default function ApprovalControls({ rowId }: { rowId: string }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (decision: "approved" | "rejected") => {
    setError(null);
    startTransition(async () => {
      try {
        await approveScorecardRow(rowId, decision, decision === "rejected" ? reason : undefined);
        setRejecting(false);
        setReason("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5">
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejecting this value…"
          rows={2}
          className="w-56 rounded border border-gray-300 px-2 py-1 text-xs focus:border-gold focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending || !reason.trim()}
            onClick={() => decide("rejected")}
            className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Rejecting…" : "Confirm reject"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setRejecting(false);
              setReason("");
              setError(null);
            }}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => decide("approved")}
          className="rounded bg-navy px-3 py-1 text-xs font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Approving…" : "Approve"}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setRejecting(true)}
          className="rounded border border-red-600 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
