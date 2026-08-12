import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { calculatePerformanceScores, saveDailySnapshot, generatePerformanceAlerts } from "@/lib/performance";
import { isValidCronRequest } from "@/lib/cron-auth";
import { mapWithConcurrency } from "@/lib/concurrency";

// POST /api/cron/performance-recalc
// Recalculates all performance scores and saves daily snapshot
// Called by external cron or Supabase Edge Function at midnight

// See daily-tasks/route.ts for why this is a shared, conservative constant
// rather than a per-route-tuned one.
const TENANT_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  if (!isValidCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  // Get all tenants with onboarding completed
  const { data: tenants } = await supabase
    .from("tenants")
    .select("id")
    .eq("onboarding_completed", true);

  const results = await mapWithConcurrency(tenants ?? [], TENANT_CONCURRENCY, async (tenant) => {
    try {
      const result = await calculatePerformanceScores(supabase, tenant.id);
      await saveDailySnapshot(supabase, tenant.id);
      await generatePerformanceAlerts(supabase, tenant.id);
      return { tenant_id: tenant.id, positions: result?.positionsProcessed ?? 0 };
    } catch (err) {
      return { tenant_id: tenant.id, error: String(err) };
    }
  });

  return NextResponse.json({ ok: true, results });
}

// Vercel Cron always invokes via GET.
export { POST as GET };
