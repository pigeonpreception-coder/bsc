"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { revokeOtherSessions } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function ResetPasswordForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setHasSession(!!data.user);
      setCheckingSession(false);
    });
  }, []);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirm_password") ?? "");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    startTransition(async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;

        // Best-effort — awaited so it actually runs before navigation, but
        // errors are swallowed inside the action itself: if this fails, the
        // password change already succeeded and shouldn't be blocked.
        const { data: sessionData } = await supabase.auth.getSession();
        if (sessionData.session?.access_token) {
          await revokeOtherSessions(sessionData.session.access_token);
        }

        router.push("/");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  if (checkingSession) {
    return <p className="text-sm text-gray-500">Checking the reset link…</p>;
  }

  if (!hasSession) {
    return (
      <p className="text-sm text-red-600">
        This reset link is invalid or has expired. Please request a new one.
      </p>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          New password
        </label>
        <input id="password" name="password" type="password" required minLength={8} className={inputClass} />
      </div>
      <div>
        <label htmlFor="confirm_password" className="block text-sm font-medium text-gray-700">
          Confirm new password
        </label>
        <input
          id="confirm_password"
          name="confirm_password"
          type="password"
          required
          minLength={8}
          className={inputClass}
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Updating…" : "Update password"}
      </button>
    </form>
  );
}
