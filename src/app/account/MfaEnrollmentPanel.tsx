"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { enrollMfaFactor, verifyMfaEnrollment, unenrollMfaFactor } from "./actions";

type Factor = {
  id: string;
  friendly_name?: string;
  status: string;
  created_at: string;
};

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

export default function MfaEnrollmentPanel({ initialFactors }: { initialFactors: Factor[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<{ factorId: string; qrCode: string; secret: string } | null>(null);

  const verifiedFactors = initialFactors.filter((f) => f.status === "verified");

  const handleStartEnroll = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await enrollMfaFactor();
        setEnrollment(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start enrollment. Please try again.");
      }
    });
  };

  const handleVerify = (formData: FormData) => {
    setError(null);
    const code = String(formData.get("code") ?? "").trim();
    if (!enrollment) return;

    startTransition(async () => {
      try {
        await verifyMfaEnrollment(enrollment.factorId, code);
        setEnrollment(null);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "That code didn't work. Please try again.");
      }
    });
  };

  const handleUnenroll = (factorId: string) => {
    setError(null);
    startTransition(async () => {
      try {
        await unenrollMfaFactor(factorId);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not remove this device. Please try again.");
      }
    });
  };

  return (
    <div className="mt-4 space-y-4">
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {verifiedFactors.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
          {verifiedFactors.map((f) => (
            <li key={f.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>{f.friendly_name || "Authenticator app"}</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleUnenroll(f.id)}
                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!enrollment && (
        <button
          type="button"
          disabled={isPending}
          onClick={handleStartEnroll}
          className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
        >
          {isPending ? "Starting…" : "Add authenticator app"}
        </button>
      )}

      {enrollment && (
        <div className="space-y-3 rounded-md border border-gray-200 p-4">
          <p className="text-sm text-gray-700">
            Scan this QR code with your authenticator app, or enter the code below manually.
          </p>
          {/* GoTrue returns raw SVG markup, not a ready-to-use data URI — the
              data:image/svg+xml;utf-8, prefix is required per the SDK's own
              docs on this field. next/image doesn't fit a one-time,
              dynamically generated data URI with no fixed source dimensions. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/svg+xml;utf-8,${encodeURIComponent(enrollment.qrCode)}`}
            alt="Scan with your authenticator app"
            className="h-40 w-40"
          />
          <p className="break-all rounded bg-gray-50 px-2 py-1 font-mono text-xs text-gray-600">
            {enrollment.secret}
          </p>
          <form action={handleVerify} className="space-y-2">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-700">
                Enter the 6-digit code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={6}
                className={inputClass}
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light disabled:opacity-50"
            >
              {isPending ? "Verifying…" : "Verify and enable"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
