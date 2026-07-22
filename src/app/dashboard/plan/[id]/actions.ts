"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminForPlan } from "./shared";

export async function approveStrategicPlan(planId: string) {
  const { supabase } = await requireCompanyAdminForPlan(planId);

  const { error } = await supabase.from("strategic_plans").update({ status: "active" }).eq("id", planId);
  if (error) throw error;

  revalidatePath(`/dashboard/plan/${planId}`);
}
