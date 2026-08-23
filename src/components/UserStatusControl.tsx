"use client";

import { useState, useTransition } from "react";

export type UserStatus = "active" | "suspended" | "deactivated";

const STATUS_OPTIONS: { value: UserStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "deactivated", label: "Deactivated" },
];

const STATUS_BADGE_CLASS: Record<UserStatus, string> = {
  active: "bg-green-100 text-green-700",
  suspended: "bg-amber-100 text-amber-700",
  deactivated: "bg-gray-200 text-gray-600",
};

/**
 * Shared by /dashboard/team (company_admin, scoped to manager/staff/viewer)
 * and /admin/tenants/[id] (super_admin, any user) — same UI shape, each
 * page binds its own authorization-scoped Server Action and passes it in,
 * matching the established ActionButton pattern of taking a bound action
 * as a prop rather than duplicating this component per caller.
 */
export default function UserStatusControl({
  userId,
  currentStatus,
  updateStatus,
}: {
  userId: string;
  currentStatus: UserStatus;
  updateStatus: (userId: string, status: UserStatus) => Promise<void>;
}) {
  const [status, setStatus] = useState<UserStatus>(currentStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty = status !== currentStatus;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateStatus(userId, status);
      } catch (err) {
        setStatus(currentStatus);
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <span className="flex items-center gap-1.5">
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE_CLASS[currentStatus]}`}>
        {currentStatus}
      </span>
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as UserStatus)}
        className="rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      >
        {STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {isDirty && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleSave}
          className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
