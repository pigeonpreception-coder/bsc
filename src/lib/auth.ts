import { createClient } from "@/lib/supabase/server";

export type UserRole = "super_admin" | "company_admin" | "manager" | "staff" | "viewer";

export type CurrentUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  tenant_id: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("id, email, full_name, role, tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) return null;

  // A suspended or expired tenant loses access immediately, even mid-session
  // (not just at the next login) — this is the one place every page and
  // server action goes through to find out who's logged in.
  if (profile.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("license_status")
      .eq("id", profile.tenant_id)
      .single();

    if (tenant?.license_status === "suspended" || tenant?.license_status === "expired") {
      return null;
    }
  }

  return profile as CurrentUser | null;
}
