import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import MfaEnrollmentPanel from "./MfaEnrollmentPanel";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ mfa?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { mfa } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const totpFactors = (data?.all ?? []).filter((f) => f.factor_type === "totp");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Account &amp; Security</h1>
        <p className="mt-1 text-sm text-gray-500">Manage your two-factor authentication.</p>
      </div>

      {mfa === "required" && (
        <div className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your role requires two-factor authentication before you can access the dashboard. Set it up below to
          continue.
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Two-factor authentication</h2>
        <p className="mt-1 text-xs text-gray-500">
          Adds a second step to sign-in using a code from an authenticator app (e.g. Google Authenticator, Authy,
          1Password). Verifying a new device signs out your other active sessions.
        </p>
        <MfaEnrollmentPanel initialFactors={totpFactors} />
      </div>
    </div>
  );
}
