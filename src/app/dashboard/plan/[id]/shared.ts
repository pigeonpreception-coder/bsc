import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

// Shared by actions.ts, document-actions.ts, and export-actions.ts so this
// authorization check only ever lives in one place. strategic_plans.status
// gates whether this tenant's Balanced Scorecards go live (see
// 0036_lock_down_strategic_plans_and_scorecard_design.sql), so writes need
// the service-role key — the tenant check right below is what makes that safe.
export async function requireCompanyAdminForPlan(planId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = createAdminClient();
  const { data: plan } = await supabase.from("strategic_plans").select("*").eq("id", planId).single();
  if (!plan || plan.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return { user, plan, supabase };
}
