import "server-only";
import type { Browser } from "puppeteer-core";
import type { PlanDocumentModel } from "@/lib/plan-document-model";
import { renderPlanHtml } from "@/lib/plan-document-html";

// On Vercel (and other serverless platforms), the full `puppeteer` package's
// bundled Chromium is too large and unreliable to launch inside a function.
// @sparticuz/chromium ships a binary built specifically for that environment,
// paired with puppeteer-core (no bundled browser of its own). Locally, that
// binary doesn't run, so `npm run dev`/local builds fall back to the plain
// `puppeteer` package, which just works out of the box.
const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function launchBrowser(): Promise<Browser> {
  if (isServerless) {
    const [{ default: chromium }, { default: puppeteerCore }] = await Promise.all([
      import("@sparticuz/chromium"),
      import("puppeteer-core"),
    ]);
    return puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }) as Promise<Browser>;
  }

  const { default: puppeteer } = await import("puppeteer");
  return puppeteer.launch({ headless: true }) as unknown as Promise<Browser>;
}

export async function renderPlanPdf(model: PlanDocumentModel): Promise<Buffer> {
  const html = renderPlanHtml(model);

  const browser = await launchBrowser();
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
