import "server-only";
import type { PlanDocumentModel, PlanDocumentSection } from "@/lib/plan-document-model";

// Shared with the PDF exporter (rendered via Puppeteer) — this is the one
// place the document's visual layout is defined for print output.

const NAVY = "#002147";
const GOLD = "#C9A84C";

// Exported for direct test coverage — this is the one boundary between
// AI-generated (and therefore attacker-influenceable, via a prompt-injected
// uploaded document) prose and the Puppeteer-rendered PDF output.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderBscTable(section: PlanDocumentSection): string {
  const bsc = section.bscTable;
  if (!bsc) {
    return `<p class="muted italic">No Corporate Balanced Scorecard has been generated yet for this plan.</p>`;
  }

  const groups = bsc.perspectiveGroups
    .map(
      (group) => `
    <h4 class="perspective-heading">${escapeHtml(group.perspective)}</h4>
    <table class="bsc-table">
      <thead><tr>
        <th>Strategic Objective</th><th>Intended Result</th><th>Key Initiatives</th>
        <th>KPI / Measure</th><th>Baseline</th><th>Target</th><th>Owner</th>
      </tr></thead>
      <tbody>
        ${group.rows
          .map(
            (row) => `<tr>
              <td>${escapeHtml(row.strategicObjective)}</td>
              <td>${escapeHtml(row.intendedResult ?? "—")}</td>
              <td>${escapeHtml(row.keyInitiatives ?? "—")}</td>
              <td>${escapeHtml(row.kpi)}${row.unit ? ` (${escapeHtml(row.unit)})` : ""}</td>
              <td>${escapeHtml(row.baseline ?? "—")}</td>
              <td>${escapeHtml(row.target ?? "—")}</td>
              <td>${escapeHtml(row.ownerName ?? "Unassigned")}</td>
            </tr>`,
          )
          .join("")}
      </tbody>
    </table>`,
    )
    .join("");

  return `<p class="muted italic">Live from "${escapeHtml(bsc.scorecardName)}"</p>${groups}`;
}

function renderOrgStructure(section: PlanDocumentSection): string {
  const root = section.orgStructure;
  if (!root) {
    return `<p class="muted italic">No organisational hierarchy has been set up yet for this company.</p>`;
  }

  function walk(node: NonNullable<PlanDocumentSection["orgStructure"]>, depth: number): string {
    const personLine = node.personName
      ? ` — ${escapeHtml(node.personName)}${node.jobTitle ? ` (${escapeHtml(node.jobTitle)})` : ""}`
      : node.jobTitle
        ? ` — ${escapeHtml(node.jobTitle)}`
        : "";
    const children = node.children.map((c) => walk(c, depth + 1)).join("");
    return `<div class="org-node" style="margin-left:${depth * 20}px"><span class="org-type">${escapeHtml(node.positionType)}:</span> ${escapeHtml(node.label)}${personLine}</div>${children}`;
  }

  return walk(root, 0);
}

function renderSection(section: PlanDocumentSection): string {
  const tag = section.depth === 1 ? "h1" : section.depth === 2 ? "h2" : "h3";
  const anchor = `sec-${section.number.replace(/\./g, "-")}`;
  const heading = `<${tag} id="${anchor}" class="section-heading depth-${section.depth}">${escapeHtml(section.number)}. ${escapeHtml(section.title)}</${tag}>`;
  const pageBreakClass = section.depth === 1 ? " page-break" : "";

  if (section.isPlaceholder) {
    return `<div class="section${pageBreakClass}">${heading}<p class="placeholder">Pending framework specification — awaiting content.</p></div>`;
  }
  if (section.number === "5.4") {
    const framing = (section.content ?? "")
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => `<p>${escapeHtml(p)}</p>`)
      .join("");
    return `<div class="section${pageBreakClass}">${heading}${framing}${renderBscTable(section)}</div>`;
  }
  if (section.number === "2.4.1") {
    return `<div class="section${pageBreakClass}">${heading}${renderOrgStructure(section)}</div>`;
  }
  if (section.isDynamic) {
    return `<div class="section${pageBreakClass}">${heading}<p class="muted italic">Not yet available.</p></div>`;
  }

  const paragraphs = (section.content ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join("");

  return `<div class="section${pageBreakClass}">${heading}${paragraphs}</div>`;
}

function renderToc(sections: PlanDocumentSection[]): string {
  const items = sections
    .map((s) => {
      const anchor = `sec-${s.number.replace(/\./g, "-")}`;
      return `<li class="toc-depth-${s.depth}"><a href="#${anchor}">${escapeHtml(s.number)}. ${escapeHtml(s.title)}</a></li>`;
    })
    .join("");
  return `<ol class="toc">${items}</ol>`;
}

export function renderPlanHtml(model: PlanDocumentModel): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(model.companyName)} — Corporate Strategic Plan</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a1a1a; margin: 0; }
  .cover { background: ${NAVY}; color: white; height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; page-break-after: always; }
  .cover h1 { font-size: 34pt; margin: 0 0 12pt; }
  .cover .rule { width: 120px; height: 3px; background: ${GOLD}; margin: 12pt 0; }
  .cover .subtitle { color: ${GOLD}; font-size: 16pt; margin: 8pt 0 0; }
  .cover .period { font-size: 12pt; color: #cfd9ec; margin-top: 6pt; }
  .toc-page { page-break-after: always; padding: 40px; }
  .toc-page h2 { color: ${NAVY}; }
  ol.toc { list-style: none; padding: 0; }
  .toc-depth-1 { font-weight: bold; margin-top: 10px; }
  .toc-depth-2 { margin-left: 20px; }
  .toc-depth-3 { margin-left: 40px; font-size: 0.9em; color: #555; }
  .toc a { color: ${NAVY}; text-decoration: none; }
  main { padding: 0 40px 40px; }
  .section { margin-bottom: 18px; }
  .page-break { page-break-before: always; }
  .section-heading.depth-1 { color: ${NAVY}; font-size: 20pt; border-bottom: 2px solid ${GOLD}; padding-bottom: 6px; }
  .section-heading.depth-2 { color: ${NAVY}; font-size: 15pt; }
  .section-heading.depth-3 { color: #333; font-size: 12.5pt; }
  p { line-height: 1.5; font-size: 11pt; }
  .placeholder { color: #b8860b; font-style: italic; }
  .muted { color: #6b7280; }
  .italic { font-style: italic; }
  .perspective-heading { display: inline-block; background: ${NAVY}; color: white; padding: 3px 10px; border-radius: 3px; font-size: 10pt; margin-top: 14px; }
  table.bsc-table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 8.5pt; }
  table.bsc-table th { background: #eef1f7; text-align: left; padding: 4px 6px; border-bottom: 1px solid #ccc; }
  table.bsc-table td { padding: 4px 6px; border-bottom: 1px solid #eee; vertical-align: top; }
  .org-node { font-size: 10pt; padding: 2px 0; }
  .org-type { color: ${NAVY}; font-weight: bold; }
</style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(model.companyName)}</h1>
    <div class="rule"></div>
    <div class="subtitle">Corporate Strategic Plan</div>
    <div class="period">${escapeHtml(model.planPeriodLabel)}</div>
  </div>
  <div class="toc-page">
    <h2>Table of Contents</h2>
    ${renderToc(model.sections)}
  </div>
  <main>
    ${model.sections.map(renderSection).join("")}
  </main>
</body>
</html>`;
}
