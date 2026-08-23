"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTenant } from "@/app/admin/actions";

export default function DeleteTenantForm({
  tenantId,
  companyName,
  licenseStatus,
}: {
  tenantId: string;
  companyName: string;
  licenseStatus: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [reason, setReason] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isSuspended = licenseStatus === "suspended";
  const canSubmit = isSuspended && confirmName === companyName && reason.trim().length > 0;

  const handleDelete = () => {
    if (!confirm(`This permanently deletes "${companyName}" and everything in it — users, scorecards, documents, audit trail linkage. This can't be undone. Continue?`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("tenant_id", tenantId);
        formData.set("confirm_name", confirmName);
        formData.set("reason", reason);
        await deleteTenant(formData);
        router.push("/admin");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="rounded-lg border-2 border-red-200 bg-red-50 p-6">
      <h2 className="text-sm font-semibold text-red-700">Danger zone — delete tenant</h2>
      <p className="mt-1 text-xs text-red-600">
        Permanently deletes this tenant and every scorecard, user, document, and notification it owns. This cannot be undone.
      </p>

      {!isSuspended ? (
        <p className="mt-3 text-sm text-red-700">Suspend this tenant&apos;s license above before you can delete it.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div>
            <label className="block text-xs font-medium text-red-700">
              Type <span className="font-mono">{companyName}</span> to confirm
            </label>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              className="mt-1 w-full rounded border border-red-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-red-700">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded border border-red-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            disabled={!canSubmit || isPending}
            onClick={handleDelete}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isPending ? "Deleting…" : "Permanently delete this tenant"}
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
