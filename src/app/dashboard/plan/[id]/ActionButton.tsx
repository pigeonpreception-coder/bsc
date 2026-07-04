"use client";

import { useState, useTransition } from "react";

export default function ActionButton({
  action,
  children,
  pendingLabel,
  variant = "primary",
}: {
  action: () => Promise<void>;
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary";
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const className =
    variant === "primary"
      ? "rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
      : "rounded-md border border-navy px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5 disabled:opacity-50";

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
      }
    });
  };

  return (
    <div>
      <button type="button" disabled={isPending} onClick={handleClick} className={className}>
        {isPending ? pendingLabel : children}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
