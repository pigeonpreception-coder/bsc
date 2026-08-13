"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth";

// Supabase doesn't revoke other sessions on a password change by default —
// if an account were ever compromised, changing the password alone
// wouldn't kick out whoever else is already signed in with the old
// session. `scope: "others"` keeps the session that just changed the
// password alive (identified by its own access token) while ending every
// other one for that same user.
//
// Best-effort: the password change itself already succeeded by the time
// this runs (called after updateUser() on the client), so a failure here
// shouldn't block the user from continuing — it's hardening, not the core
// operation.
export async function revokeOtherSessions(accessToken: string): Promise<void> {
  try {
    // accessToken is a client-supplied argument — unlike every other
    // identifier trusted elsewhere in this codebase (all fixed to assert
    // tenant/user ownership, see the assessment doc's gap-scan history),
    // this one isn't re-derived from the caller's own session by default.
    // Resolve who the token actually authenticates as via Supabase itself,
    // and only act if that matches the caller's own cookie-based session —
    // not just whatever token they happened to send.
    const currentUser = await getCurrentUser();
    if (!currentUser) return;

    const admin = createAdminClient();
    const { data: tokenUser } = await admin.auth.getUser(accessToken);
    if (tokenUser.user?.id !== currentUser.id) return;

    await admin.auth.admin.signOut(accessToken, "others");
  } catch {
    // Swallowed deliberately — see comment above.
  }
}
