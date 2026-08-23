"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUserAccount } from "@/lib/user-invite";
import { createNotification } from "@/lib/notifications";
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

const STATUS_MESSAGES: Record<"suspended" | "deactivated", string> = {
  suspended: "Your account has been suspended. Contact your administrator for details.",
  deactivated: "Your account has been deactivated. Contact your administrator for details.",
};

// Platform-wide authority — unlike setTeamMemberStatus (company_admin/team.ts,
// scoped to manager/staff/viewer within their own tenant), a super_admin can
// act on any user in any tenant, including a company_admin row.
export async function setUserStatus(userId: string, status: "active" | "suspended" | "deactivated") {
  const currentUser = await requireSuperAdmin();
  if (userId === currentUser.id) throw new Error("You can't change your own account status.");
  const admin = createAdminClient();

  const { data: target } = await admin.from("users").select("email, phone, tenant_id, status").eq("id", userId).single();
  if (!target) throw new Error("User not found");
  // A super_admin's own tenant_id is always null (DB-enforced) — this tool
  // is scoped to managing tenant-scoped users from a tenant's own detail
  // page, not one platform administrator acting on another's status.
  if (!target.tenant_id) throw new Error("Not authorized");

  const { error } = await admin.from("users").update({ status }).eq("id", userId);
  if (error) throw error;

  await writeAuditLog(admin, {
    tenant_id: target.tenant_id,
    user_id: currentUser.id,
    action: "set_user_status",
    resource_type: "user",
    resource_id: userId,
    old_value: { status: target.status },
    new_value: { status },
  });

  if (status === "suspended" || status === "deactivated") {
    await createNotification(admin, {
      tenantId: target.tenant_id,
      userId,
      type: "account_status_changed",
      message: STATUS_MESSAGES[status],
      email: target.email ? { to: target.email, subject: "Your Safina account status has changed" } : null,
      sms: target.phone ? { to: target.phone } : null,
    });
  }

  revalidatePath(`/admin/tenants/${target.tenant_id}`);
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

const STORAGE_LIST_PAGE_SIZE = 1000;

// Storage's list() is one level at a time (folders are just path prefixes,
// not a real hierarchy) — recurse to find every real object under a tenant's
// folder before deletion, rather than hardcoding the current set of
// subfolder names (company-profile/kpi-evidence/etc.), which would silently
// miss a future one. Each level is itself paginated — a tenant with more
// than STORAGE_LIST_PAGE_SIZE objects at a single level (plausible after
// years of KPI evidence uploads alone) would otherwise silently leave
// everything past the first page live in Storage after "deletion."
async function listAllStorageObjectPaths(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  let offset = 0;
  for (;;) {
    const { data: entries } = await admin.storage.from(bucket).list(prefix, { limit: STORAGE_LIST_PAGE_SIZE, offset });
    for (const entry of entries ?? []) {
      const fullPath = `${prefix}/${entry.name}`;
      if (entry.id === null) {
        paths.push(...(await listAllStorageObjectPaths(admin, bucket, fullPath)));
      } else {
        paths.push(fullPath);
      }
    }
    if (!entries || entries.length < STORAGE_LIST_PAGE_SIZE) break;
    offset += STORAGE_LIST_PAGE_SIZE;
  }
  return paths;
}

const USER_LIST_PAGE_SIZE = 1000;

// Same pagination concern as above, for the auth.users cleanup list — a
// tenant with more than USER_LIST_PAGE_SIZE users would otherwise silently
// leave every account past the first page live in Supabase Auth.
async function listAllTenantUserIds(admin: SupabaseClient, tenantId: string): Promise<string[]> {
  const ids: string[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .range(from, from + USER_LIST_PAGE_SIZE - 1);
    if (error) throw error;
    ids.push(...(data ?? []).map((u) => u.id));
    if (!data || data.length < USER_LIST_PAGE_SIZE) break;
    from += USER_LIST_PAGE_SIZE;
  }
  return ids;
}

// Hard delete, not soft — a real soft-delete-with-recovery-window would need
// every RLS policy across ~20 tenant-scoped tables to also filter on a
// deleted flag, a much larger change than this feature warrants. The
// deliberate friction in its place: the tenant must already be suspended
// (a separate, earlier action) and the caller must retype the exact company
// name, so deletion can never be the first or only click.
export async function deleteTenant(formData: FormData) {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  const tenantId = String(formData.get("tenant_id") ?? "");
  const confirmName = String(formData.get("confirm_name") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!tenantId) throw new Error("Missing tenant");
  if (!reason) throw new Error("A reason is required to delete a tenant.");

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, company_name, license_status")
    .eq("id", tenantId)
    .maybeSingle();
  if (!tenant) throw new Error("Tenant not found");
  if (tenant.license_status !== "suspended") {
    throw new Error("Suspend this tenant's license before deleting it.");
  }
  if (confirmName !== tenant.company_name) {
    throw new Error("Typed company name doesn't match — deletion cancelled.");
  }

  // Capture everything the Postgres cascade below won't touch, before it's
  // gone: auth.users has no FK from public.tenants at all (confirmed by
  // reading every migration), and Storage objects are keyed by a path
  // convention, not a database relationship.
  const userIds = await listAllTenantUserIds(admin, tenantId);
  const storagePaths = await listAllStorageObjectPaths(admin, "company-documents", tenantId);

  // The relational cascade runs first and atomically — either the tenant's
  // entire Postgres footprint goes in one transaction or none of it does.
  // Only once that's confirmed do we move on to the two cleanup steps that
  // can't be transactional (a partial failure there leaves a harmless,
  // inspectable orphan rather than a half-deleted tenant).
  const { error: deleteError } = await admin.from("tenants").delete().eq("id", tenantId);
  if (deleteError) throw deleteError;

  const authCleanupFailures: string[] = [];
  for (const userId of userIds) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      authCleanupFailures.push(userId);
      Sentry.captureException(error, { extra: { context: "deleteTenant auth cleanup", tenantId, userId } });
    }
  }

  let storageCleanupFailed = false;
  if (storagePaths.length > 0) {
    const { error } = await admin.storage.from("company-documents").remove(storagePaths);
    if (error) {
      storageCleanupFailed = true;
      Sentry.captureException(error, { extra: { context: "deleteTenant storage cleanup", tenantId } });
    }
  }

  // tenant_id is null here on purpose (migration 0030) — the tenant no
  // longer exists to reference, same as every other audit row this delete
  // just cascaded past.
  await writeAuditLog(admin, {
    tenant_id: null,
    user_id: currentUser.id,
    action: "delete_tenant",
    resource_type: "tenant",
    resource_id: tenantId,
    old_value: { company_name: tenant.company_name, license_status: tenant.license_status, user_count: userIds.length },
    new_value: { reason, auth_cleanup_failures: authCleanupFailures, storage_cleanup_failed: storageCleanupFailed },
  });

  revalidatePath("/admin");
}
