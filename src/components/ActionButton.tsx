"use client";

import { useState, useTransition } from "react";

export default function ActionButton({
  action,
  children,
  pendingLabel,
  variant = "primary",
  className,
}: {
  action: () => Promise<void>;
  children: React.ReactNode;
  pendingLabel: string;
  variant?: "primary" | "secondary";
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const baseClassName = "rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50";
  const variantClassName =
    variant === "primary"
      ? "bg-navy text-white hover:bg-navy-light"
      : "border border-navy text-navy hover:bg-navy/5";
  const resolvedClassName = `${baseClassName} ${className ?? variantClassName}`;

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
      <button type="button" disabled={isPending} onClick={handleClick} className={resolvedClassName}>
        {isPending ? pendingLabel : children}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
