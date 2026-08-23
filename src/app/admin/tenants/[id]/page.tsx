import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/licensing";
import UserStatusControl from "@/components/UserStatusControl";
import LicenseStatusForm from "./LicenseStatusForm";
import SeatLimitForm from "./SeatLimitForm";
import CreateCompanyAdminForm from "./CreateCompanyAdminForm";
import ResetMfaButton from "./ResetMfaButton";
import DeleteTenantForm from "./DeleteTenantForm";
import { setUserStatus } from "@/app/admin/actions";

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
    .select("id, email, full_name, role, status, created_at")
    .eq("tenant_id", id)
    .order("created_at", { ascending: true });

  const hasCompanyAdmin = (users ?? []).some((u) => u.role === "company_admin");
  const entitlement = await getEntitlement(id);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-navy">{tenant.company_name}</h1>
            <p className="mt-1 text-sm capitalize text-gray-500">
              {tenant.license_tier} plan &middot; {tenant.license_status}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              License {tenant.license_start ? new Date(tenant.license_start).toLocaleDateString() : "—"}
              {" to "}
              {tenant.license_end ? new Date(tenant.license_end).toLocaleDateString() : "—"}
            </p>
          </div>
          <LicenseStatusForm tenantId={id} currentStatus={tenant.license_status} />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-navy">Seat entitlement</h2>
            <p className="mt-1 text-sm text-gray-500">
              {entitlement.isUnlimitedUsers
                ? `Unlimited users — ${entitlement.currentUserCount} created`
                : `${entitlement.currentUserCount} of ${entitlement.maxUsers} users`}
            </p>
          </div>
          <SeatLimitForm
            tenantId={id}
            currentMaxUsers={entitlement.maxUsers}
            currentIsUnlimited={entitlement.isUnlimitedUsers}
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Users</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {(users ?? []).map((u) => (
            <li key={u.id} className="flex items-center justify-between py-2 text-sm">
              <span>{u.full_name || u.email}</span>
              <span className="flex items-center gap-3">
                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs capitalize text-gray-600">
                  {u.role.replace("_", " ")}
                </span>
                <UserStatusControl userId={u.id} currentStatus={u.status} updateStatus={setUserStatus} />
                <ResetMfaButton userId={u.id} />
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

      <DeleteTenantForm tenantId={tenant.id} companyName={tenant.company_name} licenseStatus={tenant.license_status} />
    </div>
  );
}
