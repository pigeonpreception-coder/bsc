import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createCompanyAdmin, setLicenseStatus } from "@/app/admin/actions";

export default async function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: tenant } = await supabase.from("tenants").select("*").eq("id", id).single();
  if (!tenant) notFound();

  const { data: users } = await supabase
    .from("users")
    .select("id, email, full_name, role, created_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: true });

  const hasCompanyAdmin = (users ?? []).some((u) => u.role === "company_admin");
  const toggleStatus = tenant.license_status === "suspended" ? "active" : "suspended";

  async function toggleLicense() {
    "use server";
    await setLicenseStatus(id, toggleStatus as "active" | "suspended");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-semibold text-navy">{tenant.company_name}</h1>
            <p className="mt-1 text-sm capitalize text-gray-500">
              {tenant.license_tier} plan &middot; {tenant.license_status}
            </p>
          </div>
          <form action={toggleLicense}>
            <button
              type="submit"
              className={`rounded-md px-4 py-2 text-sm font-semibold text-white ${
                toggleStatus === "suspended"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {toggleStatus === "suspended" ? "Suspend license" : "Reactivate license"}
            </button>
          </form>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Users</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {(users ?? []).map((u) => (
            <li key={u.id} className="flex items-center justify-between py-2 text-sm">
              <span>{u.full_name || u.email}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                {u.role.replace("_", " ")}
              </span>
            </li>
          ))}
          {(users ?? []).length === 0 && (
            <li className="py-2 text-sm text-gray-400">No users yet.</li>
          )}
        </ul>
      </div>

      {!hasCompanyAdmin && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-navy">Create first Company Admin</h2>
          <form action={createCompanyAdmin} className="mt-4 space-y-4">
            <input type="hidden" name="tenant_id" value={tenant.id} />
            <div>
              <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
                Full name
              </label>
              <input
                id="full_name"
                name="full_name"
                type="text"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                Temporary password
              </label>
              <input
                id="password"
                name="password"
                type="text"
                required
                minLength={8}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light"
            >
              Create Company Admin
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
