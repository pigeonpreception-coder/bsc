"use client";

import { useState, useTransition } from "react";

const STATUS_COLORS: Record<string, string> = {
  on_track: "bg-green-100 text-green-700",
  at_risk: "bg-amber-100 text-amber-700",
  off_track: "bg-red-100 text-red-700",
  not_yet_measured: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<string, string> = {
  on_track: "On Track",
  at_risk: "At Risk",
  off_track: "Off Track",
  not_yet_measured: "Not Yet Measured",
};

export function EditableTextCell({
  value,
  editable,
  onSave,
  type = "text",
}: {
  value: string | number | null;
  editable: boolean;
  onSave: (value: string) => Promise<void>;
  type?: "text" | "number";
}) {
  const [localValue, setLocalValue] = useState(String(value ?? ""));
  const [, startTransition] = useTransition();

  if (!editable) {
    return <span>{value ?? "—"}</span>;
  }

  return (
    <input
      type={type}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => {
        if (String(value ?? "") !== localValue) {
          startTransition(() => onSave(localValue));
        }
      }}
      className="w-full min-w-[120px] rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gold focus:outline-none"
    />
  );
}

export function EditableSelectCell({
  value,
  editable,
  onSave,
  options,
}: {
  value: string | null;
  editable: boolean;
  onSave: (value: string) => Promise<void>;
  options: { value: string; label: string }[];
}) {
  const [, startTransition] = useTransition();

  if (!editable) {
    return <span>{options.find((o) => o.value === value)?.label ?? value ?? "—"}</span>;
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => startTransition(() => onSave(e.target.value))}
      className="w-full min-w-[120px] rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gold focus:outline-none"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}
