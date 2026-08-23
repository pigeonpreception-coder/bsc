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

function ErrorNote({ message }: { message: string }) {
  return <p className="mt-0.5 max-w-[160px] whitespace-normal text-[10px] leading-tight text-red-600">{message}</p>;
}

export function EditableTextCell({
  value,
  editable,
  onSave,
  type = "text",
  min,
  max,
}: {
  value: string | number | null;
  editable: boolean;
  onSave: (value: string) => Promise<void>;
  type?: "text" | "number";
  min?: number;
  max?: number;
}) {
  const [localValue, setLocalValue] = useState(String(value ?? ""));
  const [syncedValue, setSyncedValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (value !== syncedValue) {
    setSyncedValue(value);
    setLocalValue(String(value ?? ""));
  }

  if (!editable) {
    return <span>{value ?? "—"}</span>;
  }

  return (
    <div>
      <input
        type={type}
        min={min}
        max={max}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={() => {
          const previous = String(value ?? "");
          if (previous !== localValue) {
            setError(null);
            startTransition(async () => {
              try {
                await onSave(localValue);
              } catch (err) {
                setLocalValue(previous);
                setError(err instanceof Error ? err.message : "Save failed. Please try again.");
              }
            });
          }
        }}
        className="w-full min-w-[120px] rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gold focus:outline-none"
      />
      {error && <ErrorNote message={error} />}
    </div>
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
  const [localValue, setLocalValue] = useState(value ?? "");
  const [syncedValue, setSyncedValue] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (value !== syncedValue) {
    setSyncedValue(value);
    setLocalValue(value ?? "");
  }

  if (!editable) {
    return <span>{options.find((o) => o.value === value)?.label ?? value ?? "—"}</span>;
  }

  return (
    <div>
      <select
        value={localValue}
        onChange={(e) => {
          const next = e.target.value;
          const previous = localValue;
          setLocalValue(next);
          setError(null);
          startTransition(async () => {
            try {
              await onSave(next);
            } catch (err) {
              setLocalValue(previous);
              setError(err instanceof Error ? err.message : "Save failed. Please try again.");
            }
          });
        }}
        className="w-full min-w-[120px] rounded border border-transparent px-1 py-0.5 hover:border-gray-300 focus:border-gold focus:outline-none"
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <ErrorNote message={error} />}
    </div>
  );
}

export function EditableCheckboxCell({
  checked,
  editable,
  onSave,
  title,
}: {
  checked: boolean;
  editable: boolean;
  onSave: (value: string) => Promise<void>;
  title?: string;
}) {
  const [localChecked, setLocalChecked] = useState(checked);
  const [syncedChecked, setSyncedChecked] = useState(checked);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (checked !== syncedChecked) {
    setSyncedChecked(checked);
    setLocalChecked(checked);
  }

  if (!editable) {
    return <span>{checked ? "Yes" : "No"}</span>;
  }

  return (
    <div>
      <input
        type="checkbox"
        title={title}
        checked={localChecked}
        onChange={(e) => {
          const next = e.target.checked;
          setLocalChecked(next);
          setError(null);
          startTransition(async () => {
            try {
              await onSave(String(next));
            } catch (err) {
              setLocalChecked(!next);
              setError(err instanceof Error ? err.message : "Save failed. Please try again.");
            }
          });
        }}
        className="h-4 w-4 rounded border-gray-300 text-navy focus:ring-gold"
      />
      {error && <ErrorNote message={error} />}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] ?? "bg-gray-100 text-gray-600"}`}>
      {STATUS_LABELS[status] ?? status.replace(/_/g, " ")}
    </span>
  );
}

// Approval/lock state now lives on the whole BSC (scorecards.workflow_status),
// not per-row — see WorkflowPanel.tsx on the scorecard detail page for the
// status banner and Agree/Approve/Unlock controls.
