"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminForPlan } from "./shared";
import { createNotification } from "@/lib/notifications";

export async function approveStrategicPlan(planId: string) {
  const { user, plan, supabase } = await requireCompanyAdminForPlan(planId);

  const { error } = await supabase.from("strategic_plans").update({ status: "active" }).eq("id", planId);
  if (error) throw error;

  // Tell everyone else in the tenant — their Balanced Scorecards go live
  // the moment this flips, not just something the approver already knows.
  const { data: tenantUsers } = await supabase.from("users").select("id, email").eq("tenant_id", plan.tenant_id);
  const message = `${plan.company_name}'s strategic plan has been approved — Balanced Scorecards are now live.`;

  for (const member of (tenantUsers ?? []).filter((u) => u.id !== user.id)) {
    await createNotification(supabase, {
      tenantId: plan.tenant_id,
      userId: member.id,
      type: "plan_approved",
      message,
      link: "/dashboard",
      email: member.email ? { to: member.email, subject: "Strategic plan approved" } : null,
    });
  }

  revalidatePath(`/dashboard/plan/${planId}`);
}
