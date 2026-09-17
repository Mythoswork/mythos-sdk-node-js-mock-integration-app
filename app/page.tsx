import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isSubscribed } from "@/lib/subscriptions";
import { subscribeAction } from "@/app/actions/subscriptions";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const subscribed = isSubscribed(user.id);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-1 flex-col px-16 py-16">
        <header className="flex items-center justify-between">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</p>
          <form action="/logout" method="post">
            <button
              type="submit"
              className="text-sm font-medium text-zinc-950 underline dark:text-zinc-50"
            >
              Log out
            </button>
          </form>
        </header>

        <main className="mt-16 flex flex-col gap-6">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Welcome back
          </h1>

          <div className="rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Subscription status
            </p>
            <p className="mt-1 text-lg font-medium text-black dark:text-zinc-50">
              {subscribed ? "Subscribed" : "Not subscribed"}
            </p>

            {subscribed ? (
              <Link
                href="/paid-feature"
                className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                Go to paid feature
              </Link>
            ) : (
              <form action={subscribeAction}>
                <button
                  type="submit"
                  className="mt-4 flex h-11 items-center justify-center rounded-full bg-foreground px-5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
                >
                  Subscribe
                </button>
              </form>
            )}
          </div>

          <div className="rounded-2xl border border-black/[.08] bg-white p-6 dark:border-white/[.145] dark:bg-zinc-950">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Launched from Mythos? Try the Mythos-metered feature.
            </p>
            <Link
              href="/mythos-feature"
              className="mt-4 inline-flex h-11 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 text-sm font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Go to Mythos feature
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
