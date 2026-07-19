import ResetPasswordForm from "./ResetPasswordForm";

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy px-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-navy">Set a new password</h1>
        </div>

        <ResetPasswordForm />
      </div>
    </div>
  );
}
