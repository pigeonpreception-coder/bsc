import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function AdminHomePage() {
  const supabase = await createClient();

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, company_name, license_tier, license_status, created_at")
    .order("created_at", { ascending: false });

  const { data: userCounts } = await supabase.from("users").select("tenant_id");

  const countByTenant = new Map<string, number>();
  for (const row of userCounts ?? []) {
    if (!row.tenant_id) continue;
    countByTenant.set(row.tenant_id, (countByTenant.get(row.tenant_id) ?? 0) + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-navy">Tenants</h1>
        <Link
          href="/admin/tenants/new"
          className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
        >
          + New Tenant
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">License Tier</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Users</th>
              <th className="px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(tenants ?? []).map((tenant) => (
              <tr key={tenant.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/tenants/${tenant.id}`} className="font-medium text-navy hover:underline">
                    {tenant.company_name}
                  </Link>
                </td>
                <td className="px-4 py-3 capitalize">{tenant.license_tier}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      tenant.license_status === "active"
                        ? "bg-green-100 text-green-700"
                        : tenant.license_status === "suspended"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-red-100 text-red-700"
                    }`}
                  >
                    {tenant.license_status}
                  </span>
                </td>
                <td className="px-4 py-3">{countByTenant.get(tenant.id) ?? 0}</td>
                <td className="px-4 py-3 text-gray-500">
                  {new Date(tenant.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {(tenants ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                  No tenants yet. Create the first one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
