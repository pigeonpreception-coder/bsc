import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api routes are exempt from the cookie-session redirect: every route under
// src/app/api authenticates itself independently (CRON_SECRET, checked
// inside the handler), and none of them read the Supabase session cookie.
// Vercel Cron's scheduled requests carry no session cookie at all, so
// without this exemption every cron invocation (and /api/sentry-check) was
// silently redirected to /login before the route handler's own auth check
// ever ran — the cron jobs never actually executed against real traffic.
const PUBLIC_PATHS = ["/login", "/auth", "/api"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname.startsWith(path));
}

type Aal = { currentLevel: string | null; nextLevel: string | null } | null;

/**
 * True once a user has a verified TOTP factor but hasn't cleared the
 * challenge for *this* session yet (currentLevel stays aal1 until they do).
 * A user with no factor at all also sits at nextLevel aal1, not aal2, so
 * this is false for them — see needsMandatoryMfaEnrollment for that case.
 */
export function needsMfaChallenge(aal: Aal): boolean {
  return aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2";
}

/**
 * company_admin/super_admin are required to have MFA enrolled at all,
 * distinct from needsMfaChallenge (which only fires for someone who's
 * already enrolled but hasn't completed this session's challenge).
 * nextLevel stays "aal1" for a user with zero factors, which is the signal
 * used here rather than checking factor count directly, so callers don't
 * need an extra listFactors() round trip on every request.
 */
export function needsMandatoryMfaEnrollment(role: string | null, aal: Aal, pathname: string): boolean {
  if (pathname === "/account") return false;
  if (aal?.nextLevel !== "aal1") return false;
  return role === "company_admin" || role === "super_admin";
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // See src/lib/supabase/server.ts for why only `secure` is overridden.
      cookieOptions: { secure: true },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  if (user && !isPublicPath(request.nextUrl.pathname)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

    if (needsMfaChallenge(aal)) {
      const url = request.nextUrl.clone();
      url.pathname = "/auth/mfa-challenge";
      url.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(url);
    }

    // Only resolves role (an extra query) for a session still at
    // aal1-with-no-factor. That's a one-time cost for company_admin/
    // super_admin, who eventually get forced through enrollment — but
    // manager/staff/viewer are never required to enroll (§22), so this
    // query runs on literally every request of theirs for the life of the
    // session unless they opt in. Left as-is rather than adding a caching
    // layer: it's a single indexed primary-key lookup on a small table,
    // the same shape of query getCurrentUser() already does on every page
    // load elsewhere in this app — not a new class of cost, just an
    // additional instance of an existing one.
    if (aal?.nextLevel === "aal1") {
      const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).single();
      if (needsMandatoryMfaEnrollment(profile?.role ?? null, aal, request.nextUrl.pathname)) {
        const url = request.nextUrl.clone();
        url.pathname = "/account";
        url.searchParams.set("mfa", "required");
        return NextResponse.redirect(url);
      }
    }
  }

  return supabaseResponse;
}
