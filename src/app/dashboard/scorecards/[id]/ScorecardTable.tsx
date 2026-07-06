"use client";

import { useState, useTransition } from "react";
import { EditableTextCell, EditableSelectCell, StatusBadge } from "./EditableCell";
import { updateScorecardRow, addScorecardRow, deleteScorecardRow, type EditableField } from "./row-actions";
import {
  addScorecardColumn,
  deleteScorecardColumn,
  renameScorecardColumn,
  updateCellValue,
} from "./column-actions";

const PERSPECTIVES = ["Financial", "Customer", "Internal Process", "Learning & Growth"];
const STATUSES = [
  { value: "on_track", label: "On Track" },
  { value: "at_risk", label: "At Risk" },
  { value: "off_track", label: "Off Track" },
];

export type ScorecardRow = {
  id: string;
  perspective: string;
  strategic_objective: string;
  intended_result: string | null;
  kpi: string;
  baseline: string | null;
  target: string | null;
  actual: string | null;
  unit: string | null;
  weight: number | null;
  initiative: string | null;
  responsible_person: string | null;
  timeline: string | null;
  status: string;
  notes: string | null;
};

export type CustomColumn = {
  id: string;
  column_key: string;
  column_label: string;
  column_order: number;
};

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
      <div className="flex items-center gap-1">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (label.trim() && label !== column.column_label) {
              onRename(column.id, label.trim());
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setEditing(false);
              if (label.trim() && label !== column.column_label) {
                onRename(column.id, label.trim());
              }
            }
            if (e.key === "Escape") {
              setLabel(column.column_label);
              setEditing(false);
            }
          }}
          className="w-full min-w-[80px] rounded border border-gold bg-white px-1 py-0.5 text-xs font-normal text-gray-900 focus:outline-none"
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-1">
      <span
        className="cursor-pointer"
        onDoubleClick={() => setEditing(true)}
        title="Double-click to rename"
      >
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

  const save = (rowId: string, field: EditableField, value: string) => updateScorecardRow(rowId, field, value);

  const handleRenameColumn = (columnId: string, newLabel: string) => {
    startTransition(() => renameScorecardColumn(columnId, newLabel));
  };

  const handleDeleteColumn = (columnId: string) => {
    startTransition(() => deleteScorecardColumn(columnId));
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[1700px] text-xs">
          <thead className="bg-gray-50 text-left uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Perspective</th>
              <th className="px-3 py-2">Strategic Objective</th>
              <th className="px-3 py-2">Intended Result</th>
              <th className="px-3 py-2">KPI / Measure</th>
              <th className="px-3 py-2">Baseline</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Actual</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Weight (%)</th>
              <th className="px-3 py-2">Initiative / Activity</th>
              <th className="px-3 py-2">Responsible Person</th>
              <th className="px-3 py-2">Timeline</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Notes / Comments</th>
              {/* Custom columns */}
              {customColumns.map((col) => (
                <th key={col.id} className="px-3 py-2">
                  {canEditAll ? (
                    <EditableColumnHeader
                      column={col}
                      onRename={handleRenameColumn}
                      onDelete={handleDeleteColumn}
                    />
                  ) : (
                    col.column_label
                  )}
                </th>
              ))}
              {canEditAll && <th className="px-3 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => {
              const canEditActual = canEditAll || (canUpdateActual && row.responsible_person === currentUserId);
              return (
                <tr key={row.id}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-navy">
                    <EditableSelectCell
                      value={row.perspective}
                      editable={canEditAll}
                      onSave={(v) => save(row.id, "perspective", v)}
                      options={PERSPECTIVES.map((p) => ({ value: p, label: p }))}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.strategic_objective} editable={canEditAll} onSave={(v) => save(row.id, "strategic_objective", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.intended_result} editable={canEditAll} onSave={(v) => save(row.id, "intended_result", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.kpi} editable={canEditAll} onSave={(v) => save(row.id, "kpi", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.baseline} editable={canEditAll} onSave={(v) => save(row.id, "baseline", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.target} editable={canEditAll} onSave={(v) => save(row.id, "target", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.actual} editable={canEditActual} onSave={(v) => save(row.id, "actual", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.unit} editable={canEditAll} onSave={(v) => save(row.id, "unit", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.weight} editable={canEditAll} onSave={(v) => save(row.id, "weight", v)} type="number" />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.initiative} editable={canEditAll} onSave={(v) => save(row.id, "initiative", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableSelectCell
                      value={row.responsible_person}
                      editable={canEditAll}
                      onSave={(v) => save(row.id, "responsible_person", v)}
                      options={teamOptions}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.timeline} editable={canEditAll} onSave={(v) => save(row.id, "timeline", v)} />
                  </td>
                  <td className="px-3 py-2">
                    {canEditAll ? (
                      <EditableSelectCell value={row.status} editable onSave={(v) => save(row.id, "status", v)} options={STATUSES} />
                    ) : (
                      <StatusBadge status={row.status} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.notes} editable={canEditAll} onSave={(v) => save(row.id, "notes", v)} />
                  </td>
                  {/* Custom column cells */}
                  {customColumns.map((col) => (
                    <td key={col.id} className="px-3 py-2">
                      <EditableTextCell
                        value={cellValues[row.id]?.[col.id] ?? null}
                        editable={canEditAll}
                        onSave={(v) => updateCellValue(scorecardId, row.id, col.id, v)}
                      />
                    </td>
                  ))}
                  {canEditAll && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Delete this row?")) {
                            startTransition(() => deleteScorecardRow(row.id));
                          }
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
        <div className="flex gap-3">
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(() => addScorecardRow(scorecardId))}
            className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
          >
            + Add Row
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => startTransition(() => addScorecardColumn(scorecardId))}
            className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
          >
            + Add Column
          </button>
        </div>
      )}
    </div>
  );
}
