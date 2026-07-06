"use client";

import { useState, useTransition, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────────

type CustomField = { label: string; value: string };

type PositionNode = {
  tempId: string;
  positionType: "board" | "executive" | "non_executive";
  officeDepartmentName: string;
  jobTitle: string;
  firstName: string;
  surname: string;
  customFields: CustomField[];
  children: PositionNode[];
  /** For executive-level nodes: title options for the dropdown */
  titleOptions?: string[];
};

export type OrgHierarchy = PositionNode;

// ─── Helpers ─────────────────────────────────────────────────

let nextId = 1;
function tempId() {
  return `temp_${nextId++}`;
}

function makeDefaultHierarchy(): PositionNode {
  const boardId = tempId();
  const ceoId = tempId();
  const adminId = tempId();
  const cooId = tempId();
  const salesId = tempId();

  return {
    tempId: boardId,
    positionType: "board",
    officeDepartmentName: "Board of Directors",
    jobTitle: "Board of Directors",
    firstName: "",
    surname: "",
    customFields: [],
    children: [
      {
        tempId: ceoId,
        positionType: "executive",
        officeDepartmentName: "Office of the CEO",
        jobTitle: "",
        firstName: "",
        surname: "",
        customFields: [],
        titleOptions: ["CEO", "Managing Director"],
        children: [
          // Non-executive departments under CEO
          {
            tempId: adminId,
            positionType: "non_executive",
            officeDepartmentName: "Office Administration",
            jobTitle: "",
            firstName: "",
            surname: "",
            customFields: [],
            titleOptions: ["Office Administrator", "Office Manager"],
            children: [],
          },
          // Executive offices under CEO
          {
            tempId: cooId,
            positionType: "executive",
            officeDepartmentName: "Office of the COO",
            jobTitle: "",
            firstName: "",
            surname: "",
            customFields: [],
            titleOptions: ["Chief Operations Officer (COO)", "Executive Manager: Operations"],
            children: [
              {
                tempId: salesId,
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
};

const BADGE_STYLES: Record<string, string> = {
  board: "bg-navy text-white",
  executive: "bg-gold text-navy",
  non_executive: "bg-gray-200 text-gray-700",
};

const BADGE_LABELS: Record<string, string> = {
  board: "Board",
  executive: "Executive",
  non_executive: "Department",
};

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

  // Deep-clone + mutate helper
  const updateHierarchy = useCallback((updater: (root: PositionNode) => void) => {
    setHierarchy((prev) => {
      const copy = JSON.parse(JSON.stringify(prev)) as PositionNode;
      updater(copy);
      return copy;
    });
  }, []);

  // Find a node by tempId in the tree
  function findNode(node: PositionNode, id: string): PositionNode | null {
    if (node.tempId === id) return node;
    for (const child of node.children) {
      const found = findNode(child, id);
      if (found) return found;
    }
    return null;
  }

  // Find parent of a node
  function findParent(root: PositionNode, id: string): PositionNode | null {
    for (const child of root.children) {
      if (child.tempId === id) return root;
      const found = findParent(child, id);
      if (found) return found;
    }
    return null;
  }

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

  const addDepartmentUnder = (parentId: string) => {
    updateHierarchy((root) => {
      const parent = findNode(root, parentId);
      if (parent) {
        parent.children.push({
          tempId: tempId(),
          positionType: "non_executive",
          officeDepartmentName: "",
          jobTitle: "",
          firstName: "",
          surname: "",
          customFields: [],
          children: [],
        });
      }
    });
  };

  const addExecutiveUnder = (parentId: string) => {
    updateHierarchy((root) => {
      const parent = findNode(root, parentId);
      if (parent) {
        parent.children.push({
          tempId: tempId(),
          positionType: "executive",
          officeDepartmentName: "",
          jobTitle: "",
          firstName: "",
          surname: "",
          customFields: [],
          children: [],
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
      if (!node.officeDepartmentName.trim()) errors.push("Office/Department Name is required for every position.");
      if (!node.jobTitle.trim()) errors.push(`Job Title is required for "${node.officeDepartmentName || "unnamed position"}".`);
      if (!node.surname.trim()) errors.push(`Surname is required for "${node.officeDepartmentName || "unnamed position"}".`);
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
      setError(errs[0]);
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
    const name =
      node.positionType === "board"
        ? "Board of Directors"
        : `${node.officeDepartmentName}`;
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

  // ─── Render: Position Card ─────────────────────────────────

  function renderPositionCard(node: PositionNode, depth: number = 0): React.ReactNode {
    if (node.positionType === "board") {
      return (
        <div key={node.tempId} className="space-y-4">
          {/* Board header */}
          <div className={`rounded-lg border-2 p-4 ${CARD_STYLES.board}`}>
            <div className="flex items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${BADGE_STYLES.board}`}>BOARD</span>
              <h3 className="text-base font-semibold text-navy">Board of Directors</h3>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Top-level governance body. Individual BSC generation is not required at this level.
            </p>
          </div>
          {/* CEO (first child) */}
          {node.children.map((child) => renderPositionCard(child, depth + 1))}
        </div>
      );
    }

    const isExecutive = node.positionType === "executive";
    const ceoNode = hierarchy.children[0]; // CEO is always first child of board
    const isCEO = node.tempId === ceoNode?.tempId;

    // Split children into non-executive depts and executive offices
    const departments = node.children.filter((c) => c.positionType === "non_executive");
    const executives = node.children.filter((c) => c.positionType === "executive");

    return (
      <div key={node.tempId} className="space-y-3" style={{ marginLeft: depth > 1 ? 24 : 0 }}>
        {/* Connector line */}
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

              {/* Custom fields */}
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
            </div>

            {/* Sub-sections for this position */}
            {(isExecutive || isCEO) && (
              <div className="mt-3 space-y-3">
                {/* Non-executive departments */}
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
                  onClick={() => addDepartmentUnder(node.tempId)}
                  className="rounded border border-dashed border-gray-300 px-3 py-2 text-xs font-medium text-gray-500 hover:border-navy hover:text-navy"
                >
                  + Add Department under {node.officeDepartmentName || "this office"}
                </button>

                {/* Sub-executive offices (only under CEO) */}
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
                      onClick={() => addExecutiveUnder(node.tempId)}
                      className="rounded border border-dashed border-gold px-3 py-2 text-xs font-medium text-gold hover:bg-gold/10"
                    >
                      + Add Another Executive Office reporting to {node.officeDepartmentName || "CEO/MD"}
                    </button>
                  </>
                )}
              </div>
            )}
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
