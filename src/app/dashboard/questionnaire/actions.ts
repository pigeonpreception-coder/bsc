"use server";

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

function linesToArray(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function submitQuestionnaire(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  const supabase = await createClient();

  const companyName = String(formData.get("company_name") ?? "").trim();
  const vision = String(formData.get("vision") ?? "").trim();
  const mission = String(formData.get("mission") ?? "").trim();
  const values = linesToArray(formData.get("values"));
  const periodYears = Number(formData.get("period_years") ?? 3);
  const startYear = String(formData.get("start_year") ?? new Date().getFullYear());

  const periodStart = `${startYear}-01-01`;
  const periodEnd = `${Number(startYear) + periodYears - 1}-12-31`;

  const questionnaireAnswers = {
    industry: String(formData.get("industry") ?? "").trim(),
    country: String(formData.get("country") ?? "").trim(),
    employee_count: String(formData.get("employee_count") ?? "").trim(),
    strategic_priorities: linesToArray(formData.get("strategic_priorities")),
    products_services: linesToArray(formData.get("products_services")),
    target_markets: linesToArray(formData.get("target_markets")),
    competitors: linesToArray(formData.get("competitors")),
    financial_performance: String(formData.get("financial_performance") ?? "").trim(),
    departments: linesToArray(formData.get("departments")),
  };

  const { data: plan, error } = await supabase
    .from("strategic_plans")
    .insert({
      tenant_id: user.tenant_id,
      company_name: companyName,
      vision,
      mission,
      values,
      strategic_period_years: periodYears,
      period_start: periodStart,
      period_end: periodEnd,
      status: "draft",
      questionnaire_answers: questionnaireAnswers,
    })
    .select()
    .single();

  if (error) throw error;

  redirect(`/dashboard/plan/${plan.id}`);
}
