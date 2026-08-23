"use client";

import { useState, useTransition } from "react";
import { updateTenantSeats } from "@/app/admin/actions";

export default function SeatLimitForm({
  tenantId,
  currentMaxUsers,
  currentIsUnlimited,
}: {
  tenantId: string;
  currentMaxUsers: number | null;
  currentIsUnlimited: boolean;
}) {
  const [isUnlimited, setIsUnlimited] = useState(currentIsUnlimited);
  const [maxUsers, setMaxUsers] = useState(String(currentMaxUsers ?? 10));
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty = isUnlimited !== currentIsUnlimited || (!isUnlimited && Number(maxUsers) !== currentMaxUsers);

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await updateTenantSeats(tenantId, Number(maxUsers), isUnlimited);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={isUnlimited}
            onChange={(e) => setIsUnlimited(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-gold"
          />
          Unlimited
        </label>
        {!isUnlimited && (
          <input
            type="number"
            min={1}
            value={maxUsers}
            onChange={(e) => setMaxUsers(e.target.value)}
            className="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        )}
        <button
          type="button"
          disabled={!isDirty || isPending}
          onClick={handleSave}
          className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 hover:bg-navy-light"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="max-w-xs text-right text-sm text-red-600">{error}</p>}
    </div>
  );
}
