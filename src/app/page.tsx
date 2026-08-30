import Link from "next/link";
import { LogoutButton } from "@/components/auth/logout-button";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        Vehicle Service Due Predictor
      </h1>
      <p className="max-w-md text-lg text-muted-foreground">
        Know what is due on every vehicle before the customer walks in. Built
        for a car servicing workshop in Dhaka.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        {user ? (
          <>
            <Link href="/dashboard" className={cn(buttonVariants())}>
              Open Dashboard
            </Link>
            <LogoutButton />
          </>
        ) : (
          <>
            <Link href="/login" className={cn(buttonVariants())}>
              Workshop Login
            </Link>
            <Link
              href="/register"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Register
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
