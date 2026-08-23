import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type SignUpNewTenantParams = {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
  emailRedirectTo: string | null;
};

export type SignUpNewTenantResult = { needsEmailConfirmation: boolean };

const ALREADY_REGISTERED_MESSAGE = "An account with this email already exists. Try logging in instead.";

/**
 * Creates a brand-new tenant and its first company_admin in one step, using
 * supabase.auth.signUp() rather than the admin-invite flow (inviteUserAccount
 * in user-invite.ts) — that flow always emails a set-password link and
 * requires the service-role client; self-serve signup needs the visitor to
 * pick their own password immediately, which is signUp()'s job, called on
 * the passed-in (anon-key, cookie-bound) client so a returned session
 * persists normally.
 *
 * Everything after the auth call runs on the admin client: a brand-new
 * signup has no tenant_id yet to assert via RLS the way every other
 * admin-client caller in this codebase does (see admin.ts's own doc
 * comment) — this is a genuinely different trust boundary, protected only
 * by signUp() itself succeeding and the caller's rate limiting, not an
 * authenticated session.
 */
export async function signUpNewTenant(
  supabase: SupabaseClient,
  params: SignUpNewTenantParams,
): Promise<SignUpNewTenantResult> {
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: { full_name: params.fullName },
      emailRedirectTo: params.emailRedirectTo ?? undefined,
    },
  });
  if (authError) {
    // auth.users is shared/global across every tenant in this single
    // Supabase project — same codes user-invite.ts already generalizes,
    // reused here with signup-appropriate copy (a visitor signing up for
    // their own email benefits from being told to log in instead, unlike
    // the invite case where an admin is probing someone else's email).
    if (authError.code === "email_exists" || authError.code === "user_already_exists") {
      throw new Error(ALREADY_REGISTERED_MESSAGE);
    }
    throw authError;
  }
  if (!authData.user) throw new Error("Signup failed — please try again.");

  // When both "Confirm email" and "Confirm phone" are enabled in the
  // Supabase project (the typical/recommended setting), signUp() called
  // for an email that already has a CONFIRMED account returns an
  // obfuscated/fake user object instead of an error — deliberate
  // anti-enumeration behavior on Supabase's part, documented on
  // GoTrueClient's signUp() JSDoc. A genuinely new user's response always
  // has at least one entry in `identities`; the fake one comes back with
  // an empty array. Without this check, a repeat signup attempt for an
  // existing email would silently create a garbage tenant and an orphaned
  // profile row keyed to an id nobody can ever actually log in as.
  if (authData.user.identities && authData.user.identities.length === 0) {
    throw new Error(ALREADY_REGISTERED_MESSAGE);
  }

  const admin = createAdminClient();

  // New tenants get the same column defaults a super_admin would leave
  // unset for any other tenant today (license_tier: 'basic', license_status:
  // 'active') — no separate trial/paywall concept exists yet in this schema.
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ company_name: params.companyName })
    .select("id")
    .single();
  if (tenantError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    throw tenantError;
  }

  const { error: profileError } = await admin.from("users").insert({
    id: authData.user.id,
    email: params.email,
    full_name: params.fullName,
    role: "company_admin",
    tenant_id: tenant.id,
  });
  if (profileError) {
    // Same "don't leave an orphaned login behind" reasoning as
    // inviteUserAccount, extended to also clean up the tenant row this
    // function (unlike inviteUserAccount) is the one that created.
    await admin.auth.admin.deleteUser(authData.user.id);
    await admin.from("tenants").delete().eq("id", tenant.id);
    throw profileError;
  }

  return { needsEmailConfirmation: authData.session === null };
}
