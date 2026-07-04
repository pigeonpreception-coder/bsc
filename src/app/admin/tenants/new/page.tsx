import { createTenant } from "@/app/admin/actions";

export default function NewTenantPage() {
  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-xl font-semibold text-navy">New Tenant</h1>

      <form action={createTenant} className="mt-6 space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div>
          <label htmlFor="company_name" className="block text-sm font-medium text-gray-700">
            Company name
          </label>
          <input
            id="company_name"
            name="company_name"
            type="text"
            required
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          />
        </div>

        <div>
          <label htmlFor="license_tier" className="block text-sm font-medium text-gray-700">
            License tier
          </label>
          <select
            id="license_tier"
            name="license_tier"
            defaultValue="basic"
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
          >
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
            <input
              id="license_start"
              name="license_start"
              type="date"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
          <div>
            <label htmlFor="license_end" className="block text-sm font-medium text-gray-700">
              License end
            </label>
            <input
              id="license_end"
              name="license_end"
              type="date"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
          </div>
        </div>

        <button
          type="submit"
          className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light"
        >
          Create Tenant
        </button>
      </form>
    </div>
  );
}
