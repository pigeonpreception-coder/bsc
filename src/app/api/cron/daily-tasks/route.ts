import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateDailyTasks } from "@/lib/tasks";

// POST /api/cron/daily-tasks
// Generates AI daily tasks for all users across all tenants
// Called by external cron at 6:00 AM

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

  const results: { tenant_id: string; users_processed: number; total_tasks: number; error?: string }[] = [];

  for (const tenant of tenants ?? []) {
    try {
      // Get all non-board positions with their linked users
      const { data: positions } = await supabase
        .from("org_positions")
        .select("id, first_name, surname")
        .eq("tenant_id", tenant.id)
        .neq("position_type", "board");

      if (!positions) continue;

      // For each position, find the matching user
      const { data: users } = await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", tenant.id)
        .in("role", ["company_admin", "manager", "staff"]);

      let usersProcessed = 0;
      let totalTasks = 0;

      for (const pos of positions) {
        // Try to match position to user by name
        const posName = [pos.first_name, pos.surname].filter(Boolean).join(" ").toLowerCase();
        const matchedUser = (users ?? []).find((u) => {
          const uName = (u.full_name ?? u.email).toLowerCase();
          return uName.includes(posName) || posName.includes(uName);
        });

        if (!matchedUser) continue;

        const tasksGenerated = await generateDailyTasks(supabase, matchedUser.id, tenant.id, pos.id);
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
