"use client";

import { useState, useTransition } from "react";
import { agreeAndSubmitScorecard, submitManagerFirstApproval, submitDivisionHeadFinalApproval, unlockScorecard } from "./workflow-actions";

const STATUS_LABELS: Record<string, string> = {
  owner_editing: "Open for editing",
  pending_manager_review: "Awaiting first-level review — immediate manager",
  pending_final_review: "Awaiting final approval — division head",
  locked: "Locked — finally approved",
};

const STATUS_COLORS: Record<string, string> = {
  owner_editing: "bg-gray-100 text-gray-700",
  pending_manager_review: "bg-amber-100 text-amber-700",
  pending_final_review: "bg-blue-100 text-blue-700",
  locked: "bg-green-100 text-green-700",
};

export default function WorkflowPanel({
  scorecardId,
  workflowStatus,
  version,
  isOwner,
  isFirstApprover,
  isFinalApprover,
  isCompanyAdmin,
  rejection,
}: {
  scorecardId: string;
  workflowStatus: string;
  version: string;
  // Independent, not mutually exclusive — a company_admin can also
  // independently occupy the resolved manager/division-head position (see
  // src/lib/approval-hierarchy.ts), and unlock authority applies regardless
  // of whether they also hold one of those positions.
  isOwner: boolean;
  isFirstApprover: boolean;
  isFinalApprover: boolean;
  isCompanyAdmin: boolean;
  rejection: { level: string; reason: string } | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rejectingLevel, setRejectingLevel] = useState<"first" | "final" | null>(null);
  const [reason, setReason] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const rejecting = rejectingLevel !== null;

  const run = (action: () => Promise<void>) => {
    setError(null);
    startTransition(async () => {
      try {
        await action();
        setRejectingLevel(null);
        setUnlocking(false);
        setReason("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_COLORS[workflowStatus] ?? "bg-gray-100 text-gray-600"}`}>
            {STATUS_LABELS[workflowStatus] ?? workflowStatus}
          </span>
          <span className="ml-2 text-xs text-gray-400">Version {version}</span>
        </div>

        {!rejecting && !unlocking && (
          <div className="flex gap-2">
            {isOwner && workflowStatus === "owner_editing" && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => run(() => agreeAndSubmitScorecard(scorecardId))}
                className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
              >
                {isPending ? "Submitting…" : "Agree & Submit"}
              </button>
            )}

            {isFirstApprover && workflowStatus === "pending_manager_review" && (
              <>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => submitManagerFirstApproval(scorecardId, "approved"))}
                  className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
                >
                  First Approve
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setRejectingLevel("first")}
                  className="rounded-md border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Return for correction
                </button>
              </>
            )}

            {isFinalApprover && workflowStatus === "pending_final_review" && (
              <>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => run(() => submitDivisionHeadFinalApproval(scorecardId, "approved"))}
                  className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
                >
                  Final Approve
                </button>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => setRejectingLevel("final")}
                  className="rounded-md border border-red-600 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Return for correction
                </button>
              </>
            )}

            {isCompanyAdmin && workflowStatus === "locked" && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => setUnlocking(true)}
                className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
              >
                Unlock BSC
              </button>
            )}
          </div>
        )}
      </div>

      {rejecting && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for returning this BSC for correction…"
            rows={2}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending || !reason.trim()}
              onClick={() =>
                run(() =>
                  rejectingLevel === "first"
                    ? submitManagerFirstApproval(scorecardId, "rejected", reason)
                    : submitDivisionHeadFinalApproval(scorecardId, "rejected", reason),
                )
              }
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirm — return for correction
            </button>
            <button type="button" onClick={() => setRejectingLevel(null)} className="text-sm text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {unlocking && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for unlocking this BSC…"
            rows={2}
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isPending || !reason.trim()}
              onClick={() => run(() => unlockScorecard(scorecardId, reason))}
              className="rounded bg-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
            >
              Confirm unlock
            </button>
            <button type="button" onClick={() => setUnlocking(false)} className="text-sm text-gray-400 hover:text-gray-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rejection && (
        <p className="mt-2 text-xs text-red-600">
          Returned for correction at the {rejection.level}-level review: {rejection.reason}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
