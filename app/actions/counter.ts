"use server";

import { getCurrentUser } from "@/lib/auth";
import { isSubscribed } from "@/lib/subscriptions";
import { incrementCount } from "@/lib/counter";

export async function incrementCounterAction(): Promise<number> {
  const user = await getCurrentUser();
  if (!user || !isSubscribed(user.id)) {
    throw new Error("Not authorized");
  }
  return incrementCount(user.id);
}
