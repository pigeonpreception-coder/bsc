import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  if (!user) redirect("/login");
  if (user.role !== "super_admin") redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-navy px-6 py-4 text-white">
        <div>
          <span className="font-bold">Safina BSC Platform</span>
          <span className="ml-3 rounded bg-gold px-2 py-0.5 text-xs font-semibold text-navy">
            Super Admin
          </span>
        </div>
        <form action={logout}>
          <button className="text-sm text-white/80 hover:text-white">Sign out</button>
        </form>
      </header>
      <main className="flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
