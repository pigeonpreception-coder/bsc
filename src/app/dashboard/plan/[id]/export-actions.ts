"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildPlanDocumentModel } from "@/lib/plan-document-model";
import { renderPlanDocx } from "@/lib/plan-document-docx";
import { renderPlanPdf } from "@/lib/plan-document-pdf";

// Keep only the 3 most recent generated files per format, per plan.
const MAX_VERSIONS_PER_TYPE = 3;
const SIGNED_URL_TTL_SECONDS = 60 * 60;

async function requireCompanyAdminForPlan(planId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("id, tenant_id").eq("id", planId).single();
  if (!plan || plan.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return { user, plan };
}

async function pruneOldVersions(
  admin: ReturnType<typeof createAdminClient>,
  planId: string,
  documentType: "pdf" | "docx",
) {
  const { data: existing } = await admin
    .from("plan_documents")
    .select("id, file_url")
    .eq("plan_id", planId)
    .eq("document_type", documentType)
    .order("generated_at", { ascending: false });

  const stale = (existing ?? []).slice(MAX_VERSIONS_PER_TYPE);
  if (stale.length === 0) return;

  await admin.storage.from("company-documents").remove(stale.map((d) => d.file_url));
  await admin
    .from("plan_documents")
    .delete()
    .in(
      "id",
      stale.map((d) => d.id),
    );
}

export async function downloadStrategicPlan(planId: string) {
  const { user, plan } = await requireCompanyAdminForPlan(planId);
  const admin = createAdminClient();

  const model = await buildPlanDocumentModel(planId);
  const [docxBuffer, pdfBuffer] = await Promise.all([renderPlanDocx(model), renderPlanPdf(model)]);

  const timestamp = Date.now();
  const docxPath = `${plan.tenant_id}/strategic-plan-documents/${planId}-${timestamp}.docx`;
  const pdfPath = `${plan.tenant_id}/strategic-plan-documents/${planId}-${timestamp}.pdf`;

  const [docxUpload, pdfUpload] = await Promise.all([
    admin.storage
      .from("company-documents")
      .upload(docxPath, docxBuffer, {
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    admin.storage.from("company-documents").upload(pdfPath, pdfBuffer, { contentType: "application/pdf" }),
  ]);
  if (docxUpload.error) throw docxUpload.error;
  if (pdfUpload.error) throw pdfUpload.error;

  const { error: logError } = await admin.from("plan_documents").insert([
    { tenant_id: plan.tenant_id, plan_id: planId, document_type: "docx", file_url: docxPath, generated_by: user.id },
    { tenant_id: plan.tenant_id, plan_id: planId, document_type: "pdf", file_url: pdfPath, generated_by: user.id },
  ]);
  if (logError) throw logError;

  await pruneOldVersions(admin, planId, "docx");
  await pruneOldVersions(admin, planId, "pdf");

  const [docxSigned, pdfSigned] = await Promise.all([
    admin.storage.from("company-documents").createSignedUrl(docxPath, SIGNED_URL_TTL_SECONDS),
    admin.storage.from("company-documents").createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS),
  ]);
  if (docxSigned.error) throw docxSigned.error;
  if (pdfSigned.error) throw pdfSigned.error;

  revalidatePath(`/dashboard/plan/${planId}`);
  return { docxUrl: docxSigned.data.signedUrl, pdfUrl: pdfSigned.data.signedUrl };
}
