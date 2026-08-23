"use client";

import { useState, useTransition } from "react";
import { EditableTextCell, EditableSelectCell, EditableCheckboxCell, StatusBadge, ApprovalBadge } from "./EditableCell";
import { updateScorecardRow, addScorecardRow, deleteScorecardRow, type EditableField } from "./row-actions";
import {
  addScorecardColumn,
  deleteScorecardColumn,
  renameScorecardColumn,
  updateCellValue,
} from "./column-actions";
import {
  computeAutoStatus,
  PERSPECTIVES,
  FIXED_COLUMN_ORDER,
  FIXED_COLUMN_LABELS,
  FIXED_COLUMN_SEQUENCE,
  OBJECTIVE_SHARED_COLUMNS,
  type FixedColumnKey,
} from "@/lib/scorecard";

export type ScorecardRow = {
  id: string;
  perspective: string;
  strategic_objective: string;
  strategic_theme_alignment: string | null;
  intended_result: string | null;
  key_initiatives: string | null;
  perspective_weight: number | null;
  objective_weight: number | null;
  kpi: string;
  unit: string | null;
  baseline: string | null;
  target: string | null;
  measurement_frequency: string | null;
  actual: string | null;
  responsible_person: string | null;
  lower_is_better: boolean | null;
  status: string;
  approval_status: string;
  rejection_reason: string | null;
};

export type CustomColumn = {
  id: string;
  column_key: string;
  column_label: string;
  column_order: number;
};

type ColumnDescriptor =
  | { type: "fixed"; key: FixedColumnKey; order: number; label: string }
  | { type: "custom"; column: CustomColumn; order: number; label: string };

function EditableColumnHeader({
  column,
  onRename,
  onDelete,
}: {
  column: CustomColumn;
  onRename: (id: string, label: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(column.column_label);

  if (editing) {
    return (
      <input
        autoFocus
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (label.trim() && label !== column.column_label) onRename(column.id, label.trim());
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            setEditing(false);
            if (label.trim() && label !== column.column_label) onRename(column.id, label.trim());
          }
          if (e.key === "Escape") {
            setLabel(column.column_label);
            setEditing(false);
          }
        }}
        className="w-full min-w-[80px] rounded border border-gold bg-white px-1 py-0.5 text-xs font-normal text-gray-900 focus:outline-none"
      />
    );
  }

  return (
    <div className="group flex items-center gap-1">
      <span className="cursor-pointer" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
        {column.column_label}
      </span>
      <button
        type="button"
        onClick={() => {
          if (confirm(`Delete column "${column.column_label}"? All data in this column will be lost.`)) {
            onDelete(column.id);
          }
        }}
        className="ml-1 hidden text-red-400 hover:text-red-600 group-hover:inline"
        title="Delete column"
      >
        ✕
      </button>
    </div>
  );
}

