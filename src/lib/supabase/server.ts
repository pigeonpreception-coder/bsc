import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // @supabase/ssr's own default omits `secure` entirely (and sets
      // httpOnly: false, which is intentional on their part — the browser
      // client needs to read this cookie directly, so that one isn't
      // something to override). `secure` costs nothing to set explicitly
      // and works fine even on localhost (modern browsers treat it as a
      // secure context), so there's no reason to leave it unset.
      cookieOptions: { secure: true },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — safe to ignore
            // because middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
