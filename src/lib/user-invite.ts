import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

export type UserRole = "company_admin" | "manager" | "staff" | "viewer";

export type InviteUserAccountParams = {
  email: string;
  fullName: string | null;
  role: UserRole;
  tenantId: string;
  department?: string | null;
  /** Request origin, used to build the invite email's redirect link. */
  origin: string | null;
};

/**
 * Shared by addTeamMember (dashboard/team/actions.ts) and createCompanyAdmin
 * (admin/actions.ts) — both independently reimplemented this exact
 * "invite, insert the profile row, roll back the auth user if that insert
 * fails" sequence before this was extracted (see the current-state
 * assessment's duplicate-account-creation-logic finding).
 *
 * Does NOT write audit_log — the two call sites log different actions and
 * payload shapes, so that stays at the call site rather than being forced
 * into a one-size-fits-all shape here.
 */
export async function inviteUserAccount(params: InviteUserAccountParams): Promise<{ id: string }> {
  const admin = createAdminClient();

  // See dashboard/team/actions.ts for why this redirects straight to
  // /auth/reset-password rather than through /auth/callback: inviteUserByEmail
  // doesn't support PKCE (the invite is opened by the invitee, not the admin
  // who sent it), so it delivers tokens as a URL hash fragment instead of a
  // ?code= param, which the browser client auto-detects on that page.
  const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(params.email, {
    redirectTo: `${params.origin}/auth/reset-password`,
  });
  if (authError) throw authError;

  const { error: profileError } = await admin.from("users").insert({
    id: authUser.user.id,
    email: params.email,
    full_name: params.fullName,
    role: params.role,
    tenant_id: params.tenantId,
    department: params.department ?? null,
  });
  if (profileError) {
    // Don't leave an orphaned login behind — that email becomes permanently
    // unusable for future signups otherwise, with no UI to find or fix it.
    await admin.auth.admin.deleteUser(authUser.user.id);
    throw profileError;
  }

  return { id: authUser.user.id };
}
