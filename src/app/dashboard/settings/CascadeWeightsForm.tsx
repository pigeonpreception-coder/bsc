"use client";

import { useState, useTransition } from "react";
import { updateCascadeWeights } from "./actions";
import { CASCADE_TIERS, type CascadeTierKey } from "@/lib/cascade-weights";

const inputClass =
  "mt-1 w-24 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function CascadeWeightsForm({
  initial,
}: {
  initial: Record<CascadeTierKey, number>;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [values, setValues] = useState(initial);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    setSuccess(false);
    startTransition(async () => {
      try {
        await updateCascadeWeights(formData);
        setSuccess(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form action={handleSubmit} className="mt-4 space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Saved.</div>}

      {CASCADE_TIERS.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between gap-4 border-b border-gray-100 pb-3 last:border-0">
          <div>
            <label htmlFor={`${key}_own_weight_pct`} className="text-sm font-medium text-gray-700">
              {label}
            </label>
            <p className="text-xs text-gray-400">
              {values[key]}% own performance &middot; {100 - values[key]}% average of direct reports
            </p>
          </div>
          <input
            id={`${key}_own_weight_pct`}
            name={`${key}_own_weight_pct`}
            type="number"
            min={0}
            max={100}
            value={values[key]}
            onChange={(e) => {
              const next = Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0)));
              setValues((v) => ({ ...v, [key]: next }));
            }}
            className={inputClass}
          />
        </div>
      ))}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
