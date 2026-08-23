"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUserAccount } from "@/lib/user-invite";
import { writeAuditLog } from "@/lib/audit-log";
import { LICENSE_TIER_DEFAULT_SEATS, canReduceSeatsTo, type LicenseTier } from "@/lib/licensing";

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") {
    throw new Error("Not authorized");
  }
  return user;
}

export async function createTenant(formData: FormData) {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const licenseTier = String(formData.get("license_tier") ?? "basic");
  const licenseStart = String(formData.get("license_start") ?? "");
  const licenseEnd = String(formData.get("license_end") ?? "");

  if (!companyName) throw new Error("Company name is required");
  if (licenseStart && licenseEnd && licenseEnd < licenseStart) {
    throw new Error("License end date can't be before the start date");
  }

  // Falls back to 'basic''s seat defaults for any tier value that isn't a
  // recognized key — the DB's own check constraint is the real backstop on
  // license_tier's validity, this just keeps the entitlement engine from
  // seeding undefined seat fields if that ever happens.
  const seats = LICENSE_TIER_DEFAULT_SEATS[licenseTier as LicenseTier] ?? LICENSE_TIER_DEFAULT_SEATS.basic;

  const { data: tenant, error } = await admin
    .from("tenants")
    .insert({
      company_name: companyName,
      license_tier: licenseTier,
      license_start: licenseStart || null,
      license_end: licenseEnd || null,
      created_by: currentUser.id,
      max_users: seats.maxUsers,
      is_unlimited_users: seats.isUnlimitedUsers,
    })
    .select()
    .single();

  if (error) throw error;

  await writeAuditLog(admin, {
    tenant_id: tenant.id,
    user_id: currentUser.id,
    action: "create_tenant",
    resource_type: "tenant",
    resource_id: tenant.id,
    old_value: null,
    new_value: { company_name: companyName, license_tier: licenseTier },
  });

  revalidatePath("/admin");
  return tenant.id as string;
}

export async function setLicenseStatus(tenantId: string, status: "active" | "suspended" | "expired") {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  const { data: previous } = await admin
    .from("tenants")
    .select("license_status")
    .eq("id", tenantId)
    .single();

  const { error } = await admin
    .from("tenants")
    .update({ license_status: status })
    .eq("id", tenantId);

  if (error) throw error;

  await writeAuditLog(admin, {
    tenant_id: tenantId,
    user_id: currentUser.id,
    action: "set_license_status",
    resource_type: "tenant",
    resource_id: tenantId,
    old_value: { license_status: previous?.license_status ?? null },
    new_value: { license_status: status },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/tenants/${tenantId}`);
}

export async function updateTenantSeats(tenantId: string, maxUsers: number, isUnlimitedUsers: boolean) {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  if (!isUnlimitedUsers) {
    if (!Number.isFinite(maxUsers) || maxUsers < 1) {
      throw new Error("Seat limit must be a positive number.");
    }
    // The downgrade guard — never silently reduce capacity below what's
    // already provisioned (spec: reject with an explanation, don't
    // deactivate anyone).
    const check = await canReduceSeatsTo(tenantId, maxUsers);
    if (!check.allowed) throw new Error(check.reason);
  }

  const { data: previous } = await admin
    .from("tenants")
    .select("max_users, is_unlimited_users")
    .eq("id", tenantId)
    .single();

  const { error } = await admin
    .from("tenants")
    .update({ max_users: isUnlimitedUsers ? null : maxUsers, is_unlimited_users: isUnlimitedUsers })
    .eq("id", tenantId);
  if (error) throw error;

  await writeAuditLog(admin, {
    tenant_id: tenantId,
    user_id: currentUser.id,
    action: "update_tenant_seats",
    resource_type: "tenant",
    resource_id: tenantId,
    old_value: previous ?? null,
    new_value: { max_users: isUnlimitedUsers ? null : maxUsers, is_unlimited_users: isUnlimitedUsers },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
}

export async function createCompanyAdmin(formData: FormData) {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  const tenantId = String(formData.get("tenant_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!tenantId || !email) {
    throw new Error("Tenant and email are required");
  }

  const origin = (await headers()).get("origin");

  const invited = await inviteUserAccount({
    email,
    fullName: fullName || null,
    role: "company_admin",
    tenantId,
    origin,
  });

  await writeAuditLog(admin, {
    tenant_id: tenantId,
    user_id: currentUser.id,
    action: "create_company_admin",
    resource_type: "user",
    resource_id: invited.id,
    old_value: null,
    new_value: { email, full_name: fullName || null, role: "company_admin" },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
}
