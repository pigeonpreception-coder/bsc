import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 25;

export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  // This grows with every tenant ever created platform-wide, unlike
  // everything else in the app (which is naturally bounded by one
  // organization's own size) — the one query that actually needed
  // pagination rather than a date filter or a small .limit().
  const { data: tenants, count } = await supabase
    .from("tenants")
    .select("id, company_name, license_tier, license_status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  // One exact count per tenant rather than fetching every user row — avoids
  // silently undercounting if the users table ever exceeds the default
  // PostgREST row cap.
  const countByTenant = new Map<string, number>(
    await Promise.all(
      (tenants ?? []).map(async (tenant) => {
        const { count } = await supabase
          .from("users")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.id);
        return [tenant.id, count ?? 0] as const;
      }),
    ),
  );

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

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>
            Page {page} of {totalPages} &middot; {count} tenant{count === 1 ? "" : "s"} total
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/admin?page=${page - 1}`}
                className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
              >
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/admin?page=${page + 1}`}
                className="rounded-md border border-gray-300 px-3 py-1.5 hover:bg-gray-50"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
