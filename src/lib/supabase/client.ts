import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // See src/lib/supabase/server.ts for why only `secure` is set here —
    // httpOnly:false is @supabase/ssr's own default and needs to stay that
    // way for this same browser client to read the cookie at all.
    { cookieOptions: { secure: true } },
  );
}
