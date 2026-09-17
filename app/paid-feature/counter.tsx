"use client";

import { useState, useTransition } from "react";
import { incrementCounterAction } from "@/app/actions/counter";

export function Counter({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const newCount = await incrementCounterAction();
      setCount(newCount);
    });
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-6xl font-semibold tabular-nums text-black dark:text-zinc-50">
        {count}
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-2xl text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        +
      </button>
    </div>
  );
}
