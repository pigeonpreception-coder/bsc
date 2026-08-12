"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { markNotificationRead, markAllNotificationsRead } from "./notification-actions";

type Notification = {
  id: string;
  notification_type: string;
  message: string;
  link: string | null;
  created_at: string;
};

export default function NotificationBell({
  notifications,
  unreadCount,
}: {
  notifications: Notification[];
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-full p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
        aria-label="Notifications"
      >
        <span className="text-lg">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-gray-200 bg-white text-navy shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <button
                  disabled={isPending}
                  onClick={() => startTransition(() => markAllNotificationsRead())}
                  className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-50"
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">No notifications</p>
              ) : (
                notifications.map((n) => (
                  <Link
                    key={n.id}
                    href={n.link ?? "/dashboard"}
                    onClick={() => {
                      setOpen(false);
                      startTransition(() => markNotificationRead(n.id));
                    }}
                    className="block border-b border-gray-50 px-4 py-3 text-sm hover:bg-gray-50"
                  >
                    <p className="text-gray-700">{n.message}</p>
                    <p className="mt-1 text-xs text-gray-400">{new Date(n.created_at).toLocaleString()}</p>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
