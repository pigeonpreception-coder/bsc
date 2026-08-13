import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCorporateBscView, type CorporateBscView } from "@/lib/corporate-bsc-view";
import { getOrgStructureView, type OrgStructureNode } from "@/lib/org-structure-view";

// The one shared representation of "the whole document" that every export
// format (Word, PDF, and eventually the in-app viewer) renders from, so
// they can never drift apart from each other.

export type PlanDocumentSection = {
  number: string;
  title: string;
  depth: 1 | 2 | 3;
  content: string | null;
  isPlaceholder: boolean;
  isDynamic: boolean;
  bscTable?: CorporateBscView;
  orgStructure?: OrgStructureNode | null;
};

export type PlanDocumentModel = {
  companyName: string;
  planPeriodLabel: string;
  sections: PlanDocumentSection[];
};

// tenantId is asserted internally rather than trusted from the caller —
// this uses the RLS-bypassing admin client, and its one current caller
// happens to check tenant ownership first, but that's an easy invariant
// for a future caller to forget (see the same pattern already fixed in
// getCorporateBscView).
export async function buildPlanDocumentModel(planId: string, tenantId: string): Promise<PlanDocumentModel> {
  const supabase = createAdminClient();

  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .select("company_name, period_start, period_end, strategic_period_years, tenant_id")
    .eq("id", planId)
    .eq("tenant_id", tenantId)
    .single();
  if (planError || !plan) throw new Error("Strategic plan not found");

  const { data: rows, error: sectionsError } = await supabase
    .from("plan_sections")
    .select("section_number, section_title, depth, content, is_placeholder, is_dynamic")
    .eq("plan_id", planId)
    .order("sort_order", { ascending: true });
  if (sectionsError) throw sectionsError;

  const [corporateBsc, orgStructure] = await Promise.all([
    getCorporateBscView(planId, plan.tenant_id),
    getOrgStructureView(plan.tenant_id),
  ]);

  const sections: PlanDocumentSection[] = (rows ?? []).map((row) => ({
    number: row.section_number,
    title: row.section_title,
    depth: row.depth as 1 | 2 | 3,
    content: row.content,
    isPlaceholder: row.is_placeholder,
    isDynamic: row.is_dynamic,
    bscTable: row.section_number === "5.4" ? (corporateBsc ?? undefined) : undefined,
    orgStructure: row.section_number === "2.4.1" ? orgStructure : undefined,
  }));

  const planPeriodLabel = plan.strategic_period_years
    ? `${plan.strategic_period_years}-Year Strategic Plan · ${plan.period_start} to ${plan.period_end}`
    : "Corporate Strategic Plan";

  return { companyName: plan.company_name, planPeriodLabel, sections };
}
