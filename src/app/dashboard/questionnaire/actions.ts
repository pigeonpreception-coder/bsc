"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computePeriodEnd } from "@/lib/plan-period";
import { isPathOwnedByTenant } from "@/lib/document-extract";
import type { CascadingEntry } from "./CascadingList";
import type { StatusRowEntry } from "./StatusRowList";
import type { SupportingDocument } from "./SupportingDocumentsList";

export type BusinessProfileDraft = {
  vision: string;
  mission: string;
  values: CascadingEntry[];
  overallStrategicGoal: string;
  strategicPriorities: CascadingEntry[];
  industry: string;
  industryOther: string;
  sector: string;
  sectorOther: string;
  businessDescription: string;
  businessBackground: string;
  businessDirection: string;
  companyProfileUrl: string | null;
  companyProfileFileName: string | null;
  strategicPlanDocumentUrl: string | null;
  strategicPlanDocumentFileName: string | null;
  supportingDocuments: SupportingDocument[];
  websiteUrl: string;
  // Section 2
  financialYearStart: string;
  planDurationYears: number | null;
  visionAchievementDate: string;
  keyCustomers: StatusRowEntry[];
  keyStakeholders: StatusRowEntry[];
  keyProductsServices: StatusRowEntry[];
  additionalInfo: string;
};


export async function saveBusinessProfileDraft(planId: string | null, data: BusinessProfileDraft) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  // These are client-supplied storage paths, not something re-derived from
  // an upload record — a real upload can only land under the caller's own
  // tenant folder (Storage RLS), but nothing stops the client from sending
  // a different path in this payload. Reject anything that isn't actually
  // theirs before it's saved: buildUploadedDocumentContext() later reads
  // these paths with the RLS-bypassing admin client, so an unvalidated
  // foreign path here would leak another tenant's document content into
  // this tenant's AI-generated plan.
  const documentPaths = [
    data.companyProfileUrl,
    data.strategicPlanDocumentUrl,
    ...data.supportingDocuments.map((d) => d.url),
  ].filter((url): url is string => Boolean(url));
  if (documentPaths.some((path) => !isPathOwnedByTenant(path, user.tenant_id!))) {
    throw new Error("Invalid document reference.");
  }

  const supabase = await createClient();

  const payload = {
    vision: data.vision,
    mission: data.mission,
    values: data.values,
    overall_strategic_goal: data.overallStrategicGoal,
    strategic_priorities: data.strategicPriorities,
    industry: data.industry,
    industry_other: data.industryOther || null,
    sector: data.sector,
    sector_other: data.sectorOther || null,
    business_description: data.businessDescription,
    business_background: data.businessBackground,
    business_direction: data.businessDirection,
    company_profile_url: data.companyProfileUrl,
    strategic_plan_document_url: data.strategicPlanDocumentUrl,
    supporting_documents: data.supportingDocuments,
    website_url: data.websiteUrl || null,
    financial_year_start: data.financialYearStart || null,
    strategic_period_years: data.planDurationYears,
    period_start: data.financialYearStart || null,
    period_end: data.planDurationYears
      ? computePeriodEnd(data.financialYearStart, data.planDurationYears)
      : null,
    vision_achievement_date: data.visionAchievementDate || null,
    key_customers: data.keyCustomers,
    key_stakeholders: data.keyStakeholders,
    key_products_services: data.keyProductsServices,
    additional_info: data.additionalInfo || null,
    last_saved_at: new Date().toISOString(),
  };

  if (planId) {
    const { error } = await supabase
      .from("strategic_plans")
      .update(payload)
      .eq("id", planId)
      .eq("tenant_id", user.tenant_id);
    if (error) throw error;
    revalidatePath("/dashboard/questionnaire");
    return { planId };
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name")
    .eq("id", user.tenant_id)
    .single();

  const { data: plan, error } = await supabase
    .from("strategic_plans")
    .insert({
      tenant_id: user.tenant_id,
      company_name: tenant?.company_name ?? "",
      status: "draft",
      ...payload,
    })
    .select("id")
    .single();
  if (error) throw error;

  revalidatePath("/dashboard/questionnaire");
  return { planId: plan.id as string };
}
