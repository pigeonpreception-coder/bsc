// A plan template describes the shape of a Strategic Plan document for one
// tenants.client_type. It is data, not code — new client types get a new
// template file registered in registry.ts, never a change to the generator.

export type PlanSectionKind =
  | "ai_generated" // AI authors prose for this section
  | "placeholder" // pending a spec (e.g. a framework diagram) — AI must not generate content
  | "dynamic_org_structure" // rendered live from org_positions at view/export time
  | "dynamic_bsc"; // rendered live from scorecards/scorecard_rows at view/export time

export type PlanSectionTemplateNode = {
  number: string; // e.g. "2.3.3"
  title: string;
  depth: 1 | 2 | 3;
  kind: PlanSectionKind;
  isAiAddable: boolean; // AI may append further subsections under this node
  guidance?: string; // topics/frameworks this section should cover — folded into the AI prompt
  children?: PlanSectionTemplateNode[];
};

export type PlanTemplate = {
  clientType: string;
  name: string;
  sections: PlanSectionTemplateNode[];
};

export function flattenSections(nodes: PlanSectionTemplateNode[]): PlanSectionTemplateNode[] {
  return nodes.flatMap((node) => [node, ...(node.children ? flattenSections(node.children) : [])]);
}
