import Link from "next/link";

export default function SuccessPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">
        You're all set 🎉
      </h1>

      <p className="text-muted-foreground">
        Your subscription is now active. You can close this tab or head back to
        your dashboard.
      </p>

      <Link
        href="/workflows"
        className="text-sm underline"
      >
        Go to Workflows
      </Link>
    </div>
  );
}