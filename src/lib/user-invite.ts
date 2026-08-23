import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications";
import { resolveAppUrl } from "@/lib/site-url";

export type UserRole = "company_admin" | "manager" | "staff" | "viewer";

export type InviteUserAccountParams = {
  email: string;
  fullName: string | null;
  role: UserRole;
  tenantId: string;
  department?: string | null;
  /**
   * Request origin, used as a last-resort fallback for the invite email's
   * redirect link — only if neither NEXT_PUBLIC_APP_URL nor VERCEL_URL is
   * set. Never trusted directly: it's a client-supplied header, and this
   * function is reachable by an authenticated company_admin/super_admin
   * inviting an arbitrary email, so an attacker-controlled origin here
   * would point a real invite email at a phishing domain. See
   * resolveAppUrl's own comment.
   */
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
  const origin = resolveAppUrl(params.origin);
  const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(params.email, {
    redirectTo: `${origin}/auth/reset-password`,
  });
  if (authError) {
    // auth.users is shared/global across every tenant in this single
    // Supabase project — surfacing the raw "already registered" error
    // verbatim would let a company_admin at one tenant learn whether an
    // arbitrary email has an account anywhere on the platform, including
    // in a different tenant. Generalize just this one case; every other
    // error (invalid email, network failure, etc.) doesn't carry that
    // same cross-tenant signal, so it's still surfaced as-is.
    if (authError.code === "email_exists" || authError.code === "user_already_exists") {
      throw new Error("Could not send the invite. Check the email address and try again.");
    }
    throw authError;
  }

  // provision_tenant_user (migration 0023) checks the tenant's seat limit
  // and inserts the profile row in one atomic, row-locked transaction —
  // see its own definition for why a plain insert here can't be made
  // race-safe from application code alone.
  const { error: profileError } = await admin.rpc("provision_tenant_user", {
    p_user_id: authUser.user.id,
    p_tenant_id: params.tenantId,
    p_email: params.email,
    p_full_name: params.fullName,
    p_role: params.role,
    p_department: params.department ?? null,
  });
  if (profileError) {
    // Don't leave an orphaned login behind — that email becomes permanently
    // unusable for future signups otherwise, with no UI to find or fix it.
    await admin.auth.admin.deleteUser(authUser.user.id);
    if (profileError.message?.startsWith("SEAT_LIMIT_REACHED:")) {
      const maxUsers = profileError.message.split(":")[1];
      throw new Error(
        `Your current license allows up to ${maxUsers} users. You have reached your licensed user limit. Please upgrade your license or purchase additional user capacity before adding another user.`,
      );
    }
    throw profileError;
  }

  // In-app only — Supabase's own invite email is the actionable one (it
  // carries the set-password link); this just greets them once they arrive,
  // since the bell isn't visible until after they've logged in anyway.
  await createNotification(admin, {
    tenantId: params.tenantId,
    userId: authUser.user.id,
    type: "account_created",
    message: "Welcome to Safina BSC Platform. Your account is ready.",
    link: "/dashboard",
  });

  return { id: authUser.user.id };
}
