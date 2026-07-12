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
import { computeAutoStatus, PERSPECTIVES } from "@/lib/scorecard";

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

  // Objective grouping: first row of each objective shows the shared columns (1-7);
  // continuation rows blank them out so a multi-KPI objective reads as one block.
  const objectiveKeyOf = (row: ScorecardRow) => `${row.perspective}|${row.strategic_objective}`;

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[2000px] text-xs">
          <thead className="bg-gray-50 text-left uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">BSC Perspective</th>
              <th className="px-3 py-2">Strategic Objective</th>
              <th className="px-3 py-2">Strategic Theme Alignment</th>
              <th className="px-3 py-2">Intended Result</th>
              <th className="px-3 py-2">Key Initiatives &amp; Intended Results</th>
              <th className="px-3 py-2">Persp. Wt (%)</th>
              <th className="px-3 py-2">Obj. Wt (%)</th>
              <th className="px-3 py-2">KPI / Measure</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Baseline</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Measurement Frequency</th>
              <th className="px-3 py-2">Actual Performance</th>
              <th className="px-3 py-2">Responsible Person</th>
              <th className="px-3 py-2">Status (RAG)</th>
              {customColumns.map((col) => (
                <th key={col.id} className="px-3 py-2">
                  {canEditAll ? (
                    <EditableColumnHeader column={col} onRename={(id, l) => startTransition(() => renameScorecardColumn(id, l))} onDelete={(id) => startTransition(() => deleteScorecardColumn(id))} />
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
              const isNewObjective = i === 0 || objectiveKeyOf(row) !== objectiveKeyOf(rows[i - 1]);
              const liveStatus = computeAutoStatus(row.actual, row.target, row.lower_is_better ?? false);

              return (
                <tr key={row.id} className={isNewObjective ? "border-t-2 border-gray-200" : ""}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 font-medium text-navy">
                    {isNewObjective ? (
                      <EditableSelectCell value={row.perspective} editable={canEditAll} onSave={(v) => save(row.id, "perspective", v)} options={[...new Set(PERSPECTIVES)].map((p) => ({ value: p, label: p }))} />
                    ) : (
                      <span className="text-gray-300">↳</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isNewObjective ? (
                      <EditableTextCell value={row.strategic_objective} editable={canEditAll} onSave={(v) => save(row.id, "strategic_objective", v)} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {isNewObjective ? (
                      <EditableTextCell value={row.strategic_theme_alignment} editable={canEditAll} onSave={(v) => save(row.id, "strategic_theme_alignment", v)} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {isNewObjective ? (
                      <EditableTextCell value={row.intended_result} editable={canEditAll} onSave={(v) => save(row.id, "intended_result", v)} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {isNewObjective ? (
                      <EditableTextCell value={row.key_initiatives} editable={canEditAll} onSave={(v) => save(row.id, "key_initiatives", v)} />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {isNewObjective ? (
                      <EditableTextCell value={row.perspective_weight} editable={canEditAll} onSave={(v) => save(row.id, "perspective_weight", v)} type="number" />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    {isNewObjective ? (
                      <EditableTextCell value={row.objective_weight} editable={canEditAll} onSave={(v) => save(row.id, "objective_weight", v)} type="number" />
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.kpi} editable={canEditAll} onSave={(v) => save(row.id, "kpi", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.unit} editable={canEditAll} onSave={(v) => save(row.id, "unit", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.baseline} editable={canEditAll} onSave={(v) => save(row.id, "baseline", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.target} editable={canEditAll} onSave={(v) => save(row.id, "target", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.measurement_frequency} editable={canEditAll} onSave={(v) => save(row.id, "measurement_frequency", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableTextCell value={row.actual} editable={canEditActual} onSave={(v) => save(row.id, "actual", v)} />
                  </td>
                  <td className="px-3 py-2">
                    <EditableSelectCell value={row.responsible_person} editable={canEditAll} onSave={(v) => save(row.id, "responsible_person", v)} options={teamOptions} />
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={liveStatus} />
                  </td>
                  {customColumns.map((col) => (
                    <td key={col.id} className="px-3 py-2">
                      <EditableTextCell value={cellValues[row.id]?.[col.id] ?? null} editable={canEditAll} onSave={(v) => updateCellValue(scorecardId, row.id, col.id, v)} />
                    </td>
                  ))}
                  {canEditAll && (
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm("Delete this row?")) startTransition(() => deleteScorecardRow(row.id));
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
          <button type="button" disabled={isPending} onClick={() => startTransition(() => addScorecardRow(scorecardId))} className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50">
            + Add Row
          </button>
          <button type="button" disabled={isPending} onClick={() => startTransition(() => addScorecardColumn(scorecardId))} className="rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50">
            + Add Column
          </button>
        </div>
      )}
    </div>
  );
}
