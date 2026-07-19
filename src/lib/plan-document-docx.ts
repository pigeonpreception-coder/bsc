import "server-only";
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  Packer,
  TableOfContents,
  AlignmentType,
  PageBreak,
  ShadingType,
  BorderStyle,
} from "docx";
import type { PlanDocumentModel, PlanDocumentSection } from "@/lib/plan-document-model";
import type { CorporateBscView } from "@/lib/corporate-bsc-view";

const NAVY = "002147";
const GOLD = "C9A84C";
const MUTED = "6B7280";

function headingLevelFor(depth: 1 | 2 | 3) {
  return depth === 1 ? HeadingLevel.HEADING_1 : depth === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
}

function renderBscTable(bsc: CorporateBscView | undefined): (Paragraph | Table)[] {
  if (!bsc) {
    return [
      new Paragraph({
        children: [
          new TextRun({
            text: "No Corporate Balanced Scorecard has been generated yet for this plan.",
            italics: true,
            color: MUTED,
          }),
        ],
      }),
    ];
  }

  const nodes: (Paragraph | Table)[] = [
    new Paragraph({
      children: [new TextRun({ text: `Live from "${bsc.scorecardName}"`, italics: true, size: 18, color: MUTED })],
    }),
  ];

  const headerCells = ["Strategic Objective", "Intended Result", "Key Initiatives", "KPI / Measure", "Baseline", "Target", "Owner"];

  for (const group of bsc.perspectiveGroups) {
    nodes.push(
      new Paragraph({
        spacing: { before: 200 },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: NAVY },
        children: [new TextRun({ text: group.perspective, bold: true, color: "FFFFFF", size: 20 })],
      }),
    );

    const headerRow = new TableRow({
      tableHeader: true,
      children: headerCells.map(
        (label) =>
          new TableCell({
            shading: { type: ShadingType.CLEAR, color: "auto", fill: "EEF1F7" },
            children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 16 })] })],
          }),
      ),
    });

    const dataRows = group.rows.map(
      (row) =>
        new TableRow({
          children: [
            row.strategicObjective,
            row.intendedResult ?? "—",
            row.keyInitiatives ?? "—",
            row.unit ? `${row.kpi} (${row.unit})` : row.kpi,
            row.baseline ?? "—",
            row.target ?? "—",
            row.ownerName ?? "Unassigned",
          ].map((text) => new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 16 })] })] })),
        }),
    );

    nodes.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...dataRows] }));
  }

  return nodes;
}

function sectionToNodes(section: PlanDocumentSection): (Paragraph | Table)[] {
  const nodes: (Paragraph | Table)[] = [
    new Paragraph({
      heading: headingLevelFor(section.depth),
      pageBreakBefore: section.depth === 1,
      children: [new TextRun({ text: `${section.number}. ${section.title}`, bold: true, color: NAVY })],
    }),
  ];

  if (section.isPlaceholder) {
    nodes.push(
      new Paragraph({
        children: [
          new TextRun({ text: "Pending framework specification — awaiting content.", italics: true, color: "B8860B" }),
        ],
      }),
    );
    return nodes;
  }

  if (section.number === "5.4") {
    nodes.push(...renderBscTable(section.bscTable));
    return nodes;
  }

  if (section.isDynamic) {
    nodes.push(
      new Paragraph({ children: [new TextRun({ text: "Not yet available.", italics: true, color: MUTED })] }),
    );
    return nodes;
  }

  if (section.content) {
    for (const paragraph of section.content.split(/\n+/)) {
      const trimmed = paragraph.trim();
      if (trimmed) nodes.push(new Paragraph({ children: [new TextRun(trimmed)] }));
    }
  }

  return nodes;
}

export async function renderPlanDocx(model: PlanDocumentModel): Promise<Buffer> {
  const coverPage: Paragraph[] = [
    new Paragraph({ spacing: { before: 2400 }, children: [] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: model.companyName, bold: true, size: 56, color: NAVY })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200, after: 200 },
      border: { bottom: { color: GOLD, style: BorderStyle.SINGLE, size: 12, space: 8 } },
      children: [new TextRun({ text: "", size: 2 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 300 },
      children: [new TextRun({ text: "Corporate Strategic Plan", size: 32, color: GOLD, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      children: [new TextRun({ text: model.planPeriodLabel, size: 24, color: MUTED })],
    }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const toc: (Paragraph | TableOfContents)[] = [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Table of Contents")] }),
    new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const body = model.sections.flatMap(sectionToNodes);

  const doc = new Document({
    sections: [
      {
        children: [...coverPage, ...toc, ...body],
      },
    ],
  });

  return Packer.toBuffer(doc);
}
