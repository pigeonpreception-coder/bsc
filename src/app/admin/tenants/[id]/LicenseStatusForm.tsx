"use client";

import { useState, useTransition } from "react";
import { setLicenseStatus } from "@/app/admin/actions";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "expired", label: "Expired" },
] as const;

const STATUS_BUTTON_CLASS: Record<string, string> = {
  active: "bg-green-600 hover:bg-green-700",
  suspended: "bg-red-600 hover:bg-red-700",
  expired: "bg-gray-500 hover:bg-gray-600",
};

export default function LicenseStatusForm({
  tenantId,
  currentStatus,
}: {
  tenantId: string;
  currentStatus: "active" | "suspended" | "expired";
}) {
  const [status, setStatus] = useState(currentStatus);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty = status !== currentStatus;

  const handleSave = () => {
    setError(null);
    startTransition(async () => {
      try {
        await setLicenseStatus(tenantId, status);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!isDirty || isPending}
          onClick={handleSave}
          className={`rounded-md px-4 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40 ${STATUS_BUTTON_CLASS[status]}`}
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
