import "server-only";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Shared by actions.ts, document-actions.ts, and export-actions.ts so this
// authorization check only ever lives in one place.
export async function requireCompanyAdminForPlan(planId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("*").eq("id", planId).single();
  if (!plan || plan.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return { user, plan, supabase };
}
