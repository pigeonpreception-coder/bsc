"use client";

import { useRef, useState, useTransition } from "react";
import { assignTask } from "@/app/dashboard/task-actions";

export default function AssignTaskForm({ assignees }: { assignees: { value: string; label: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      try {
        await assignTask(formData);
        formRef.current?.reset();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500">Assign to</label>
        <select
          name="assignee_id"
          required
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
        >
          <option value="">Choose a person…</option>
          {assignees.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">Task title</label>
        <input
          name="task_title"
          required
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500">Description (optional)</label>
        <textarea
          name="task_description"
          rows={2}
          className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
        />
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500">Priority</label>
          <select
            name="task_priority"
            defaultValue="medium"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-500">Due date</label>
          <input
            type="date"
            name="task_date"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-gold focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      >
        {isPending ? "Assigning…" : "Assign Task"}
      </button>
    </form>
  );
}
