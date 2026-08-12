"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function markNotificationRead(notificationId: string) {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("tenant_id", user.tenant_id)
    .eq("user_id", user.id);

  if (error) throw error;

  revalidatePath("/dashboard", "layout");
}

export async function markAllNotificationsRead() {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("tenant_id", user.tenant_id)
    .eq("user_id", user.id)
    .eq("is_read", false);

  if (error) throw error;

  revalidatePath("/dashboard", "layout");
}
