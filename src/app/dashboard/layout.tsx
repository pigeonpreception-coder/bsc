import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/login/actions";

const ROLE_LABELS: Record<string, string> = {
  company_admin: "Company Admin",
  manager: "Manager",
  staff: "Staff",
  viewer: "Viewer",
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role === "super_admin") redirect("/admin");

  let planId: string | null = null;
  if (user.tenant_id) {
    const supabase = await createClient();
    const { data: plan } = await supabase
      .from("strategic_plans")
      .select("id")
      .eq("tenant_id", user.tenant_id)
      .limit(1)
      .maybeSingle();
    planId = plan?.id ?? null;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-navy px-6 py-4 text-white">
        <div className="flex items-center gap-4">
          <span className="font-bold">Safina BSC Platform</span>
          <span className="rounded bg-gold px-2 py-0.5 text-xs font-semibold text-navy">
            {ROLE_LABELS[user.role] ?? user.role}
          </span>
          <nav className="ml-4 flex gap-4 text-sm text-white/80">
            <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
            {planId && <Link href="/dashboard/scorecards" className="hover:text-white">Scorecards</Link>}
            {user.role === "company_admin" && (
              <>
                {planId && <Link href={`/dashboard/plan/${planId}`} className="hover:text-white">Plan</Link>}
                <Link href="/dashboard/team" className="hover:text-white">Team</Link>
              </>
            )}
          </nav>
        </div>
        <form action={logout}>
          <button className="text-sm text-white/80 hover:text-white">Sign out</button>
        </form>
      </header>
      <main className="flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
