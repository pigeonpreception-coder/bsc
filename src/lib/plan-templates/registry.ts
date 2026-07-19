import { PRIVATE_CORPORATE_SME_TEMPLATE } from "./private-corporate-sme";
import type { PlanTemplate } from "./types";

export type { PlanTemplate, PlanSectionTemplateNode, PlanSectionKind } from "./types";
export { flattenSections } from "./types";

// New client types get a new template file + one line here — never a
// change to the generator or the plan_sections schema.
const TEMPLATES: Record<string, PlanTemplate> = {
  private_corporate_sme: PRIVATE_CORPORATE_SME_TEMPLATE,
};

export function getPlanTemplate(clientType: string): PlanTemplate {
  const template = TEMPLATES[clientType];
  if (!template) {
    throw new Error(
      `No Strategic Plan template implemented yet for client type "${clientType}". Only ${Object.keys(TEMPLATES).join(", ")} ${Object.keys(TEMPLATES).length === 1 ? "is" : "are"} available.`,
    );
  }
  return template;
}
