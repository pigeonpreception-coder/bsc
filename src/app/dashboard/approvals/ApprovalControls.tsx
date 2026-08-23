"use client";

import { useState, useTransition } from "react";
import { submitFirstApproval, submitFinalApproval, reopenScore } from "@/app/dashboard/scorecards/[id]/row-actions";

type Kind = "first" | "final" | "reopen";

const ACTION_BY_KIND = {
  first: submitFirstApproval,
  final: submitFinalApproval,
} as const;

export default function ApprovalControls({ rowId, kind }: { rowId: string; kind: Kind }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const decide = (approve: boolean) => {
    setError(null);
    startTransition(async () => {
      try {
        if (kind === "reopen") {
          await reopenScore(rowId, approve, approve ? undefined : reason);
        } else {
          await ACTION_BY_KIND[kind](rowId, approve ? "approved" : "rejected", approve ? undefined : reason);
        }
        setRejecting(false);
        setReason("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  const rejectLabel = kind === "reopen" ? "Deny" : "Return for correction";
  const approveLabel = kind === "reopen" ? "Reopen" : "Approve";

  if (rejecting) {
    return (
      <div className="flex flex-col gap-1.5">
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={kind === "reopen" ? "Reason for denying this amendment…" : "Reason for returning this for correction…"}
          rows={2}
          className="w-56 rounded border border-gray-300 px-2 py-1 text-xs focus:border-gold focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={isPending || !reason.trim()}
            onClick={() => decide(false)}
            className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isPending ? "Sending…" : `Confirm — ${rejectLabel.toLowerCase()}`}
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
          onClick={() => decide(true)}
          className="rounded bg-navy px-3 py-1 text-xs font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Saving…" : approveLabel}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setRejecting(true)}
          className="rounded border border-red-600 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {rejectLabel}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
