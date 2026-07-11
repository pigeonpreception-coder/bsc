"use client";

export type StatusRowEntry = { description: string; status: string };

const STATUS_OPTIONS = ["Critical", "Most Important", "Very Important", "Important", "Neutral"];

export default function StatusRowList({
  entries,
  onChange,
  rowLabel,
  descriptionPlaceholder,
  addLabel,
  minMandatoryRows = 3,
}: {
  entries: StatusRowEntry[];
  onChange: (entries: StatusRowEntry[]) => void;
  rowLabel: (index: number) => string;
  descriptionPlaceholder: string;
  addLabel: string;
  minMandatoryRows?: number;
}) {
  const list =
    entries.length >= minMandatoryRows
      ? entries
      : [
          ...entries,
          ...Array.from({ length: minMandatoryRows - entries.length }, () => ({ description: "", status: "" })),
        ];

  const updateRow = (index: number, patch: Partial<StatusRowEntry>) => {
    onChange(list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    onChange([...list, { description: "", status: "" }]);
  };

  return (
    <div className="space-y-3">
      {list.map((row, index) => {
        const isMandatory = index < minMandatoryRows;
        return (
          <div key={index} className="flex items-center gap-2">
            <label className="w-28 shrink-0 text-xs font-medium text-gray-500">{rowLabel(index)}</label>
            <input
              type="text"
              value={row.description}
              placeholder={descriptionPlaceholder}
              onChange={(e) => updateRow(index, { description: e.target.value })}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            />
            <select
              value={row.status}
              onChange={(e) => updateRow(index, { status: e.target.value })}
              className="w-44 rounded-md border border-gray-300 px-2 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold"
            >
              <option value="">{isMandatory ? "Status *" : "Status"}</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <button
        type="button"
        onClick={addRow}
        className="rounded-md border border-navy px-3 py-1.5 text-sm font-medium text-navy hover:bg-navy/5"
      >
        {addLabel}
      </button>
    </div>
  );
}
