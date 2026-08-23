"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function SignUpForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await signUp(formData);
        if (result.needsEmailConfirmation) {
          setNeedsEmailConfirmation(true);
        } else {
          // A session was created immediately (email confirmation disabled
          // at the project level) — the cookie is already set server-side;
          // let the root redirect gate (src/app/page.tsx) route into
          // /dashboard rather than duplicating that logic here.
          router.push("/");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  if (needsEmailConfirmation) {
    return (
      <p className="text-sm text-gray-600">
        Almost there — we&apos;ve sent a confirmation link to your email. Click it to activate your account and sign
        in.
      </p>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label htmlFor="company_name" className="block text-sm font-medium text-gray-700">
          Company name
        </label>
        <input id="company_name" name="company_name" type="text" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
          Your name
        </label>
        <input id="full_name" name="full_name" type="text" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input id="email" name="email" type="email" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input id="password" name="password" type="password" required minLength={8} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white transition hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Creating your account…" : "Create account"}
      </button>
    </form>
  );
}
