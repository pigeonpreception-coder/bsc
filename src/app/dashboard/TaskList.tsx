"use client";

import { useState, useTransition } from "react";
import { updateTaskStatus } from "./task-actions";

type Task = {
  id: string;
  task_title: string;
  task_description: string | null;
  task_priority: string;
  status: string;
  linked_objective: string | null;
  linked_kpi: string | null;
  rollover_count: number;
  completed_at: string | null;
  completion_rating: number | null;
  assigned_by_name: string | null;
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "border-l-red-500 bg-red-50/30",
  medium: "border-l-amber-400 bg-amber-50/30",
  low: "border-l-green-400 bg-green-50/30",
};

const PRIORITY_BADGES: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-green-100 text-green-700",
};

const STATUS_BG: Record<string, string> = {
  untouched: "bg-white",
  in_progress: "bg-blue-50",
  completed: "bg-gray-50 opacity-70",
};

export default function TaskList({ tasks }: { tasks: Task[] }) {
  const rolledOver = tasks.filter((t) => t.rollover_count > 0 && t.status !== "completed");

  return (
    <div className="space-y-3">
      {rolledOver.length > 0 && (
        <p className="text-xs font-medium text-red-500">
          {rolledOver.length} task{rolledOver.length > 1 ? "s" : ""} rolled over from previous days
        </p>
      )}
      {tasks.length === 0 ? (
        <p className="text-sm text-gray-400">No tasks for today yet.</p>
      ) : (
        tasks.map((task) => <TaskCard key={task.id} task={task} />)
      )}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  const [expanded, setExpanded] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(3);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleComplete = () => {
    startTransition(async () => {
      await updateTaskStatus(task.id, "completed", rating, notes || undefined);
      setShowRating(false);
    });
  };

  const handleInProgress = () => {
    startTransition(() => updateTaskStatus(task.id, "in_progress"));
  };

  return (
    <div
      className={`rounded-lg border border-l-4 p-3 ${PRIORITY_STYLES[task.task_priority] ?? ""} ${STATUS_BG[task.status] ?? ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {task.status === "completed" && <span className="text-green-600">✅</span>}
            {task.status === "in_progress" && <span className="text-blue-500">🔄</span>}
            <h4
              className={`text-sm font-medium ${task.status === "completed" ? "text-gray-400 line-through" : "text-gray-800"}`}
            >
              {task.task_title}
            </h4>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_BADGES[task.task_priority]}`}>
              {task.task_priority}
            </span>
            {task.rollover_count > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                Rolled over {task.rollover_count} day{task.rollover_count > 1 ? "s" : ""}
              </span>
            )}
            {task.linked_kpi && (
              <span className="text-xs text-gray-400">KPI: {task.linked_kpi}</span>
            )}
            {task.assigned_by_name && (
              <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy">
                Assigned by {task.assigned_by_name}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
          {task.task_description && (
            <p className="text-xs text-gray-600">{task.task_description}</p>
          )}
          {task.linked_objective && (
            <p className="text-xs text-gray-400">
              <strong>Objective:</strong> {task.linked_objective}
            </p>
          )}
          {task.completed_at && (
            <p className="text-xs text-green-600">
              Completed: {new Date(task.completed_at).toLocaleString()}
              {task.completion_rating && ` — Rating: ${"★".repeat(task.completion_rating)}${"☆".repeat(5 - task.completion_rating)}`}
            </p>
          )}
        </div>
      )}

      {task.status !== "completed" && (
        <div className="mt-2 flex gap-2">
          {!showRating ? (
            <>
              <button
                disabled={isPending}
                onClick={() => setShowRating(true)}
                className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✅ Complete
              </button>
              {task.status !== "in_progress" && (
                <button
                  disabled={isPending}
                  onClick={handleInProgress}
                  className="rounded bg-blue-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-600 disabled:opacity-50"
                >
                  🔄 In Progress
                </button>
              )}
            </>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">Rating:</span>
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    onClick={() => setRating(star)}
                    className={`text-lg ${star <= rating ? "text-gold" : "text-gray-300"}`}
                  >
                    ★
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-gold focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  disabled={isPending}
                  onClick={handleComplete}
                  className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {isPending ? "Saving…" : "Submit"}
                </button>
                <button
                  onClick={() => setShowRating(false)}
                  className="text-xs text-gray-400 hover:text-gray-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
