"use client";

import { useState, useTransition, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────

type CustomField = { label: string; value: string };

type PositionType = "board" | "executive" | "non_executive" | "section_supervisor" | "individual_staff";

type PositionNode = {
  tempId: string;
  positionType: PositionType;
  officeDepartmentName: string;
  sectionName?: string;
  jobTitle: string;
  firstName: string;
  surname: string;
  customFields: CustomField[];
  children: PositionNode[];
  /** For positions with fixed title options */
  titleOptions?: string[];
};

export type OrgHierarchy = PositionNode;

// ─── Helpers ─────────────────────────────────────────────────

let nextId = 1;
function tempId() {
  return `temp_${nextId++}`;
}

function makeDefaultHierarchy(): PositionNode {
  return {
    tempId: tempId(),
    positionType: "board",
    officeDepartmentName: "Board of Directors",
    jobTitle: "Board of Directors",
    firstName: "",
    surname: "",
    customFields: [],
    children: [
      {
        tempId: tempId(),
        positionType: "executive",
        officeDepartmentName: "Office of the CEO",
        jobTitle: "",
        firstName: "",
        surname: "",
        customFields: [],
        titleOptions: ["CEO", "Managing Director"],
        children: [
          {
            tempId: tempId(),
            positionType: "non_executive",
            officeDepartmentName: "Office Administration",
            jobTitle: "",
            firstName: "",
            surname: "",
            customFields: [],
            titleOptions: ["Office Administrator", "Office Manager"],
            children: [],
          },
          {
            tempId: tempId(),
            positionType: "executive",
            officeDepartmentName: "Office of the COO",
            jobTitle: "",
            firstName: "",
            surname: "",
            customFields: [],
            titleOptions: ["Chief Operations Officer (COO)", "Executive Manager: Operations"],
            children: [
              {
                tempId: tempId(),
                positionType: "non_executive",
                officeDepartmentName: "Sales Department",
                jobTitle: "",
                firstName: "",
                surname: "",
                customFields: [],
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

// ─── Styles ──────────────────────────────────────────────────

const CARD_STYLES: Record<string, string> = {
  board: "border-navy bg-navy/5",
  executive: "border-gold bg-gold/5",
  non_executive: "border-gray-300 bg-white",
  section_supervisor: "border-blue-300 bg-blue-50",
  individual_staff: "border-green-300 bg-green-50",
};

const BADGE_STYLES: Record<string, string> = {
  board: "bg-navy text-white",
  executive: "bg-gold text-navy",
  non_executive: "bg-gray-200 text-gray-700",
  section_supervisor: "bg-blue-200 text-blue-800",
  individual_staff: "bg-green-200 text-green-800",
};

const BADGE_LABELS: Record<string, string> = {
  board: "Board",
  executive: "Executive",
  non_executive: "Department",
  section_supervisor: "Section",
  individual_staff: "Staff",
};

// ─── Ancestry helpers ────────────────────────────────────────

function findNode(node: PositionNode, id: string): PositionNode | null {
  if (node.tempId === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(root: PositionNode, id: string): PositionNode | null {
  for (const child of root.children) {
    if (child.tempId === id) return root;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** Walk up the tree to find an ancestor of a given type */
function findAncestor(root: PositionNode, nodeId: string, type: PositionType): PositionNode | null {
  const parent = findParent(root, nodeId);
  if (!parent) return null;
  if (parent.positionType === type) return parent;
  return findAncestor(root, parent.tempId, type);
}

// ─── Component ───────────────────────────────────────────────

export default function OrgWizard({
  saveAction,
  generateAction,
  existingPositions,
}: {
  saveAction: (hierarchy: string) => Promise<void>;
  generateAction: () => Promise<void>;
  existingPositions?: OrgHierarchy | null;
}) {
  const [hierarchy, setHierarchy] = useState<PositionNode>(
    existingPositions ?? makeDefaultHierarchy
  );
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const updateHierarchy = useCallback((updater: (root: PositionNode) => void) => {
    setHierarchy((prev) => {
      const copy = JSON.parse(JSON.stringify(prev)) as PositionNode;
      updater(copy);
      return copy;
    });
  }, []);

  const updateField = (id: string, field: keyof PositionNode, value: string) => {
    updateHierarchy((root) => {
      const node = findNode(root, id);
      if (node) (node as Record<string, unknown>)[field] = value;
    });
  };

  const addCustomField = (id: string) => {
    updateHierarchy((root) => {
      const node = findNode(root, id);
      if (node) node.customFields.push({ label: "", value: "" });
    });
  };

  const updateCustomField = (id: string, index: number, key: "label" | "value", val: string) => {
    updateHierarchy((root) => {
      const node = findNode(root, id);
      if (node) node.customFields[index][key] = val;
    });
  };

  const removeCustomField = (id: string, index: number) => {
    updateHierarchy((root) => {
      const node = findNode(root, id);
      if (node) node.customFields.splice(index, 1);
    });
  };

  const addChildNode = (parentId: string, positionType: PositionType, defaults?: Partial<PositionNode>) => {
    updateHierarchy((root) => {
      const parent = findNode(root, parentId);
      if (parent) {
        parent.children.push({
          tempId: tempId(),
          positionType,
          officeDepartmentName: "",
          jobTitle: "",
          firstName: "",
          surname: "",
          customFields: [],
          children: [],
          ...defaults,
        });
      }
    });
  };

  const removeNode = (id: string) => {
    updateHierarchy((root) => {
      const parent = findParent(root, id);
      if (parent) {
        parent.children = parent.children.filter((c) => c.tempId !== id);
      }
    });
  };

  // ─── Validation ────────────────────────────────────────────

  function validateTree(node: PositionNode): string[] {
    const errors: string[] = [];
    if (node.positionType !== "board") {
      const nameField = node.positionType === "section_supervisor" ? node.sectionName : node.officeDepartmentName;
      const nameLabel = node.positionType === "section_supervisor" ? "Section Name" :
        node.positionType === "individual_staff" ? "Name" : "Office/Department Name";
      if (node.positionType !== "individual_staff" && !(nameField ?? "").trim()) {
        errors.push(`${nameLabel} is required for every position.`);
      }
      if (!node.jobTitle.trim()) errors.push(`Job Title is required for "${nameField || node.officeDepartmentName || "unnamed position"}".`);
      if (!node.surname.trim()) errors.push(`Surname is required for "${nameField || node.officeDepartmentName || "unnamed position"}".`);
    }
    for (const child of node.children) {
      errors.push(...validateTree(child));
    }
    return errors;
  }

  // ─── Handlers ──────────────────────────────────────────────

  const handleReview = () => {
    const errs = validateTree(hierarchy);
    if (errs.length > 0) {
      setError(errs.length === 1 ? errs[0] : errs.map((e, i) => `${i + 1}. ${e}`).join(" "));
      return;
    }
    setError(null);
    setStep("review");
  };

  const handleSaveAndGenerate = () => {
    setError(null);
    startTransition(async () => {
      try {
        await saveAction(JSON.stringify(hierarchy));
        await generateAction();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    });
  };

  // ─── Render: Tree Summary ──────────────────────────────────

  function renderTreeSummary(node: PositionNode, indent: number = 0): React.ReactNode {
    let name: string;
    if (node.positionType === "board") name = "Board of Directors";
    else if (node.positionType === "section_supervisor") name = node.sectionName || "Unnamed Section";
    else if (node.positionType === "individual_staff") name = "Staff";
    else name = node.officeDepartmentName;

    const person =
      node.firstName || node.surname
        ? ` — ${node.firstName} ${node.surname} (${node.jobTitle})`
        : "";

    return (
      <div key={node.tempId} style={{ marginLeft: indent * 24 }}>
        <div className="flex items-center gap-2 py-1">
          {indent > 0 && <span className="text-gray-400">└──</span>}
          <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BADGE_STYLES[node.positionType]}`}>
            {BADGE_LABELS[node.positionType]}
          </span>
          <span className="text-sm font-medium text-navy">{name}</span>
          <span className="text-sm text-gray-500">{person}</span>
        </div>
        {node.children.map((child) => renderTreeSummary(child, indent + 1))}
      </div>
    );
  }

  // ─── Render: Custom Fields Block ───────────────────────────

  function renderCustomFields(node: PositionNode) {
    return (
      <>
        {node.customFields.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-xs font-medium text-gray-500">Custom Fields</p>
            {node.customFields.map((cf, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={cf.label}
                  onChange={(e) => updateCustomField(node.tempId, i, "label", e.target.value)}
                  placeholder="Field label"
                  className="w-40 rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gold focus:outline-none"
                />
                <input
                  type="text"
                  value={cf.value}
                  onChange={(e) => updateCustomField(node.tempId, i, "value", e.target.value)}
                  placeholder="Value"
                  className="flex-1 rounded border border-gray-200 px-2 py-1.5 text-xs focus:border-gold focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeCustomField(node.tempId, i)}
                  className="text-xs text-red-400 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => addCustomField(node.tempId)}
          className="mt-2 text-xs text-gold hover:text-gold-light"
        >
          + Add Custom Field
        </button>
      </>
    );
  }

  // ─── Render: Individual Staff Card ─────────────────────────

  function renderStaffCard(node: PositionNode, depth: number): React.ReactNode {
    // Find ancestors for read-only fields
    const sectionParent = findParent(hierarchy, node.tempId);
    const deptAncestor = findAncestor(hierarchy, node.tempId, "non_executive");
    const execAncestor = findAncestor(hierarchy, node.tempId, "executive");

    return (
      <div key={node.tempId} className="space-y-2" style={{ marginLeft: depth > 1 ? 24 : 0 }}>
        <div className="ml-4 border-l-2 border-green-200 pl-4">
          <div className={`rounded-lg border-2 p-4 ${CARD_STYLES.individual_staff}`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${BADGE_STYLES.individual_staff}`}>Staff</span>
                <h3 className="text-sm font-semibold text-navy">
                  {node.firstName || node.surname
                    ? `${node.firstName} ${node.surname}`
                    : "New Staff Member"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Remove this staff member?")) removeNode(node.tempId);
                }}
                className="text-xs text-red-500 hover:text-red-700"
              >
                ✕ Remove
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Surname</label>
                <input
                  type="text"
                  value={node.surname}
                  onChange={(e) => updateField(node.tempId, "surname", e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">First Name</label>
                <input
                  type="text"
                  value={node.firstName}
                  onChange={(e) => updateField(node.tempId, "firstName", e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Job Title</label>
                <input
                  type="text"
                  value={node.jobTitle}
                  onChange={(e) => updateField(node.tempId, "jobTitle", e.target.value)}
                  placeholder="e.g. Pricing Staff"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Section Name</label>
                <input
                  type="text"
                  readOnly
                  value={sectionParent?.sectionName || sectionParent?.officeDepartmentName || "—"}
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Sectional Supervisor</label>
                <input
                  type="text"
                  readOnly
                  value={
                    sectionParent?.firstName || sectionParent?.surname
                      ? `${sectionParent.firstName} ${sectionParent.surname}`
                      : "—"
                  }
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Department</label>
                <input
                  type="text"
                  readOnly
                  value={deptAncestor?.officeDepartmentName || "—"}
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">Executive Office</label>
                <input
                  type="text"
                  readOnly
                  value={execAncestor?.officeDepartmentName || "—"}
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>
            </div>

            {renderCustomFields(node)}
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Section Card ──────────────────────────────────

  function renderSectionCard(node: PositionNode, depth: number): React.ReactNode {
    const deptParent = findParent(hierarchy, node.tempId);
    const staffMembers = node.children.filter((c) => c.positionType === "individual_staff");

    return (
      <div key={node.tempId} className="space-y-2" style={{ marginLeft: depth > 1 ? 24 : 0 }}>
        <div className="ml-4 border-l-2 border-blue-200 pl-4">
          <div className={`rounded-lg border-2 p-4 ${CARD_STYLES.section_supervisor}`}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${BADGE_STYLES.section_supervisor}`}>Section</span>
                <h3 className="text-sm font-semibold text-navy">
                  {node.sectionName || "New Section"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Remove "${node.sectionName || "this section"}" and all staff members under it?`)) {
                    removeNode(node.tempId);
                  }
                }}
                className="text-xs text-red-500 hover:text-red-700"
              >
                ✕ Remove
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Section Name</label>
                <input
                  type="text"
                  value={node.sectionName || ""}
                  onChange={(e) => updateField(node.tempId, "sectionName", e.target.value)}
                  placeholder="e.g. Product Pricing"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Department Name</label>
                <input
                  type="text"
                  readOnly
                  value={deptParent?.officeDepartmentName || "—"}
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-gray-600">Management Level</label>
                <input
                  type="text"
                  readOnly
                  value="Middle Management / Supervisory"
                  className="w-full rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Job Title</label>
                <input
                  type="text"
                  value={node.jobTitle}
                  onChange={(e) => updateField(node.tempId, "jobTitle", e.target.value)}
                  placeholder="Sectional Supervisor"
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div />
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Surname</label>
                <input
                  type="text"
                  value={node.surname}
                  onChange={(e) => updateField(node.tempId, "surname", e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">First Name</label>
                <input
                  type="text"
                  value={node.firstName}
                  onChange={(e) => updateField(node.tempId, "firstName", e.target.value)}
                  className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                />
              </div>
            </div>

            {renderCustomFields(node)}
          </div>

          {/* Staff members under this section */}
          {staffMembers.length > 0 && (
            <div className="mt-2 space-y-2">
              <p className="ml-4 text-xs font-semibold uppercase text-gray-400">
                Staff under {node.sectionName || "this section"}
              </p>
              {staffMembers.map((staff) => renderStaffCard(staff, depth + 1))}
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              addChildNode(node.tempId, "individual_staff", {
                jobTitle: "Staff Member",
                officeDepartmentName: node.sectionName || "",
              })
            }
            className="mt-2 ml-4 rounded border border-dashed border-green-300 px-3 py-2 text-xs font-medium text-green-600 hover:border-green-500 hover:bg-green-50"
          >
            + Add Staff Member under {node.sectionName || "this section"}
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Position Card (Board, Executive, Department) ──

  function renderPositionCard(node: PositionNode, depth: number = 0): React.ReactNode {
    if (node.positionType === "board") {
      return (
        <div key={node.tempId} className="space-y-4">
          <div className={`rounded-lg border-2 p-4 ${CARD_STYLES.board}`}>
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${BADGE_STYLES.board}`}>BOARD</span>
              <h3 className="text-base font-semibold text-navy">Board of Directors</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Top-level governance body. Individual BSC generation is not required at this level.
            </p>
          </div>
          {node.children.map((child) => renderPositionCard(child, depth + 1))}
        </div>
      );
    }

    // Section and staff cards have their own renderers
    if (node.positionType === "section_supervisor") {
      return renderSectionCard(node, depth);
    }
    if (node.positionType === "individual_staff") {
      return renderStaffCard(node, depth);
    }

    const isExecutive = node.positionType === "executive";
    const ceoNode = hierarchy.children[0];
    const isCEO = node.tempId === ceoNode?.tempId;
    const isDepartment = node.positionType === "non_executive";

    // Split children
    const departments = node.children.filter((c) => c.positionType === "non_executive");
    const executives = node.children.filter((c) => c.positionType === "executive");
    const sections = node.children.filter((c) => c.positionType === "section_supervisor");

    return (
      <div key={node.tempId} className="space-y-3" style={{ marginLeft: depth > 1 ? 24 : 0 }}>
        {depth > 0 && (
          <div className="ml-4 border-l-2 border-gray-200 pl-4">
            <div className={`rounded-lg border-2 p-4 ${CARD_STYLES[node.positionType]}`}>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${BADGE_STYLES[node.positionType]}`}>
                    {BADGE_LABELS[node.positionType]}
                  </span>
                  <h3 className="text-sm font-semibold text-navy">
                    {node.officeDepartmentName || (isExecutive ? "New Executive Office" : "New Department")}
                  </h3>
                </div>
                {!isCEO && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Remove "${node.officeDepartmentName || "this position"}" and all its sub-positions?`)) {
                        removeNode(node.tempId);
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    ✕ Remove
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Office / Department Name
                  </label>
                  <input
                    type="text"
                    value={node.officeDepartmentName}
                    onChange={(e) => updateField(node.tempId, "officeDepartmentName", e.target.value)}
                    placeholder={isExecutive ? "e.g. Office of the CFO" : "e.g. Marketing Department"}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Job Title</label>
                  {node.titleOptions && node.titleOptions.length > 0 ? (
                    <select
                      value={node.jobTitle}
                      onChange={(e) => updateField(node.tempId, "jobTitle", e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                    >
                      <option value="">— Select title —</option>
                      {node.titleOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={node.jobTitle}
                      onChange={(e) => updateField(node.tempId, "jobTitle", e.target.value)}
                      placeholder="e.g. Head of Marketing"
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                    />
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Surname</label>
                  <input
                    type="text"
                    value={node.surname}
                    onChange={(e) => updateField(node.tempId, "surname", e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">First Name</label>
                  <input
                    type="text"
                    value={node.firstName}
                    onChange={(e) => updateField(node.tempId, "firstName", e.target.value)}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none"
                  />
                </div>
              </div>

              {renderCustomFields(node)}
            </div>

            {/* Sub-sections for executives and departments */}
            <div className="mt-3 space-y-3">
              {/* Departments under executive */}
              {(isExecutive || isCEO) && (
                <>
                  {departments.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-gray-400">
                        Departments under {node.officeDepartmentName || "this office"}
                      </p>
                      {departments.map((dept) => renderPositionCard(dept, depth + 1))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => addChildNode(node.tempId, "non_executive")}
                    className="rounded border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-navy hover:text-navy"
                  >
                    + Add Department under {node.officeDepartmentName || "this office"}
                  </button>

                  {isCEO && (
                    <>
                      {executives.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold uppercase text-gray-400">
                            Executive Offices reporting to {node.officeDepartmentName || "CEO/MD"}
                          </p>
                          {executives.map((exec) => renderPositionCard(exec, depth + 1))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => addChildNode(node.tempId, "executive")}
                        className="rounded border border-dashed border-gold px-3 py-2 text-xs font-medium text-gold hover:bg-gold/10"
                      >
                        + Add Another Executive Office reporting to {node.officeDepartmentName || "CEO/MD"}
                      </button>
                    </>
                  )}
                </>
              )}

              {/* Sections under department */}
              {isDepartment && (
                <>
                  {sections.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase text-gray-400">
                        Sections under {node.officeDepartmentName || "this department"}
                      </p>
                      {sections.map((sec) => renderSectionCard(sec, depth + 1))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      addChildNode(node.tempId, "section_supervisor", {
                        sectionName: "",
                        jobTitle: "Sectional Supervisor",
                      })
                    }
                    className="rounded border border-dashed border-blue-300 px-3 py-2 text-xs font-medium text-blue-600 hover:border-blue-500 hover:bg-blue-50"
                  >
                    + Add Section under {node.officeDepartmentName || "this department"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Main Render ───────────────────────────────────────────

  if (step === "review") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-navy">Review Organisational Hierarchy</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review your organisation structure below. Once confirmed, AI will generate cascaded Balanced Scorecards for each level.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          {renderTreeSummary(hierarchy)}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setStep("edit")}
            disabled={isPending}
            className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
          >
            ← Edit Hierarchy
          </button>
          <button
            type="button"
            onClick={handleSaveAndGenerate}
            disabled={isPending}
            className="rounded-md bg-navy px-6 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
          >
            {isPending ? "Saving & Generating Scorecards… this may take a few minutes" : "Confirm & Generate Scorecards"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Organisational Structure Setup</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define your company hierarchy below. The AI will use this structure to generate cascaded, aligned Balanced Scorecards for every level.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-4">{renderPositionCard(hierarchy)}</div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleReview}
          className="rounded-md bg-navy px-6 py-2 text-sm font-semibold text-white hover:bg-navy-light"
        >
          Review Hierarchy →
        </button>
      </div>
    </div>
  );
}
