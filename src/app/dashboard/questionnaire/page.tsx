import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import BusinessProfileForm, { type InitialProfileData } from "./BusinessProfileForm";

export default async function QuestionnairePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin") redirect("/dashboard");

  const supabase = await createClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name")
    .eq("id", user.tenant_id)
    .single();

  const { data: existingPlan } = await supabase
    .from("strategic_plans")
    .select("*")
    .eq("tenant_id", user.tenant_id)
    .limit(1)
    .maybeSingle();

  if (existingPlan && existingPlan.status === "active") {
    redirect(`/dashboard/plan/${existingPlan.id}`);
  }

  const initialData: InitialProfileData = existingPlan
    ? {
        vision: existingPlan.vision ?? "",
        mission: existingPlan.mission ?? "",
        values: existingPlan.values ?? [],
        overallStrategicGoal: existingPlan.overall_strategic_goal ?? "",
        strategicPriorities: existingPlan.strategic_priorities ?? [],
        industry: existingPlan.industry ?? "",
        industryOther: existingPlan.industry_other ?? "",
        sector: existingPlan.sector ?? "",
        sectorOther: existingPlan.sector_other ?? "",
        businessDescription: existingPlan.business_description ?? "",
        businessBackground: existingPlan.business_background ?? "",
        businessDirection: existingPlan.business_direction ?? "",
        companyProfileUrl: existingPlan.company_profile_url,
        companyProfileFileName: existingPlan.company_profile_url
          ? existingPlan.company_profile_url.split("/").pop()?.replace(/^\d+-/, "")
          : null,
        websiteUrl: existingPlan.website_url ?? "",
        financialYearStart: existingPlan.financial_year_start ?? "",
        planDurationYears: existingPlan.strategic_period_years ?? null,
        visionAchievementDate: existingPlan.vision_achievement_date ?? "",
        keyCustomers: existingPlan.key_customers ?? [],
        keyStakeholders: existingPlan.key_stakeholders ?? [],
        additionalInfo: existingPlan.additional_info ?? "",
      }
    : {};

  return (
    <BusinessProfileForm
      planId={existingPlan?.id ?? null}
      tenantId={user.tenant_id!}
      companyName={tenant?.company_name ?? ""}
      initialData={initialData}
      initialLastSavedAt={existingPlan?.last_saved_at ?? null}
    />
  );
}
