import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// Section 2.4.1 ("Organisational Structure") must render live from the
// tenant's org_positions hierarchy, not static AI text — mirrors the
// pattern corporate-bsc-view.ts uses for Section 5.4.

export type OrgStructureNode = {
  id: string;
  label: string;
  jobTitle: string;
  personName: string | null;
  positionType: string;
  children: OrgStructureNode[];
};

const POSITION_TYPE_LABELS: Record<string, string> = {
  board: "Board",
  executive: "Executive",
  non_executive: "Department",
  section_supervisor: "Section",
  individual_staff: "Staff",
};

/** Null if the tenant hasn't set up an organisational hierarchy yet. */
export async function getOrgStructureView(tenantId: string): Promise<OrgStructureNode | null> {
  const supabase = createAdminClient();

  const { data: positions } = await supabase
    .from("org_positions")
    .select("id, position_type, office_department_name, section_name, job_title, first_name, surname, reports_to_id")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (!positions || positions.length === 0) return null;

  const nodeById = new Map<string, OrgStructureNode>();
  for (const p of positions) {
    const label =
      p.position_type === "board"
        ? "Board of Directors"
        : p.position_type === "section_supervisor"
          ? p.section_name || p.office_department_name || "Section"
          : p.office_department_name || "—";
    const personName = [p.first_name, p.surname].filter(Boolean).join(" ") || null;

    nodeById.set(p.id, {
      id: p.id,
      label,
      jobTitle: p.job_title ?? "",
      personName,
      positionType: POSITION_TYPE_LABELS[p.position_type] ?? p.position_type,
      children: [],
    });
  }

  let root: OrgStructureNode | null = null;
  for (const p of positions) {
    const node = nodeById.get(p.id)!;
    if (p.reports_to_id) {
      nodeById.get(p.reports_to_id)?.children.push(node);
    } else {
      root = node;
    }
  }

  return root;
}
