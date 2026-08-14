"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyLoginMfaChallenge } from "./actions";

export default function MfaChallengeForm({ factorId, next }: { factorId: string; next: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    const code = String(formData.get("code") ?? "").trim();

    startTransition(async () => {
      try {
        await verifyLoginMfaChallenge(factorId, code);
        router.push(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form action={handleSubmit} className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label htmlFor="code" className="block text-sm font-medium text-gray-700">
          6-digit code
        </label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={6}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white transition hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Verifying…" : "Verify"}
      </button>
    </form>
  );
}
