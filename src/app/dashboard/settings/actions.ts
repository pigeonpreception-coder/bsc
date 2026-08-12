"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CASCADE_TIERS, parseOwnWeightPercent } from "@/lib/cascade-weights";
import { writeAuditLog } from "@/lib/audit-log";

export async function updateCascadeWeights(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  const nextRow: Record<string, unknown> = { tenant_id: user.tenant_id };
  for (const tier of CASCADE_TIERS) {
    const ownPercent = parseOwnWeightPercent(formData.get(`${tier.key}_own_weight_pct`));
    nextRow[tier.ownColumn] = ownPercent / 100;
    nextRow[tier.subColumn] = (100 - ownPercent) / 100;
  }

  const supabase = await createClient();

  const { data: previous } = await supabase
    .from("cascade_weights")
    .select("*")
    .eq("tenant_id", user.tenant_id)
    .maybeSingle();

  const { error } = await supabase.from("cascade_weights").upsert(nextRow, { onConflict: "tenant_id" });
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "update_cascade_weights",
    resource_type: "tenant",
    resource_id: user.tenant_id,
    old_value: previous ?? null,
    new_value: nextRow,
  });

  revalidatePath("/dashboard/settings");
}
