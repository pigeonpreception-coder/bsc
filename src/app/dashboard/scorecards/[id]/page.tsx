import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ScorecardTable from "./ScorecardTable";

export default async function ScorecardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: scorecard } = await supabase.from("scorecards").select("*").eq("id", id).single();
  if (!scorecard) notFound();

  const { data: rows } = await supabase
    .from("scorecard_rows")
    .select("*")
    .eq("scorecard_id", id)
    .order("sort_order", { ascending: true });

  const { data: teamMembers } = await supabase
    .from("users")
    .select("id, full_name, email")
    .eq("tenant_id", scorecard.tenant_id)
    .in("role", ["manager", "staff"]);

  const teamOptions = (teamMembers ?? []).map((m) => ({ value: m.id, label: m.full_name || m.email }));
  const canEditAll = user.role === "company_admin";
  const canUpdateActual = user.role === "manager" || user.role === "staff";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">{scorecard.name}</h1>
        <p className="text-sm capitalize text-gray-500">{scorecard.scorecard_type} scorecard</p>
      </div>

      <ScorecardTable
        scorecardId={id}
        rows={rows ?? []}
        canEditAll={canEditAll}
        currentUserId={user.id}
        canUpdateActual={canUpdateActual}
        teamOptions={teamOptions}
      />
    </div>
  );
}
