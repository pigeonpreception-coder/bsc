"use client";

import { useState } from "react";
import { submitQuestionnaire } from "./actions";

const STEPS = [
  "Company Basics",
  "Vision & Mission",
  "Values & Period",
  "Strategic Priorities",
  "Products & Markets",
  "Financials & Departments",
];

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function QuestionnaireForm({ defaultCompanyName }: { defaultCompanyName: string }) {
  const [step, setStep] = useState(0);
  const isLastStep = step === STEPS.length - 1;

  return (
    <form action={submitQuestionnaire} className="mx-auto max-w-2xl">
      <ol className="mb-6 flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${
              i === step ? "bg-navy text-white" : i < step ? "bg-gold/30 text-navy" : "bg-gray-100 text-gray-400"
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-6">
        <div className={step === 0 ? "space-y-4" : "hidden"}>
          <Field label="Company name" name="company_name" defaultValue={defaultCompanyName} required />
          <Field label="Industry" name="industry" />
          <Field label="Country" name="country" />
          <Field label="Number of employees" name="employee_count" type="number" />
        </div>

        <div className={step === 1 ? "space-y-4" : "hidden"}>
          <TextArea label="Vision statement" name="vision" />
          <TextArea label="Mission statement" name="mission" />
        </div>

        <div className={step === 2 ? "space-y-4" : "hidden"}>
          <TextArea label="Core values (one per line)" name="values" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Strategic period (years)</label>
              <select name="period_years" defaultValue="3" className={inputClass}>
                <option value="3">3 years</option>
                <option value="4">4 years</option>
                <option value="5">5 years</option>
              </select>
            </div>
            <Field label="Start year" name="start_year" type="number" defaultValue={String(new Date().getFullYear())} />
          </div>
        </div>

        <div className={step === 3 ? "space-y-4" : "hidden"}>
          <TextArea label="Top 3–5 strategic priorities / challenges (one per line)" name="strategic_priorities" />
        </div>

        <div className={step === 4 ? "space-y-4" : "hidden"}>
          <TextArea label="Key products or services (one per line)" name="products_services" />
          <TextArea label="Key target markets / customer segments (one per line)" name="target_markets" />
          <TextArea label="Key competitors (optional, one per line)" name="competitors" />
        </div>

        <div className={step === 5 ? "space-y-4" : "hidden"}>
          <TextArea label="Recent financial performance (optional context)" name="financial_performance" />
          <TextArea label="Key departments to include in BSC cascade (one per line)" name="departments" />
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          disabled={step === 0}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-40"
        >
          Back
        </button>

        {isLastStep ? (
          <button
            type="submit"
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            Submit Questionnaire
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            Next
          </button>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className={inputClass}
      />
    </div>
  );
}

function TextArea({ label, name }: { label: string; name: string }) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-gray-700">
        {label}
      </label>
      <textarea id={name} name={name} rows={3} className={inputClass} />
    </div>
  );
}
