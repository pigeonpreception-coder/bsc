"use server";

import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit-log";

const SIGNED_URL_TTL_SECONDS = 60 * 60;

// A structured JSON dump, not a formatted document — this is a data-
// portability/termination export (GDPR-style "give me my data"), not a
// board-ready report, so raw structured data is more useful here than a
// rendered PDF. Deliberately scoped to the core governance-relevant tables
// (org structure, strategic plan, scorecards, users, audit trail) rather
// than every table in the schema — high-volume/secondary tables
// (performance_snapshots, scorecard_versions, notifications, daily_tasks,
// weekly_advisories) are left out to keep the export bounded and legible;
// a future pass can add a table-selection option if that's ever needed.
export async function exportTenantData() {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const admin = createAdminClient();
  const tenantId = user.tenant_id;

  const [
    { data: tenant },
    { data: strategicPlans },
    { data: orgPositions },
    { data: scorecards },
    { data: scorecardRows },
    { data: users },
    { data: auditLog },
  ] = await Promise.all([
    admin
      .from("tenants")
      .select("id, company_name, license_tier, license_status, license_start, license_end, created_at")
      .eq("id", tenantId)
      .maybeSingle(),
    admin.from("strategic_plans").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    admin.from("org_positions").select("*").eq("tenant_id", tenantId).order("sort_order", { ascending: true }),
    admin.from("scorecards").select("*").eq("tenant_id", tenantId),
    admin.from("scorecard_rows").select("*").eq("tenant_id", tenantId),
    admin.from("users").select("id, email, full_name, role, department, status, created_at").eq("tenant_id", tenantId),
    admin.from("audit_log").select("*").eq("tenant_id", tenantId).order("timestamp", { ascending: false }).limit(5000),
  ]);
  if (!tenant) throw new Error("Tenant not found");

  const exportPayload = {
    exported_at: new Date().toISOString(),
    exported_by: user.email,
    tenant,
    strategic_plans: strategicPlans ?? [],
    org_positions: orgPositions ?? [],
    scorecards: scorecards ?? [],
    scorecard_rows: scorecardRows ?? [],
    users: users ?? [],
    audit_log: auditLog ?? [],
  };

  const path = `${tenantId}/data-exports/tenant-export-${Date.now()}.json`;
  const { error: uploadError } = await admin.storage
    .from("company-documents")
    .upload(path, Buffer.from(JSON.stringify(exportPayload, null, 2), "utf-8"), { contentType: "application/json" });
  if (uploadError) throw uploadError;

  await writeAuditLog(admin, {
    tenant_id: tenantId,
    user_id: user.id,
    action: "export_tenant_data",
    resource_type: "tenant",
    resource_id: tenantId,
    old_value: null,
    new_value: { path },
  });

  const { data: signed, error: signError } = await admin.storage
    .from("company-documents")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signError) throw signError;

  return { url: signed.signedUrl };
}
