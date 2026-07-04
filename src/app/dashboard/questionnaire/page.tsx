import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import QuestionnaireForm from "./QuestionnaireForm";

export default async function QuestionnairePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data: existingPlan } = await supabase
    .from("strategic_plans")
    .select("id")
    .eq("tenant_id", user.tenant_id)
    .limit(1)
    .maybeSingle();

  if (existingPlan) {
    redirect(`/dashboard/plan/${existingPlan.id}`);
  }

  const { data: tenant } = await supabase
    .from("tenants")
    .select("company_name")
    .eq("id", user.tenant_id)
    .single();

  return (
    <div>
      <h1 className="mx-auto max-w-2xl text-xl font-semibold text-navy">Strategic Plan Questionnaire</h1>
      <p className="mx-auto mt-1 max-w-2xl text-sm text-gray-500">
        Answer these questions and our AI advisor will draft your Corporate Strategic Plan and Balanced Scorecards.
      </p>
      <div className="mt-6">
        <QuestionnaireForm defaultCompanyName={tenant?.company_name ?? ""} />
      </div>
    </div>
  );
}
