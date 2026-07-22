"use client";

import { useState, useTransition } from "react";
import { assignPosition } from "./actions";
import type { UnfilledPosition } from "./AddTeamMemberForm";

export default function AssignPositionForm({
  userId,
  currentPositionId,
  options,
}: {
  userId: string;
  currentPositionId: string | null;
  options: UnfilledPosition[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(currentPositionId ?? "");
  const [syncedPositionId, setSyncedPositionId] = useState(currentPositionId);

  if (currentPositionId !== syncedPositionId) {
    setSyncedPositionId(currentPositionId);
    setValue(currentPositionId ?? "");
  }

  const handleSubmit = (formData: FormData) => {
    const confirmed = value
      ? confirm("Link this person to the selected position? This takes effect immediately.")
      : confirm("Unlink this person from their position? Their dashboard, tasks, and alerts depend on it.");
    if (!confirmed) return;

    setError(null);
    startTransition(async () => {
      try {
        await assignPosition(formData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form action={handleSubmit} className="flex items-center gap-2">
      <input type="hidden" name="user_id" value={userId} />
      <select
        name="position_id"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
      >
        <option value="">Not linked</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md border border-navy px-2 py-1 text-xs font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
