import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import OrgWizard from "./OrgWizard";
import { saveOrgHierarchy, generateCascadedBSCs } from "./actions";

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin") redirect("/dashboard");

  const supabase = await createClient();

  // Check if there's an active plan
  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("id, status")
    .eq("tenant_id", user.tenant_id!)
    .eq("status", "active")
    .maybeSingle();

  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <h1 className="text-xl font-semibold text-navy">Organisational Setup</h1>
        <p className="text-sm text-gray-500">
          You need an approved Strategic Plan before setting up the organisational hierarchy.
          Please complete the questionnaire and approve the plan first.
        </p>
      </div>
    );
  }

  // Check if already generated scorecards from org
  const { data: existingPositions } = await supabase
    .from("org_positions")
    .select("*")
    .eq("tenant_id", user.tenant_id!)
    .order("sort_order", { ascending: true });

  const { count: positionScorecardCount } = await supabase
    .from("position_scorecards")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenant_id!);

  // If positions already saved and scorecards generated, show completed state
  if (existingPositions && existingPositions.length > 0 && positionScorecardCount && positionScorecardCount > 0) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <h1 className="text-xl font-semibold text-navy">Organisational Setup — Complete ✓</h1>
        <p className="text-sm text-gray-500">
          Your organisational hierarchy has been set up and {positionScorecardCount} cascaded Balanced Scorecards
          have been generated. View them from the Scorecards page.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/dashboard/scorecards"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            View Scorecards
          </Link>
          <ResetButton />
        </div>
      </div>
    );
  }

  return <OrgWizard saveAction={saveOrgHierarchy} generateAction={generateCascadedBSCs} />;
}

function ResetButton() {
  return (
    <form
      action={async () => {
        "use server";
        const user = await (await import("@/lib/auth")).getCurrentUser();
        if (!user || user.role !== "company_admin" || !user.tenant_id) return;
        const supabase = await (await import("@/lib/supabase/server")).createClient();
        await supabase.from("position_scorecards").delete().eq("tenant_id", user.tenant_id);
        const { data: toDelete } = await supabase
          .from("scorecards")
          .select("id")
          .eq("tenant_id", user.tenant_id)
          .in("scorecard_type", ["executive", "departmental", "individual"]);
        if (toDelete && toDelete.length > 0) {
          await supabase.from("scorecards").delete().in("id", toDelete.map((s) => s.id));
        }
        await supabase.from("org_positions").delete().eq("tenant_id", user.tenant_id);
        await supabase.from("tenants").update({ onboarding_completed: false }).eq("id", user.tenant_id);
        const { revalidatePath } = await import("next/cache");
        revalidatePath("/dashboard/onboarding");
      }}
    >
      <button
        type="submit"
        className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5"
      >
        Reset & Redo Setup
      </button>
    </form>
  );
}
