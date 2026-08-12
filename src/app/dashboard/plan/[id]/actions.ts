"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminForPlan } from "./shared";
import { createNotification } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";

// See src/lib/concurrency.ts — same worker-pool pattern the cron routes use,
// applied here because a serial per-user loop (DB insert + a blocking Resend
// call per iteration) risked a function-timeout on the approving admin's
// click for a tenant with dozens of users.
const NOTIFICATION_CONCURRENCY = 5;

export async function approveStrategicPlan(planId: string) {
  const { user, plan, supabase } = await requireCompanyAdminForPlan(planId);

  const { error } = await supabase.from("strategic_plans").update({ status: "active" }).eq("id", planId);
  if (error) throw error;

  // Tell everyone else in the tenant — their Balanced Scorecards go live
  // the moment this flips, not just something the approver already knows.
  const { data: tenantUsers } = await supabase.from("users").select("id, email").eq("tenant_id", plan.tenant_id);
  const message = `${plan.company_name}'s strategic plan has been approved — Balanced Scorecards are now live.`;
  const recipients = (tenantUsers ?? []).filter((u) => u.id !== user.id);

  await mapWithConcurrency(recipients, NOTIFICATION_CONCURRENCY, (member) =>
    createNotification(supabase, {
      tenantId: plan.tenant_id,
      userId: member.id,
      type: "plan_approved",
      message,
      link: "/dashboard",
      email: member.email ? { to: member.email, subject: "Strategic plan approved" } : null,
    }),
  );

  revalidatePath(`/dashboard/plan/${planId}`);
}
