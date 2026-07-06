"use client";

import { useTransition } from "react";
import { markAlertRead } from "./task-actions";

type Alert = {
  id: string;
  alert_type: string;
  alert_message: string;
  created_at: string;
  is_read: boolean;
};

const ALERT_ICONS: Record<string, string> = {
  kpi_off_track: "🔴",
  kpi_at_risk: "⚠️",
  overdue_task: "⏰",
  rollover_exceeded: "🔁",
};

const ALERT_COLORS: Record<string, string> = {
  kpi_off_track: "border-l-red-500 bg-red-50",
  kpi_at_risk: "border-l-amber-400 bg-amber-50",
  overdue_task: "border-l-blue-400 bg-blue-50",
  rollover_exceeded: "border-l-purple-400 bg-purple-50",
};

export default function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const [isPending, startTransition] = useTransition();

  if (alerts.length === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-3 text-sm font-semibold text-navy">
        Alerts & Notifications ({alerts.length})
      </h2>
      <div className="space-y-2">
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`flex items-start justify-between rounded-lg border-l-4 p-3 ${ALERT_COLORS[alert.alert_type] ?? "border-l-gray-300 bg-gray-50"}`}
          >
            <div className="flex items-start gap-2">
              <span className="text-base">{ALERT_ICONS[alert.alert_type] ?? "ℹ️"}</span>
              <div>
                <p className="text-sm text-gray-700">{alert.alert_message}</p>
                <p className="text-xs text-gray-400">
                  {new Date(alert.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            <button
              disabled={isPending}
              onClick={() => startTransition(() => markAlertRead(alert.id))}
              className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
