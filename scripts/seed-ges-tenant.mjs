// One-time seed script: creates the Green Enterprise Solutions (GES) tenant
// with the real Corporate BSC + MD Executive BSC as reference test data
// (source: 01_GES_Corporate_BSC_FY2026-2027.xlsx, GES_MD_Balanced_Scorecard_FY2026-2027.xlsx).
//
// Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node scripts/seed-ges-tenant.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const contents = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of contents.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim();
  }
}
loadEnvLocal();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.SEED_ADMIN_EMAIL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const adminFullName = process.env.SEED_ADMIN_NAME ?? "GES Company Admin";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}
if (!adminEmail || !adminPassword) {
  throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables before running.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const corpObjectives = JSON.parse(readFileSync(join(__dirname, "ges_corp_bsc.json"), "utf8"));
const mdObjectives = JSON.parse(readFileSync(join(__dirname, "ges_md_bsc.json"), "utf8"));

function objectivesToRows(objectives, scorecardId, tenantId) {
  const rows = [];
  let sortOrder = 0;
  for (const obj of objectives) {
    for (const kpiRow of obj.rows) {
      rows.push({
        scorecard_id: scorecardId,
        tenant_id: tenantId,
        perspective: obj.perspective,
        strategic_objective: obj.strategic_objective,
        strategic_theme_alignment: obj.strategic_theme_alignment,
        intended_result: obj.intended_result,
        key_initiatives: obj.key_initiatives,
        perspective_weight: obj.perspective_weight,
        objective_weight: obj.objective_weight,
        kpi: kpiRow.kpi,
        unit: kpiRow.unit,
        baseline: kpiRow.baseline,
        target: kpiRow.target,
        measurement_frequency: kpiRow.measurement_frequency,
        actual: null,
        lower_is_better: false,
        status: "not_yet_measured",
        sort_order: sortOrder++,
      });
    }
  }
  return rows;
}

async function main() {
  const { data: superAdmin } = await supabase.from("users").select("id").eq("role", "super_admin").limit(1).single();

  console.log("Creating Green Enterprise Solutions tenant...");
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      company_name: "Green Enterprise Solutions (Pty) Ltd",
      license_tier: "enterprise",
      license_status: "active",
      license_start: new Date().toISOString().slice(0, 10),
      created_by: superAdmin?.id ?? null,
    })
    .select()
    .single();
  if (tenantError) throw tenantError;
  const tenantId = tenant.id;

  console.log(`Creating GES Company Admin (${adminEmail})...`);
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });
  if (authError) throw authError;
  const userId = authUser.user.id;

  console.log("Creating Company Admin profile...");
  const { error: profileError } = await supabase.from("users").insert({
    id: userId,
    email: adminEmail,
    full_name: adminFullName,
    role: "company_admin",
    tenant_id: tenantId,
  });
  if (profileError) throw profileError;

  console.log("Creating Strategic Plan...");
  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .insert({
      tenant_id: tenantId,
      company_name: "Green Enterprise Solutions (Pty) Ltd",
      vision: "To be a globally recognised leader in innovative technology solutions by 2030.",
      mission: "Empowering businesses and communities through future-ready technology solutions.",
      values: [
        { name: "Teamwork", description: "We achieve more together than alone." },
        { name: "Integrity", description: "We do the right thing, especially when no one is watching." },
        { name: "People", description: "Our people are our greatest asset and competitive advantage." },
        { name: "Autonomy", description: "We empower ownership and decisive action at every level." },
        { name: "Innovation", description: "We continuously pursue future-ready solutions." },
        { name: "Diversity & Inclusion", description: "We draw strength from diverse perspectives and backgrounds." },
      ],
      strategic_period_years: 4,
      period_start: "2026-07-01",
      period_end: "2030-06-30",
      financial_year_start: "2026-07-01",
      status: "active",
      industry: "Information & Communication Technology (ICT)",
      sector: "Private Sector",
      business_description:
        "Green Enterprise Solutions is a Namibian technology company delivering ERP, CRM, PMS and managed ICT services, expanding into SaaS, fintech, data centre and security operations across the SADC region and beyond.",
    })
    .select()
    .single();
  if (planError) throw planError;
  const planId = plan.id;

  console.log("Creating Corporate Scorecard (Board / Managing Director)...");
  const { data: corpScorecard, error: corpScErr } = await supabase
    .from("scorecards")
    .insert({
      tenant_id: tenantId,
      plan_id: planId,
      scorecard_type: "corporate",
      name: "Green Enterprise Solutions — Corporate Scorecard",
      status: "active",
    })
    .select()
    .single();
  if (corpScErr) throw corpScErr;

  const corpRows = objectivesToRows(corpObjectives, corpScorecard.id, tenantId);
  const { error: corpRowsErr } = await supabase.from("scorecard_rows").insert(corpRows);
  if (corpRowsErr) throw corpRowsErr;
  console.log(`  -> ${corpObjectives.length} objectives, ${corpRows.length} KPI rows`);

  console.log("Creating MD Executive Scorecard (cascaded from Corporate)...");
  const { data: mdScorecard, error: mdScErr } = await supabase
    .from("scorecards")
    .insert({
      tenant_id: tenantId,
      plan_id: planId,
      scorecard_type: "executive",
      name: "Managing Director — Executive Balanced Scorecard",
      department_name: "Office of the Managing Director",
      parent_scorecard_id: corpScorecard.id,
      status: "active",
    })
    .select()
    .single();
  if (mdScErr) throw mdScErr;

  const mdRows = objectivesToRows(mdObjectives, mdScorecard.id, tenantId);
  const { error: mdRowsErr } = await supabase.from("scorecard_rows").insert(mdRows);
  if (mdRowsErr) throw mdRowsErr;
  console.log(`  -> ${mdObjectives.length} objectives, ${mdRows.length} KPI rows`);

  console.log("\nDone.");
  console.log(`Tenant id: ${tenantId}`);
  console.log(`Company Admin: ${adminEmail}`);
  console.log(`Plan id: ${planId}`);
  console.log(`Corporate scorecard id: ${corpScorecard.id}`);
  console.log(`MD scorecard id: ${mdScorecard.id}`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
