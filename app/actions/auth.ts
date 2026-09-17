"use server";

import { redirect } from "next/navigation";
import {
  createSession,
  createUser,
  findUserByEmail,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export interface AuthFormState {
  error?: string;
}

export async function signupAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email and password are required." };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (findUserByEmail(email)) {
    return { error: "An account with that email already exists." };
  }

  const user = createUser(email, await hashPassword(password));
  await createSession(user.id);
  redirect("/");
}

export async function loginAction(
  _prevState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  const user = findUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return { error: "Invalid email or password." };
  }

  await createSession(user.id);
  redirect("/");
}
