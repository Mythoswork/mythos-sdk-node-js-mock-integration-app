"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { subscribe } from "@/lib/subscriptions";

export async function subscribeAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  subscribe(user.id);
  revalidatePath("/");
}
