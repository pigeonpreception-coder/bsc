import "server-only";
import puppeteer from "puppeteer";
import type { PlanDocumentModel } from "@/lib/plan-document-model";
import { renderPlanHtml } from "@/lib/plan-document-html";

// Puppeteer bundles its own Chromium — portable across environments, but
// heavier than a plain HTTP call. If Vercel's serverless execution limits
// become an issue once this is deployed, a small dedicated rendering
// service (e.g. Browserless) is the documented fallback — not needed yet.
export async function renderPlanPdf(model: PlanDocumentModel): Promise<Buffer> {
  const html = renderPlanHtml(model);

  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="font-size:8px; width:100%; text-align:center; color:#888;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
