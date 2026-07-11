import "server-only";

const MAX_EXTRACTED_CHARS = 8000;

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
