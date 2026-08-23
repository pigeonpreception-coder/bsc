import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import UnlockButton from "./UnlockButton";

const WORKFLOW_LABELS: Record<string, string> = {
  owner_editing: "Editing",
  pending_manager_review: "Pending first-level review",
  pending_final_review: "Pending final approval",
  locked: "Locked",
};

export default async function ScorecardsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: scorecards } = await supabase
    .from("scorecards")
    .select("id, name, scorecard_type, department_name, owner_user_id, workflow_status")
    .eq("tenant_id", user.tenant_id)
    .order("scorecard_type", { ascending: true });

  const groups: Record<string, typeof scorecards> = {
    corporate: [],
    executive: [],
    departmental: [],
    individual: [],
  };
  for (const sc of scorecards ?? []) {
    groups[sc.scorecard_type]?.push(sc);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold text-navy">Balanced Scorecards</h1>

      {(["corporate", "executive", "departmental", "individual"] as const).map((type) => (
        <div key={type} className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold capitalize text-navy">{type}</h2>
          {groups[type] && groups[type]!.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {groups[type]!.map((sc) => (
                <li key={sc.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/dashboard/scorecards/${sc.id}`} className="text-sm text-navy hover:underline">
                    {sc.name}
                  </Link>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {WORKFLOW_LABELS[sc.workflow_status] ?? sc.workflow_status}
                    </span>
                    {user.role === "company_admin" && sc.workflow_status === "locked" && <UnlockButton scorecardId={sc.id} />}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">None yet.</p>
          )}
        </div>
      ))}
    </div>
  );
}
