import Link from "next/link";
import ForgotPasswordForm from "./ForgotPasswordForm";

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-navy">Reset your password</h1>
          <p className="mt-1 text-sm text-gray-500">
            Enter the email on the account and we&apos;ll send a link to reset the password.
          </p>
        </div>

        <ForgotPasswordForm />

        <p className="mt-6 text-center text-sm text-gray-500">
          <Link href="/login" className="font-medium text-navy hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
