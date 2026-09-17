import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSubscribed } from "@/lib/subscriptions";
import { getCount } from "@/lib/counter";
import { Counter } from "./counter";

export default async function PaidFeaturePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!isSubscribed(user.id)) {
    return (
      <div className="flex flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-lg font-medium text-black dark:text-zinc-50">
            This feature requires an active subscription.
          </p>
          <Link
            href="/"
            className="flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Subscribe from home
          </Link>
        </div>
      </div>
    );
  }

  const initialCount = getCount(user.id);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-1 flex-col px-16 py-16">
        <Link href="/" className="text-sm text-zinc-600 dark:text-zinc-400">
          &larr; Home
        </Link>
        <main className="mt-16 flex flex-1 flex-col items-center justify-center gap-6">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Paid feature: counter
          </h1>
          <Counter initialCount={initialCount} />
        </main>
      </div>
    </div>
  );
}
