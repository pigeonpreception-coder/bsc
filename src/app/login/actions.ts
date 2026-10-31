"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkLoginRateLimit, recordLoginAttempt } from "@/lib/rate-limit";
import { isBlockedUserStatus, isTenantAccessBlocked } from "@/lib/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const rateLimit = await checkLoginRateLimit(email, ip);
  if (!rateLimit.allowed) {
    redirect(`/login?error=${encodeURIComponent(rateLimit.reason)}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  await recordLoginAttempt(email, ip, !error);

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id, status")
    .eq("id", data.user.id)
    .single();

  if (profile && isBlockedUserStatus(profile.status)) {
    await supabase.auth.signOut();
    redirect(`/login?error=${encodeURIComponent("Your account has been suspended. Contact your administrator.")}`);
  }

  if (profile?.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("license_status")
      .eq("id", profile.tenant_id)
      .maybeSingle();

    if (isTenantAccessBlocked(tenant)) {
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
