"use client";

import { useState, useTransition } from "react";
import { resetUserMfaFactors } from "@/app/admin/mfa-actions";

export default function ResetMfaButton({ userId }: { userId: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (!confirm("Remove this user's two-factor authentication? They'll be able to sign in with just their password until they re-enroll.")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await resetUserMfaFactors(userId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-red-600">{error}</span>}
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
      >
        {isPending ? "Resetting…" : "Reset MFA"}
      </button>
    </span>
  );
}
