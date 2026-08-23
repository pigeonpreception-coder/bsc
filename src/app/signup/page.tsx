import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import SignUpForm from "./SignUpForm";

export default async function SignUpPage() {
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-navy">Safina BSC Platform</h1>
          <p className="mt-1 text-sm text-gray-500">Create your organisation&apos;s account</p>
        </div>

        <SignUpForm />

        <p className="mt-4 text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-navy hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
