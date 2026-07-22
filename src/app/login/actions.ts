"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id")
    .eq("id", data.user.id)
    .single();

  if (profile?.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("license_status")
      .eq("id", profile.tenant_id)
      .single();

    if (tenant?.license_status === "suspended" || tenant?.license_status === "expired") {
      await supabase.auth.signOut();
      redirect(
        `/login?error=${encodeURIComponent("Your organization's access has been suspended. Contact your administrator.")}`,
      );
    }
  }

  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
