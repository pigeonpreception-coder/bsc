import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getEntitlement } from "@/lib/licensing";
import { CASCADE_TIERS, DEFAULT_OWN_WEIGHT_PERCENT, type CascadeTierKey } from "@/lib/cascade-weights";
import CascadeWeightsForm from "./CascadeWeightsForm";
import ExportDataButton from "./ExportDataButton";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin" || !user.tenant_id) redirect("/dashboard");

  const entitlement = await getEntitlement(user.tenant_id);

  const supabase = await createClient();
  const { data: weights } = await supabase
    .from("cascade_weights")
    .select("section_own_weight, department_own_weight, executive_own_weight")
    .eq("tenant_id", user.tenant_id)
    .maybeSingle();

  const initial = CASCADE_TIERS.reduce(
    (acc, tier) => {
      const column = tier.ownColumn as "section_own_weight" | "department_own_weight" | "executive_own_weight";
      acc[tier.key] = weights ? Math.round((weights[column] as number) * 100) : DEFAULT_OWN_WEIGHT_PERCENT[tier.key];
      return acc;
    },
    {} as Record<CascadeTierKey, number>,
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Settings</h1>
        <p className="mt-1 text-sm text-gray-500">Tenant-wide configuration for your organisation.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">License &amp; users</h2>
        <p className="mt-1 text-sm text-gray-700">
          {entitlement.isUnlimitedUsers
            ? `Unlimited users — ${entitlement.currentUserCount} created`
            : `${entitlement.currentUserCount} of ${entitlement.maxUsers} users`}
        </p>
        {!entitlement.isUnlimitedUsers && entitlement.remainingSeats === 0 && (
          <p className="mt-1 text-xs text-amber-600">
            You&apos;ve reached your licensed user limit. Contact your Safina account manager to add capacity.
          </p>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Performance cascade weighting</h2>
        <p className="mt-1 text-xs text-gray-500">
          Controls how much of a position&apos;s composite performance score comes from their own KPIs versus the
          average composite score of their direct reports. Applies to Section, Department, and Executive positions —
          individual staff scores are their own KPIs only, and the Board isn&apos;t scored.
        </p>
        <CascadeWeightsForm initial={initial} />
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Data export</h2>
        <p className="mt-1 text-xs text-gray-500">
          Download a structured JSON export of your organisation&apos;s strategic plan, org structure, scorecards, users,
          and audit trail — useful for backup or if you&apos;re winding down your account.
        </p>
        <div className="mt-3">
          <ExportDataButton />
        </div>
      </div>
    </div>
  );
}
