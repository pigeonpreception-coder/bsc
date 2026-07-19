import type { PlanTemplate } from "./types";

// Baseline Strategic Plan structure for Private Corporate & SME clients.
// The AI may add sections/subsections beyond this wherever it improves the
// plan for a specific company — this is the minimum required shape, not a
// fixed schema. plan_sections rows are free to include extra AI-added nodes
// under any node with isAiAddable: true.
export const PRIVATE_CORPORATE_SME_TEMPLATE: PlanTemplate = {
  clientType: "private_corporate_sme",
  name: "Private Corporate & SME",
  sections: [
    {
      number: "1",
      title: "Executive Summary",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      children: [
        {
          number: "1.1",
          title: "Vision",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: false,
          children: [{ number: "1.1.1", title: "Vision Statement", depth: 3, kind: "ai_generated", isAiAddable: false }],
        },
        {
          number: "1.2",
          title: "Mission",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: false,
          children: [{ number: "1.2.1", title: "Mission Statement", depth: 3, kind: "ai_generated", isAiAddable: false }],
        },
        { number: "1.3", title: "Our Values", depth: 2, kind: "ai_generated", isAiAddable: false },
      ],
    },
    {
      number: "2",
      title: "Who Are We",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true, // "2.5 AI may suggest further relevant subsections"
      children: [
        {
          number: "2.1",
          title: "About Us",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: false,
          children: [{ number: "2.1.1", title: "Company's Background", depth: 3, kind: "ai_generated", isAiAddable: false }],
        },
        { number: "2.2", title: "Business Evolution", depth: 2, kind: "ai_generated", isAiAddable: false },
        {
          number: "2.3",
          title: "More About Our Business",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: false,
          children: [
            { number: "2.3.1", title: "Strategy", depth: 3, kind: "ai_generated", isAiAddable: false },
            { number: "2.3.2", title: "Philosophy", depth: 3, kind: "ai_generated", isAiAddable: false },
            {
              number: "2.3.3",
              title: "Advanced Business Framework",
              depth: 3,
              kind: "placeholder",
              isAiAddable: false,
              guidance: "Pending framework specification from JP. Do not generate content — leave for manual entry (rich text + image upload).",
            },
          ],
        },
        {
          number: "2.4",
          title: "Our Corporate Governance and Leadership",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: false,
          children: [
            {
              number: "2.4.1",
              title: "Organisational Structure",
              depth: 3,
              kind: "dynamic_org_structure",
              isAiAddable: false,
              guidance: "Rendered live from the tenant's org_positions hierarchy — not AI-authored text.",
            },
            { number: "2.4.2", title: "Our ESG Model", depth: 3, kind: "ai_generated", isAiAddable: false },
            {
              number: "2.4.3",
              title: "ESG Alignment",
              depth: 3,
              kind: "ai_generated",
              isAiAddable: false,
              guidance:
                "Environmental (compliance, green operations), Social (community-benefiting policy/initiatives — not charity/donations), Governance (leadership structure, legal/regulatory compliance). Briefly link to relevant UN SDGs.",
            },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "Business Review & Assessment",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      children: [
        {
          number: "3.1",
          title: "Internal Assessment",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: true,
          guidance:
            "Cover: SWOT, Products/Service Portfolio, Customer Analysis, Stakeholder Analysis, Partner Portfolio Analysis, Policy Analysis, Process/Value Chain Analysis. Add further relevant frameworks (e.g. McKinsey 7-S, Porter's Five Forces) where they improve the analysis — structure each as its own numbered subsection.",
        },
        {
          number: "3.2",
          title: "Overall Business Review Outcomes",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: true,
          guidance: "Generate company-specific critical-findings subsections based on the internal assessment above.",
        },
        {
          number: "3.3",
          title: "Moving Forward",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: true,
          guidance: "Cover: Strategic key moves, Agenda for Change, New Strategic Direction — structure each as its own numbered subsection. Add further relevant subsections.",
        },
      ],
    },
    {
      number: "4",
      title: "Market and Industry Overview",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true, // "4.5 AI may add further relevant subsections"
      children: [
        { number: "4.1", title: "PESTEL Analysis", depth: 2, kind: "ai_generated", isAiAddable: false },
        { number: "4.2", title: "Market Analysis", depth: 2, kind: "ai_generated", isAiAddable: false },
        { number: "4.3", title: "Industry Analysis", depth: 2, kind: "ai_generated", isAiAddable: false },
        { number: "4.4", title: "Competition Analysis", depth: 2, kind: "ai_generated", isAiAddable: false },
      ],
    },
    {
      number: "5",
      title: "Strategic Formation",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      children: [
        { number: "5.1", title: "Introduction", depth: 2, kind: "ai_generated", isAiAddable: false, guidance: "Description of the new strategic direction." },
        {
          number: "5.2",
          title: "Strategic Themes",
          depth: 2,
          kind: "ai_generated",
          isAiAddable: false,
          guidance:
            "Hard rule: 3 or 4 themes — choose the right number for this company, don't force a round number. 16-24 Corporate Strategic Objectives are generated first (distributed across the 4 BSC perspectives, at least 3 per perspective), then each objective is aligned to whichever theme(s) it genuinely supports — one objective can support more than one theme.",
        },
        {
          number: "5.3",
          title: "Strategic Mapping",
          depth: 2,
          kind: "placeholder",
          isAiAddable: false,
          guidance: "Pending framework specification from JP. Do not generate content — leave for manual entry (rich text + image upload).",
        },
        {
          number: "5.4",
          title: "Our Corporate Strategic Objectives, Initiatives and Targets",
          depth: 2,
          kind: "dynamic_bsc",
          isAiAddable: false,
          guidance:
            "Rendered live from the tenant's Corporate scorecard (scorecards/scorecard_rows), grouped by perspective — not AI-authored table content. Include a short AI-generated framing paragraph above the table.",
        },
      ],
    },
    {
      number: "6",
      title: "Strategy Implementation Roadmap",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      guidance: "Generate appropriate subsections: phased rollout, timeline, quarterly milestones, governance cadence — based on the plan period and strategic themes.",
    },
    {
      number: "7",
      title: "Risk Management",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      guidance: "Generate appropriate subsections: risk register, risk appetite statement, top strategic risks and mitigations — based on industry, sector, and assessment findings.",
    },
    {
      number: "8",
      title: "Monitoring, Evaluation & Governance Framework",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      guidance:
        "Placeholder title (source document duplicated this as \"Risk Management\", same as Section 7 — confirmed with JP as the correct title). Generate appropriate subsections: review cadence, reporting lines, board oversight mechanism.",
    },
    {
      number: "9",
      title: "Conclusion",
      depth: 1,
      kind: "ai_generated",
      isAiAddable: true,
      guidance: "AI-generated closing synthesis of the full plan.",
    },
  ],
};
