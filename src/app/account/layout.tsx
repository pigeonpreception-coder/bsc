import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/app/login/actions";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const backHref = user.role === "super_admin" ? "/admin" : "/dashboard";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between bg-navy px-6 py-4 text-white">
        <div className="flex items-center gap-4">
          <span className="font-bold">Safina BSC Platform</span>
          <Link href={backHref} className="text-sm text-white/80 hover:text-white">
            &larr; Back
          </Link>
        </div>
        <form action={logout}>
          <button className="text-sm text-white/80 hover:text-white">Sign out</button>
        </form>
      </header>
      <main className="flex-1 bg-gray-50 p-6">{children}</main>
    </div>
  );
}
