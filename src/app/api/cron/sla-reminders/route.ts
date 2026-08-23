import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidCronRequest } from "@/lib/cron-auth";
import { mapWithConcurrency } from "@/lib/concurrency";
import { resolveApprovalChainFromPositions, type OrgPositionLite } from "@/lib/approval-hierarchy";
import { createNotification } from "@/lib/notifications";
import { daysSince, classifyReviewAge } from "@/lib/sla";

// POST /api/cron/sla-reminders
// A scorecard sitting in pending_manager_review/pending_final_review with no
// decision gets a reminder to its resolved approver after REVIEW_REMINDER_DAYS,
// then an escalation to every company_admin after REVIEW_ESCALATION_DAYS.
// Runs daily — an item past the escalation threshold gets re-escalated on
// every subsequent run rather than only once, a deliberate simplification
// (no "already escalated" dedup table) matching this cron's low expected
// volume: most scorecards never get stuck, so this only ever fires for the
// exception case, not routine load.
// Called by external cron daily.

const TENANT_CONCURRENCY = 5;
const NOTIFICATION_CONCURRENCY = 5;

export async function POST(request: NextRequest) {
  if (!isValidCronRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: tenants } = await supabase.from("tenants").select("id").eq("onboarding_completed", true);

  const results = await mapWithConcurrency(tenants ?? [], TENANT_CONCURRENCY, async (tenant) => {
    try {
      const [{ data: scorecards }, { data: positions }] = await Promise.all([
        supabase
          .from("scorecards")
          .select("id, name, owner_user_id, workflow_status, agreed_at, first_approved_at")
          .eq("tenant_id", tenant.id)
          .in("workflow_status", ["pending_manager_review", "pending_final_review"]),
        supabase
          .from("org_positions")
          .select("id, user_id, reports_to_id, position_type")
          .eq("tenant_id", tenant.id),
      ]);

      let reminders = 0;
      let escalations = 0;

      for (const scorecard of scorecards ?? []) {
        if (!scorecard.owner_user_id) continue;

        const waitingSince =
          scorecard.workflow_status === "pending_manager_review" ? scorecard.agreed_at : scorecard.first_approved_at;
        if (!waitingSince) continue;

        const status = classifyReviewAge(daysSince(waitingSince));
        if (status === "ok") continue;

        const chain = resolveApprovalChainFromPositions((positions ?? []) as OrgPositionLite[], scorecard.owner_user_id);
        if (chain.blockedReason) continue;

        if (status === "reminder") {
          const approverId = scorecard.workflow_status === "pending_manager_review" ? chain.firstApproverId : chain.finalApproverId;
          if (!approverId) continue;

          const { data: approver } = await supabase.from("users").select("email").eq("id", approverId).maybeSingle();
          await createNotification(supabase, {
            tenantId: tenant.id,
            userId: approverId,
            type: "bsc_review_reminder",
            message: `"${scorecard.name}" has been waiting on your review for a few days — please take a look.`,
            link: "/dashboard/approvals",
            email: approver?.email ? { to: approver.email, subject: "A BSC is waiting on your review" } : null,
          });
          reminders++;
        } else {
          const { data: admins } = await supabase
            .from("users")
            .select("id, email")
            .eq("tenant_id", tenant.id)
            .eq("role", "company_admin");
          await mapWithConcurrency(admins ?? [], NOTIFICATION_CONCURRENCY, (admin) =>
            createNotification(supabase, {
              tenantId: tenant.id,
              userId: admin.id,
              type: "bsc_review_overdue_escalation",
              message: `"${scorecard.name}" has been awaiting review for over a week with no decision.`,
              link: `/dashboard/scorecards/${scorecard.id}`,
              email: admin.email ? { to: admin.email, subject: "A BSC review is overdue" } : null,
            }),
          );
          escalations++;
        }
      }

      return { tenant_id: tenant.id, reminders, escalations };
    } catch (err) {
      return { tenant_id: tenant.id, reminders: 0, escalations: 0, error: String(err) };
    }
  });

  return NextResponse.json({ ok: true, results });
}

// Vercel Cron always invokes via GET.
export { POST as GET };
