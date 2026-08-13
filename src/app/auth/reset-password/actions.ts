"use server";

import { createAdminClient } from "@/lib/supabase/admin";

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
    const admin = createAdminClient();
    await admin.auth.admin.signOut(accessToken, "others");
  } catch {
    // Swallowed deliberately — see comment above.
  }
}
