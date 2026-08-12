"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

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

  const { data: tenant, error } = await admin
    .from("tenants")
    .insert({
      company_name: companyName,
      license_tier: licenseTier,
      license_start: licenseStart || null,
      license_end: licenseEnd || null,
      created_by: currentUser.id,
    })
    .select()
    .single();

  if (error) throw error;

  await admin.from("audit_log").insert({
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

  await admin.from("audit_log").insert({
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

export async function createCompanyAdmin(formData: FormData) {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  const tenantId = String(formData.get("tenant_id") ?? "");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();

  if (!tenantId || !email || !password) {
    throw new Error("Tenant, email, and password are required");
  }

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError) throw authError;

  const { error: profileError } = await admin.from("users").insert({
    id: authUser.user.id,
    email,
    full_name: fullName || null,
    role: "company_admin",
    tenant_id: tenantId,
  });
  if (profileError) {
    // Don't leave an orphaned login behind — that email becomes permanently
    // unusable for future signups otherwise, with no UI to find or fix it.
    await admin.auth.admin.deleteUser(authUser.user.id);
    throw profileError;
  }

  await admin.from("audit_log").insert({
    tenant_id: tenantId,
    user_id: currentUser.id,
    action: "create_company_admin",
    resource_type: "user",
    resource_id: authUser.user.id,
    old_value: null,
    new_value: { email, full_name: fullName || null, role: "company_admin" },
  });

  revalidatePath(`/admin/tenants/${tenantId}`);
}
