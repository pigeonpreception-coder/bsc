import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateWeeklyAdvisory } from "@/lib/tasks";

// POST /api/cron/weekly-advisory
// Generates AI weekly performance advisory for managers and executives
// Called by external cron every Monday at 7:00 AM

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  const { data: tenants } = await supabase
    .from("tenants")
    .select("id, company_name")
    .eq("onboarding_completed", true);

  const results: { tenant_id: string; advisories_generated: number; error?: string }[] = [];

  for (const tenant of tenants ?? []) {
    try {
      // Get executives, dept managers, and section supervisors
      const { data: positions } = await supabase
        .from("org_positions")
        .select("id")
        .eq("tenant_id", tenant.id)
        .in("position_type", ["executive", "non_executive", "section_supervisor"]);

      let count = 0;
      for (const pos of positions ?? []) {
        await generateWeeklyAdvisory(supabase, tenant.id, pos.id, tenant.company_name);
        count++;
      }

      results.push({ tenant_id: tenant.id, advisories_generated: count });
    } catch (err) {
      results.push({ tenant_id: tenant.id, advisories_generated: 0, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
