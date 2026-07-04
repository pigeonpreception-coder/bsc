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

  return profile as CurrentUser | null;
}
