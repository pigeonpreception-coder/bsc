"use client";

import { useRef, useState, useTransition } from "react";
import { addTeamMember } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function AddTeamMemberForm({ departments }: { departments: string[] }) {
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
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Temporary password
        </label>
        <input id="password" name="password" type="text" required minLength={8} className={inputClass} />
      </div>
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
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Adding…" : "Add Team Member"}
      </button>
    </form>
  );
}
