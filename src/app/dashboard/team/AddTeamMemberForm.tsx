"use client";

import { useRef, useState, useTransition } from "react";
import { addTeamMember } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export type UnfilledPosition = { id: string; label: string };

export default function AddTeamMemberForm({
  departments,
  positions,
}: {
  departments: string[];
  positions: UnfilledPosition[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await addTeamMember(formData);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form ref={formRef} action={handleSubmit} className="mt-4 space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
          Full name
        </label>
        <input id="full_name" name="full_name" type="text" className={inputClass} />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email
        </label>
        <input id="email" name="email" type="email" required className={inputClass} />
      </div>
      <p className="text-xs text-gray-400">
        They&apos;ll get an email invite to set their own password — no need to create one for them.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700">
            Role
          </label>
          <select id="role" name="role" defaultValue="staff" className={inputClass}>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
        <div>
          <label htmlFor="department" className="block text-sm font-medium text-gray-700">
            Department
          </label>
          {departments.length > 0 ? (
            <select id="department" name="department" required className={inputClass}>
              <option value="">Select…</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          ) : (
            <input id="department" name="department" type="text" required className={inputClass} />
          )}
        </div>
      </div>
      <div>
        <label htmlFor="position_id" className="block text-sm font-medium text-gray-700">
          Organisational position <span className="font-normal text-gray-400">(optional)</span>
        </label>
        <select id="position_id" name="position_id" defaultValue="" className={inputClass}>
          <option value="">Not linked yet</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Linking a position powers this person&apos;s dashboard, daily tasks, and alerts. You can also set this
          later.
        </p>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Sending invite…" : "Send Invite"}
      </button>
    </form>
  );
}
