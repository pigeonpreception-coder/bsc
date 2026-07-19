import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setLicenseStatus } from "@/app/admin/actions";
import ActionButton from "@/components/ActionButton";
import CreateCompanyAdminForm from "./CreateCompanyAdminForm";

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
          <ActionButton
            action={toggleLicense}
            pendingLabel={toggleStatus === "suspended" ? "Suspending…" : "Reactivating…"}
            className={
              toggleStatus === "suspended"
                ? "text-white bg-red-600 hover:bg-red-700"
                : "text-white bg-green-600 hover:bg-green-700"
            }
          >
            {toggleStatus === "suspended" ? "Suspend license" : "Reactivate license"}
          </ActionButton>
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
          <CreateCompanyAdminForm tenantId={tenant.id} />
        </div>
      )}
    </div>
  );
}
