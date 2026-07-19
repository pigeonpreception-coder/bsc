"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTenant } from "@/app/admin/actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function NewTenantForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        const tenantId = await createTenant(formData);
        router.push(`/admin/tenants/${tenantId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form action={handleSubmit} className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div>
        <label htmlFor="company_name" className="block text-sm font-medium text-gray-700">
          Company name
        </label>
        <input id="company_name" name="company_name" type="text" required className={inputClass} />
      </div>

      <div>
        <label htmlFor="license_tier" className="block text-sm font-medium text-gray-700">
          License tier
        </label>
        <select id="license_tier" name="license_tier" defaultValue="basic" className={inputClass}>
          <option value="basic">Basic</option>
          <option value="professional">Professional</option>
          <option value="enterprise">Enterprise</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="license_start" className="block text-sm font-medium text-gray-700">
            License start
          </label>
          <input id="license_start" name="license_start" type="date" className={inputClass} />
        </div>
        <div>
          <label htmlFor="license_end" className="block text-sm font-medium text-gray-700">
            License end
          </label>
          <input id="license_end" name="license_end" type="date" className={inputClass} />
        </div>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create Tenant"}
      </button>
    </form>
  );
}
