import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calculatePerformanceScores, saveDailySnapshot, generatePerformanceAlerts } from "@/lib/performance";

// POST /api/cron/performance-recalc
// Recalculates all performance scores and saves daily snapshot
// Called by external cron or Supabase Edge Function at midnight

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();

  // Get all tenants with onboarding completed
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id")
    .eq("onboarding_completed", true);

  const results: { tenant_id: string; positions?: number; error?: string }[] = [];

  for (const tenant of tenants ?? []) {
    try {
      const result = await calculatePerformanceScores(supabase, tenant.id);
      await saveDailySnapshot(supabase, tenant.id);
      await generatePerformanceAlerts(supabase, tenant.id);
      results.push({ tenant_id: tenant.id, positions: result?.positionsProcessed ?? 0 });
    } catch (err) {
      results.push({ tenant_id: tenant.id, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
