import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateDailyTasks } from "@/lib/tasks";
import { isValidCronRequest } from "@/lib/cron-auth";

// POST /api/cron/daily-tasks
// Generates AI daily tasks for all users across all tenants
// Called by external cron at 6:00 AM

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

  const results: { tenant_id: string; users_processed: number; total_tasks: number; error?: string }[] = [];

  for (const tenant of tenants ?? []) {
    try {
      // Get all non-board positions that are explicitly linked to a user
      const { data: positions } = await supabase
        .from("org_positions")
        .select("id, user_id")
        .eq("tenant_id", tenant.id)
        .neq("position_type", "board")
        .not("user_id", "is", null);

      if (!positions) continue;

      let usersProcessed = 0;
      let totalTasks = 0;

      for (const pos of positions) {
        const tasksGenerated = await generateDailyTasks(supabase, pos.user_id as string, tenant.id, pos.id);
        totalTasks += tasksGenerated;
        usersProcessed++;
      }

      results.push({ tenant_id: tenant.id, users_processed: usersProcessed, total_tasks: totalTasks });
    } catch (err) {
      results.push({ tenant_id: tenant.id, users_processed: 0, total_tasks: 0, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}

// Vercel Cron always invokes via GET.
export { POST as GET };
