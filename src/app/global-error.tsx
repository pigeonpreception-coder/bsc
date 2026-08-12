"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import "./globals.css";

// Root-level error boundary — catches anything that escapes every other
// error.tsx in the tree, including errors in the root layout itself.
// Must define its own <html>/<body> since it replaces the root layout
// when active (see the Next.js global-error.js docs).
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col items-center justify-center gap-4 bg-navy px-4 text-center text-white">
        <h1 className="text-xl font-bold">Something went wrong</h1>
        <p className="max-w-sm text-sm text-white/70">
          The error has been reported. Try refreshing the page — if it keeps happening, contact your administrator.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-gold px-4 py-2 text-sm font-semibold text-navy hover:bg-gold-light"
        >
          Reload
        </button>
      </body>
    </html>
  );
}
