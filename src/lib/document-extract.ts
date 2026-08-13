import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_EXTRACTED_CHARS = 8000;

// An unbounded loop over supporting documents could balloon the prompt
// size and request latency if a client uploads a large batch of files.
const MAX_SUPPORTING_DOCUMENTS = 5;

async function extractPdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();

  const texts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.files[name].async("string");
    const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [];
    const slideText = matches.map((m) => m.replace(/<\/?a:t>/g, "")).join(" ");
    if (slideText.trim()) texts.push(slideText);
  }
  return texts.join("\n");
}

/**
 * Best-effort text extraction for the optional company profile upload.
 * Legacy binary .doc/.ppt formats aren't supported — returns null rather
 * than pulling in a heavy legacy-office-format parser for a nice-to-have.
 */
export async function extractDocumentText(buffer: Buffer, fileName: string): Promise<string | null> {
  const ext = fileName.split(".").pop()?.toLowerCase();

  try {
    let text: string;
    if (ext === "pdf") {
      text = await extractPdf(buffer);
    } else if (ext === "docx") {
      text = await extractDocx(buffer);
    } else if (ext === "pptx") {
      text = await extractPptx(buffer);
    } else {
      return null;
    }
    return text.trim().slice(0, MAX_EXTRACTED_CHARS) || null;
  } catch {
    return null;
  }
}

/** Best-effort plain-text fetch of a company website for AI context. */
export async function fetchWebsiteText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const html = await response.text();

    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return text.slice(0, MAX_EXTRACTED_CHARS) || null;
  } catch {
    return null;
  }
}

type PlanDocumentFields = {
  tenant_id: string;
  company_profile_url: string | null;
  strategic_plan_document_url: string | null;
  supporting_documents: { url: string; fileName: string }[] | null;
  website_url: string | null;
};

// Legitimate uploads (FileUploadField.tsx) always write to
// `${tenantId}/${storageFolder}/...`, enforced by Storage RLS at upload
// time — but nothing re-checks that once the path comes back through a
// plan-save Server Action, which just persists whatever string the client
// sends. Since extractUploaded below reads via the RLS-bypassing admin
// client, an unvalidated path here would let one tenant's plan pull
// another tenant's document content into its own AI-generated output.
export function isPathOwnedByTenant(path: string, tenantId: string): boolean {
  return path.startsWith(`${tenantId}/`);
}

/**
 * Combined excerpt text from every document/website a client has provided
 * for this plan (company profile, existing Strategic Plan draft, any other
 * supporting documents, and the company website) — the shared context
 * block used by every AI generation step that reads a company's intake.
 */
export async function buildUploadedDocumentContext(plan: PlanDocumentFields): Promise<string> {
  const admin = createAdminClient();

  async function extractUploaded(path: string): Promise<string | null> {
    if (!isPathOwnedByTenant(path, plan.tenant_id)) return null;
    const { data: file } = await admin.storage.from("company-documents").download(path);
    if (!file) return null;
    const buffer = Buffer.from(await file.arrayBuffer());
    return extractDocumentText(buffer, path);
  }

  let context = "";
  if (plan.company_profile_url) {
    const text = await extractUploaded(plan.company_profile_url);
    if (text) context += `\n\nExcerpt from uploaded company profile document:\n${text}`;
  }
  if (plan.strategic_plan_document_url) {
    const text = await extractUploaded(plan.strategic_plan_document_url);
    if (text) context += `\n\nExcerpt from uploaded existing draft Strategic Plan:\n${text}`;
  }
  for (const doc of (plan.supporting_documents ?? []).slice(0, MAX_SUPPORTING_DOCUMENTS)) {
    if (!doc.url) continue;
    const text = await extractUploaded(doc.url);
    if (text) context += `\n\nExcerpt from uploaded supporting document "${doc.fileName}":\n${text}`;
  }
  if (plan.website_url) {
    const text = await fetchWebsiteText(plan.website_url);
    if (text) context += `\n\nExcerpt from company website (${plan.website_url}):\n${text}`;
  }
  return context;
}