function renderFixedCell(
  key: FixedColumnKey,
  row: ScorecardRow,
  isNewObjective: boolean,
  liveStatus: string,
  ctx: {
    canEditAll: boolean;
    canEditActual: boolean;
    teamOptions: { value: string; label: string }[];
    save: (rowId: string, field: EditableField, value: string) => Promise<void>;
  },
) {
  const { canEditAll, canEditActual, teamOptions, save } = ctx;

  if (OBJECTIVE_SHARED_COLUMNS.has(key) && !isNewObjective) {
    return key === "perspective" ? <span className="text-gray-300">↳</span> : null;
  }

  switch (key) {
    case "perspective":
      return (
        <EditableSelectCell
          value={row.perspective}
          editable={canEditAll}
          onSave={(v) => save(row.id, "perspective", v)}
          options={[...new Set(PERSPECTIVES)].map((p) => ({ value: p, label: p }))}
        />
      );
    case "strategic_objective":
      return <EditableTextCell value={row.strategic_objective} editable={canEditAll} onSave={(v) => save(row.id, "strategic_objective", v)} />;
    case "strategic_theme_alignment":
      return <EditableTextCell value={row.strategic_theme_alignment} editable={canEditAll} onSave={(v) => save(row.id, "strategic_theme_alignment", v)} />;
    case "intended_result":
      return <EditableTextCell value={row.intended_result} editable={canEditAll} onSave={(v) => save(row.id, "intended_result", v)} />;
    case "key_initiatives":
      return <EditableTextCell value={row.key_initiatives} editable={canEditAll} onSave={(v) => save(row.id, "key_initiatives", v)} />;
    case "perspective_weight":
      return <EditableTextCell value={row.perspective_weight} editable={canEditAll} onSave={(v) => save(row.id, "perspective_weight", v)} type="number" min={0} max={100} />;
    case "objective_weight":
      return <EditableTextCell value={row.objective_weight} editable={canEditAll} onSave={(v) => save(row.id, "objective_weight", v)} type="number" min={0} max={100} />;
    case "kpi":
      return <EditableTextCell value={row.kpi} editable={canEditAll} onSave={(v) => save(row.id, "kpi", v)} />;
    case "unit":
      return <EditableTextCell value={row.unit} editable={canEditAll} onSave={(v) => save(row.id, "unit", v)} />;
    case "lower_is_better":
      return (
        <EditableCheckboxCell
          checked={row.lower_is_better ?? false}
          editable={canEditAll}
          onSave={(v) => save(row.id, "lower_is_better", v)}
          title="Check if a lower Actual value means better performance (e.g. cost, errors, turnaround time)"
        />
      );
    case "baseline":
      return <EditableTextCell value={row.baseline} editable={canEditAll} onSave={(v) => save(row.id, "baseline", v)} />;
    case "target":
      return <EditableTextCell value={row.target} editable={canEditAll} onSave={(v) => save(row.id, "target", v)} />;
    case "measurement_frequency":
      return <EditableTextCell value={row.measurement_frequency} editable={canEditAll} onSave={(v) => save(row.id, "measurement_frequency", v)} />;
    case "actual":
      return (
        <div>
          <EditableTextCell value={row.actual} editable={canEditActual} onSave={(v) => save(row.id, "actual", v)} />
          <ApprovalBadge status={row.approval_status} rejectionReason={row.rejection_reason} />
        </div>
      );
    case "responsible_person":
      return <EditableSelectCell value={row.responsible_person} editable={canEditAll} onSave={(v) => save(row.id, "responsible_person", v)} options={teamOptions} />;
    case "status":
      return <StatusBadge status={liveStatus} />;
    default:
      return null;
  }
}

const PLACEHOLDER_OBJECTIVE = /^New objective( \d+)?$/;

