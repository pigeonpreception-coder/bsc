"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addTeamMember(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "staff");
  const department = String(formData.get("department") ?? "").trim();

  if (!email || !password || !department) {
    throw new Error("Email, password, and department are required");
  }
  if (!["manager", "staff", "viewer"].includes(role)) {
    throw new Error("Invalid role");
  }

  const admin = createAdminClient();

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
    role,
    tenant_id: user.tenant_id,
    department,
  });
  if (profileError) throw profileError;

  revalidatePath("/dashboard/team");
}
