import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Must be a single-leading-slash relative path — reject "//evil.com" and
// "/\evil.com" (both parsed as an absolute URL to a different host by at
// least one major browser) as well as anything not starting with "/" at
// all (e.g. "@evil.com/..." splices onto origin as userinfo, redirecting
// to evil.com). Without this, an attacker-supplied `next` turns this route
// into an open redirect served from the real auth domain.
export function isSafeRedirectPath(path: string): boolean {
  return /^\/(?!\/|\\)/.test(path);
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/";
  const next = isSafeRedirectPath(rawNext) ? rawNext : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/login?error=${encodeURIComponent("That reset link is invalid or has expired.")}`,
  );
}
