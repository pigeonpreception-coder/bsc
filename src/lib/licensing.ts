import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type LicenseTier = "basic" | "professional" | "enterprise";

/**
 * Default seat allocation per tier, used only when a tenant is first
 * created — a `super_admin` can override any tenant's actual entitlement
 * afterward. This is a Phase 1 stand-in for what becomes a real,
 * data-driven pricing catalog once payment/checkout (Phase 2) exists —
 * deliberately not hardcoded into individual UI screens, but also
 * deliberately not a speculative catalog table before real pricing exists.
 */
export const LICENSE_TIER_DEFAULT_SEATS: Record<LicenseTier, { maxUsers: number | null; isUnlimitedUsers: boolean }> = {
  basic: { maxUsers: 10, isUnlimitedUsers: false },
  professional: { maxUsers: 50, isUnlimitedUsers: false },
  enterprise: { maxUsers: null, isUnlimitedUsers: true },
};

export type Entitlement = {
  tenantId: string;
  licenseStatus: string;
  maxUsers: number | null;
  isUnlimitedUsers: boolean;
  currentUserCount: number;
  /** null when isUnlimitedUsers is true — there is no numeric remaining count. */
  remainingSeats: number | null;
};

/**
 * The single authoritative read every UI (the super_admin seat-limit form,
 * the company_admin utilization card) queries — spec's own requirement
 * that all provisioning decisions go through one centralized entitlement
 * service, not a query re-derived ad hoc in each screen.
 */
export async function getEntitlement(tenantId: string): Promise<Entitlement> {
  const admin = createAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("license_status, max_users, is_unlimited_users")
    .eq("id", tenantId)
    .single();
  if (tenantError) throw tenantError;

  const { count, error: countError } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  if (countError) throw countError;

  const currentUserCount = count ?? 0;
  const maxUsers = tenant.max_users;
  const isUnlimitedUsers = tenant.is_unlimited_users;

  return {
    tenantId,
    licenseStatus: tenant.license_status,
    maxUsers,
    isUnlimitedUsers,
    currentUserCount,
    remainingSeats: isUnlimitedUsers ? null : Math.max(0, (maxUsers ?? 0) - currentUserCount),
  };
}

/**
 * The downgrade guard (spec: never silently reduce capacity below what's
 * already provisioned). Unlimited tenants can always move to a numeric cap
 * as long as it's not below their current usage — same rule as any other
 * tenant, there's no separate "unlimited overage" concept.
 */
export async function canReduceSeatsTo(
  tenantId: string,
  newMaxUsers: number,
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const entitlement = await getEntitlement(tenantId);
  if (newMaxUsers < entitlement.currentUserCount) {
    return {
      allowed: false,
      reason: `Your organization currently has ${entitlement.currentUserCount} users. The selected limit supports ${newMaxUsers}. Please reduce the number of users to ${newMaxUsers} before this change can take effect, or choose a higher limit.`,
    };
  }
  return { allowed: true };
}
