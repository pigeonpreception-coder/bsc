import "server-only";
import { lookup as dnsLookup } from "dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_EXTRACTED_CHARS = 8000;

// An unbounded loop over supporting documents could balloon the prompt
// size and request latency if a client uploads a large batch of files.
const MAX_SUPPORTING_DOCUMENTS = 5;

// ─── Website-fetch SSRF guards ─────────────────────────────────
// website_url is a tenant-supplied string fetched server-side (see
// fetchWebsiteText below) — without these, it's a straightforward SSRF
// primitive against internal infrastructure (including cloud metadata
// endpoints at 169.254.169.254).

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

/** True for loopback, private, link-local (incl. cloud metadata), and other non-routable ranges. Fails closed on anything unparseable. */
export function isPrivateOrReservedIp(ip: string): boolean {
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") || // fc00::/7 unique-local
      lower.startsWith("fe80") || // link-local
      lower.startsWith("::ffff:127.") // IPv4-mapped loopback
    );
  }

  const addr = ipv4ToInt(ip);
  if (addr === null) return true;

  const inRange = (base: string, bits: number) => {
    const baseAddr = ipv4ToInt(base)!;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (addr & mask) === (baseAddr & mask);
  };

  return (
    inRange("10.0.0.0", 8) ||
    inRange("172.16.0.0", 12) ||
    inRange("192.168.0.0", 16) ||
    inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) ||
    inRange("100.64.0.0", 10) || // CGNAT
    inRange("0.0.0.0", 8) ||
    inRange("192.0.0.0", 24) ||
    inRange("192.0.2.0", 24) ||
    inRange("198.18.0.0", 15) ||
    inRange("198.51.100.0", 24) ||
    inRange("203.0.113.0", 24) ||
    inRange("224.0.0.0", 4) || // multicast
    inRange("240.0.0.0", 4) // reserved
  );
}

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 2_000_000; // raw bytes, well above what MAX_EXTRACTED_CHARS could ever need
const FETCH_TIMEOUT_MS = 8000;

// Resolves and re-validates every redirect hop's IP before following it —
// following fetch's own automatic redirects would only check the first
// hop, leaving a same-origin-looking URL that 302s to an internal address.
async function safeFetch(initialUrl: string): Promise<Response | null> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(currentUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

    let address: string;
    try {
      address = (await dnsLookup(parsed.hostname)).address;
    } catch {
      return null;
    }
    if (isPrivateOrReservedIp(address)) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(currentUrl, { signal: controller.signal, redirect: "manual" });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return null;
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    return response.ok ? response : null;
  }
  return null; // too many redirects
}

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

// mammoth's public API has no length-limiting hook, unlike the manual
// JSZip iteration extractPptx (below) uses — but .docx is a zip container
// with the same "pathological compression ratio" risk §16 hardened
// extractPptx against. Pre-checking the main content stream's own
// decompressed size via JSZip, before handing the buffer to mammoth's
// heavier (style/paragraph-resolving) pipeline, bounds the worst case to
// roughly one raw decompression of that one entry rather than mammoth's
// full multi-part processing of it. Same residual limit as extractPptx's
// own per-entry decompression: bounded by process memory, not a hard cap —
// caught by extractDocumentText's try/catch below rather than crashing.
const MAX_DOCX_DECOMPRESSED_CHARS = 2_000_000;

async function extractDocx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const mainContent = zip.files["word/document.xml"];
  if (mainContent) {
    const xml = await mainContent.async("string");
    if (xml.length > MAX_DOCX_DECOMPRESSED_CHARS) {
      throw new Error("Document content too large to extract");
    }
  }

  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// JSZip's public API decompresses each entry in one shot with no size
// limit of its own — a crafted slide XML with a pathological compression
// ratio would otherwise cost unbounded memory before this function ever
// gets a chance to truncate anything. Bounding cumulative decompressed
// length across slides caps the "many bloated slides" case; a single
// slide's own decompression call is still only bounded by the process's
// own memory, same as any other decompression call in this codebase —
// caught by extractDocumentText's try/catch below rather than crashing.
const MAX_PPTX_DECOMPRESSED_CHARS = 2_000_000;

async function extractPptx(buffer: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort();

  const texts: string[] = [];
  let decompressedChars = 0;
  for (const name of slideFiles) {
    if (decompressedChars > MAX_PPTX_DECOMPRESSED_CHARS) break;
    const xml = await zip.files[name].async("string");
    decompressedChars += xml.length;
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
    const response = await safeFetch(url);
    if (!response?.body) return null;

    // Read with a hard byte cap instead of response.text(), which buffers
    // the entire body regardless of size — a slow/large response would
    // otherwise cost memory well before MAX_EXTRACTED_CHARS ever applies.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString("utf-8");

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
