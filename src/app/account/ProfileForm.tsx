"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateProfile, updateNotificationPreference } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function ProfileForm({
  fullName,
  phone,
  email,
  emailNotificationsEnabled,
}: {
  fullName: string;
  phone: string;
  email: string;
  emailNotificationsEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleProfileSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await updateProfile(formData);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="mt-4 space-y-6">
      <form action={handleProfileSubmit} className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div>
          <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
            Display name
          </label>
          <input id="full_name" name="full_name" type="text" required defaultValue={fullName} className={inputClass} />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-gray-700">
            Phone
          </label>
          <input id="phone" name="phone" type="tel" defaultValue={phone} className={inputClass} />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save profile"}
        </button>
      </form>

      <EmailChangeForm currentEmail={email} />
      <NotificationPreferenceToggle initialEnabled={emailNotificationsEnabled} />
    </div>
  );
}

function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    const newEmail = String(formData.get("email") ?? "").trim();

    startTransition(async () => {
      try {
        const supabase = createClient();
        const { error } = await supabase.auth.updateUser({ email: newEmail });
        if (error) throw error;
        setSubmitted(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="border-t border-gray-100 pt-4">
      <p className="text-sm text-gray-700">
        Email: <span className="font-medium">{currentEmail}</span>
      </p>

      {submitted ? (
        <p className="mt-2 text-sm text-gray-600">
          Check your inbox — you&apos;ll need to confirm the change from the link we sent before it takes effect.
        </p>
      ) : showForm ? (
        <form action={handleSubmit} className="mt-2 space-y-2">
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <input id="email" name="email" type="email" required placeholder="New email address" className={inputClass} />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
            >
              {isPending ? "Sending…" : "Send confirmation"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:underline"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-1 text-sm font-medium text-navy hover:underline"
        >
          Change email
        </button>
      )}
    </div>
  );
}

function NotificationPreferenceToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleChange = (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      try {
        await updateNotificationPreference(next);
      } catch (err) {
        setEnabled(previous);
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div className="border-t border-gray-100 pt-4">
      {error && <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={enabled}
          disabled={isPending}
          onChange={(e) => handleChange(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-gold"
        />
        Email me about notifications (position changes, approvals, weekly advisories)
      </label>
    </div>
  );
}
