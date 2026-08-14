import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isSafeRedirectPath } from "@/app/auth/callback/route";
import MfaChallengeForm from "./MfaChallengeForm";

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { next } = await searchParams;
  const safeNext = next && isSafeRedirectPath(next) ? next : "/";

  const supabase = await createClient();

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal1" || aal?.nextLevel !== "aal2") {
    // Nothing to challenge — already at aal2, or no verified factor exists.
    redirect(safeNext);
  }

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (!factor) redirect(safeNext);

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-navy">Two-factor authentication</h1>
          <p className="mt-1 text-sm text-gray-500">Enter the code from your authenticator app.</p>
        </div>
        <MfaChallengeForm factorId={factor.id} next={safeNext} />
      </div>
    </div>
  );
}
