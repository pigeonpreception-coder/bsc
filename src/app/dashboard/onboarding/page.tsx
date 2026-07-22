import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import OrgWizard from "./OrgWizard";
import { saveOrgHierarchy, generateCascadedBSCs, loadExistingHierarchy } from "./actions";

// The cascade generation below makes one or two sequential AI calls per
// position — a large org can take a while. Give it more room than the
// platform default before Vercel cuts the function off mid-run.
export const maxDuration = 300;

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

  const { data: tenant } = await supabase
    .from("tenants")
    .select("onboarding_completed")
    .eq("id", user.tenant_id!)
    .single();

  const { count: positionScorecardCount } = await supabase
    .from("position_scorecards")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenant_id!);

  // onboarding_completed only ever gets set once cascade generation fully
  // succeeded for every position — a reliable "is this actually done"
  // signal, rather than just "does at least one scorecard exist somewhere."
  if (tenant?.onboarding_completed) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 text-center">
        <h1 className="text-xl font-semibold text-navy">Organisational Setup — Complete ✓</h1>
        <p className="text-sm text-gray-500">
          Your organisational hierarchy has been set up and {positionScorecardCount ?? 0} cascaded Balanced
          Scorecards have been generated. View them from the Scorecards page.
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

  // Not complete — show the wizard, hydrated with whatever hierarchy was
  // already saved (e.g. from a previous run that failed partway through
  // generation), so reopening this page never silently reverts to the
  // tiny default template and overwrites a real org chart.
  const existingHierarchy = await loadExistingHierarchy();

  return (
    <OrgWizard saveAction={saveOrgHierarchy} generateAction={generateCascadedBSCs} existingPositions={existingHierarchy} />
  );
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
