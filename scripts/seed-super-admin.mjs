// One-time seed script: creates the Super Admin user and the FCTS tenant.
// Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... node scripts/seed-super-admin.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
const adminFullName = process.env.SEED_ADMIN_NAME ?? "Dushimire JP";

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}
if (!adminEmail || !adminPassword) {
  throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables before running.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(`Creating auth user for ${adminEmail}...`);
  const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
  });

  if (authError) throw authError;
  const userId = authUser.user.id;

  console.log("Inserting super_admin profile...");
  const { error: profileError } = await supabase.from("users").insert({
    id: userId,
    email: adminEmail,
    full_name: adminFullName,
    role: "super_admin",
    tenant_id: null,
  });
  if (profileError) throw profileError;

  console.log("Creating FCTS tenant...");
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      company_name: "First Capital Treasury Solutions",
      license_tier: "professional",
      license_status: "active",
      license_start: new Date().toISOString().slice(0, 10),
      created_by: userId,
    })
    .select()
    .single();
  if (tenantError) throw tenantError;

  console.log("\nDone.");
  console.log(`Super Admin user id: ${userId}`);
  console.log(`FCTS tenant id: ${tenant.id}`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
