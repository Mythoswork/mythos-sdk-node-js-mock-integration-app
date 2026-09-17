"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { confirmCharge } from "@/lib/mythos-client";

interface MythosSession {
  userId: string;
  email: string;
  displayName: string;
  listingId: string;
  sessionJti: string;
}

type Status = "checking" | "no-token" | "error" | "ready";

export default function MythosFeaturePage() {
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<MythosSession | null>(null);
  const [clicks, setClicks] = useState(0);
  const [charging, setCharging] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const lt = params.get("lt");

    if (!lt) {
      setStatus("no-token");
      return;
    }

    fetch(`/api/mythos/session?lt=${encodeURIComponent(lt)}`)
      .then((res) => res.json().then((body) => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (ok && body.session) {
          setSession(body.session as MythosSession);
          setStatus("ready");
          // Tell Mythos (if we're running inside its iframe) that the
          // session exchange succeeded, per frontend-client.md's iframe
          // handshake convention. No-op / harmless when not embedded.
          window.parent.postMessage({ type: "mythos:handshake" }, "*");
        } else {
          setError(body.error ?? "Could not verify Mythos session.");
          setStatus("error");
        }
      })
      .catch(() => {
        setError("Could not reach the session endpoint.");
        setStatus("error");
      })
      .finally(() => {
        params.delete("lt");
        const clean =
          window.location.pathname + (params.toString() ? `?${params}` : "");
        window.history.replaceState({}, "", clean);
      });
  }, []);

  async function handleClick() {
    if (!session || charging) return;
    setCharging(true);
    setError(null);
    try {
      const approved = await confirmCharge(1, "mythos-feature:click");
      if (!approved) {
        setError(
          "Charge declined, timed out, or the dashboard is not listening.",
        );
        return;
      }

      const res = await fetch("/api/mythos/report-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionJti: session.sessionJti,
          credits: 1,
          reason: "mythos-feature:click",
        }),
      });
      if (res.status === 402) {
        setError("Insufficient Mythos credits.");
        return;
      }
      if (!res.ok) {
        setError("Could not charge for this click. Try again.");
        return;
      }
      setClicks((c) => c + 1);
    } catch {
      setError("Could not reach the report-usage endpoint.");
    } finally {
      setCharging(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 font-sans dark:bg-black">
      <div className="flex w-full max-w-3xl flex-1 flex-col px-16 py-16">
        <Link href="/" className="text-sm text-zinc-600 dark:text-zinc-400">
          &larr; Home
        </Link>

        <main className="mt-16 flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Mythos feature: 1 credit per click
          </h1>

          {status === "checking" && (
            <p className="text-zinc-600 dark:text-zinc-400">Checking for a Mythos launch…</p>
          )}

          {status === "no-token" && (
            <p className="max-w-sm text-zinc-600 dark:text-zinc-400">
              This feature is only available when launched from Mythos. Regular
              app login does not grant access.
            </p>
          )}

          {status === "error" && (
            <p className="max-w-sm text-red-600 dark:text-red-400">{error}</p>
          )}

          {status === "ready" && session && (
            <div className="flex flex-col items-center gap-4">
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Launched by {session.displayName}
              </p>
              <p className="text-6xl font-semibold tabular-nums text-black dark:text-zinc-50">
                {clicks}
              </p>
              <button
                type="button"
                onClick={handleClick}
                disabled={charging}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-2xl text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
              >
                +
              </button>
              <p className="text-xs text-zinc-500">
                1 credit is charged per click, confirmed via the Mythos dashboard
              </p>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