export default function ScorecardTable({
  scorecardId,
  rows,
  canEditAll,
  currentUserId,
  canUpdateActual,
  teamOptions,
  customColumns = [],
  cellValues = {},
}: {
  scorecardId: string;
  rows: ScorecardRow[];
  canEditAll: boolean;
  currentUserId: string;
  canUpdateActual: boolean;
  teamOptions: { value: string; label: string }[];
  customColumns?: CustomColumn[];
  cellValues?: Record<string, Record<string, string>>;
}) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);
  const [insertBeforeOrder, setInsertBeforeOrder] = useState<string>("end");

  const runAction = (action: () => Promise<void>) => {
    setActionError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  const save = (rowId: string, field: EditableField, value: string) => updateScorecardRow(rowId, field, value);

  // Objective grouping: first row of each objective shows the shared columns (1-7);
  // continuation rows blank them out so a multi-KPI objective reads as one block.
  const objectiveKeyOf = (row: ScorecardRow) => `${row.perspective}|${row.strategic_objective}`;

  const mergedColumns: ColumnDescriptor[] = [
    ...FIXED_COLUMN_SEQUENCE.map((key) => ({
      type: "fixed" as const,
      key,
      order: FIXED_COLUMN_ORDER[key],
      label: FIXED_COLUMN_LABELS[key],
    })),
    ...customColumns.map((column) => ({
      type: "custom" as const,
      column,
      order: column.column_order,
      label: column.column_label,
    })),
  ].sort((a, b) => a.order - b.order);

  const hasUnfinishedRow = rows.some((r) => PLACEHOLDER_OBJECTIVE.test(r.strategic_objective) || r.kpi === "New KPI");
  const hasUnfinishedColumn = customColumns.some((c) => c.column_label === "New Column");

  return (
    <div className="space-y-3">
      {actionError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[2100px] text-xs">
          <thead className="bg-gray-50 text-left uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              {mergedColumns.map((col) =>
                col.type === "fixed" ? (
                  <th key={col.key} className="px-3 py-2">
                    {col.label}
                  </th>
                ) : (
                  <th key={col.column.id} className="px-3 py-2">
                    {canEditAll ? (
                      <EditableColumnHeader
                        column={col.column}
                        onRename={(id, l) => runAction(() => renameScorecardColumn(id, l))}
                        onDelete={(id) => runAction(() => deleteScorecardColumn(id))}
                      />
                    ) : (
                      col.label
                    )}
                  </th>
                ),
              )}
              {canEditAll && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => {
              const canEditActual = canEditAll || (canUpdateActual && row.responsible_person === currentUserId);
              const isNewObjective = i === 0 || objectiveKeyOf(row) !== objectiveKeyOf(rows[i - 1]);
              const liveStatus = computeAutoStatus(row.actual, row.target, row.lower_is_better ?? false);

              return (
                <tr key={row.id} className={isNewObjective ? "border-t-2 border-gray-200" : ""}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  {mergedColumns.map((col) =>
                    col.type === "fixed" ? (
                      <td key={col.key} className="px-3 py-2">
                        {renderFixedCell(col.key, row, isNewObjective, liveStatus, {
                          canEditAll,
                          canEditActual,
                          teamOptions,
                          save,
                        })}
                      </td>
                    ) : (
                      <td key={col.column.id} className="px-3 py-2">
                        <EditableTextCell
                          value={cellValues[row.id]?.[col.column.id] ?? null}
                          editable={canEditAll}
                          onSave={(v) => updateCellValue(scorecardId, row.id, col.column.id, v)}
                        />
                      </td>
                    ),
                  )}
                  {canEditAll && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Delete this row?")) runAction(() => deleteScorecardRow(row.id));
                        }}
                        className="text-red-600 hover:text-red-800"
                        title="Delete row"
                      >
                        ✕
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEditAll && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col">
            <button
              type="button"
              disabled={isPending || hasUnfinishedRow}
              onClick={() => runAction(() => addScorecardRow(scorecardId))}
              className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Add Row
            </button>
            {hasUnfinishedRow && (
              <span className="mt-1 text-xs text-gray-400">Fill out the new row above before adding another.</span>
            )}
          </div>

          <div className="flex flex-col">
            <div className="flex items-center gap-2 rounded-md border border-navy px-3 py-1.5">
              <span className="text-sm font-semibold text-navy">+ Add Column</span>
              <select
                value={insertBeforeOrder}
                onChange={(e) => setInsertBeforeOrder(e.target.value)}
                disabled={hasUnfinishedColumn}
                className="rounded border border-gray-300 px-1.5 py-1 text-xs focus:border-gold focus:outline-none disabled:opacity-50"
              >
                <option value="end">at the end</option>
                {mergedColumns.map((col) => (
                  <option key={col.type === "fixed" ? col.key : col.column.id} value={String(col.order)}>
                    before &quot;{col.label}&quot;
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={isPending || hasUnfinishedColumn}
                onClick={() =>
                  runAction(() =>
                    addScorecardColumn(scorecardId, insertBeforeOrder === "end" ? undefined : Number(insertBeforeOrder)),
                  )
                }
                className="rounded bg-navy px-2 py-1 text-xs font-semibold text-white hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {hasUnfinishedColumn && (
              <span className="mt-1 text-xs text-gray-400">Rename the new column above before adding another.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
