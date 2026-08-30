"use server";

import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  createSessionToken,
  hashPassword,
  setSessionCookie,
  verifyPassword,
} from "@/lib/auth";
import prisma from "@/lib/prisma";
import { loginSchema, registerSchema } from "@/validations/auth.validation";

export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function login(
  data: unknown,
): Promise<ActionResult<{ email: string }>> {
  const parsed = loginSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: "Invalid email or password" };
  }

  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (!user) {
    return { success: false, error: "Invalid email or password" };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { success: false, error: "Invalid email or password" };
  }

  const token = await createSessionToken(user.id);
  await setSessionCookie(token);

  return { success: true, data: { email: user.email } };
}

export async function register(
  data: unknown,
): Promise<ActionResult<{ email: string }>> {
  const parsed = registerSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  if (existing) {
    return { success: false, error: "Email already registered" };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash,
    },
  });

  const token = await createSessionToken(user.id);
  await setSessionCookie(token);

  return { success: true, data: { email: user.email } };
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
