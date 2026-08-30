"use server";

import { redirect } from "next/navigation";
import {
  clearSessionCookie,
  createSessionToken,
  currentManager,
  getCurrentUser,
  hashPassword,
  listWorkshopUsers,
  setSessionCookie,
  verifyPassword,
  type WorkshopUser,
} from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  addUserSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from "@/validations/auth.validation";

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

/**
 * Change your own password.
 *
 * Writes `passwordChangedAt`, which retires every session issued before now —
 * that is the point, not a side effect: whoever knew the old password holds a
 * cookie that is good for the rest of its seven days otherwise. The caller's
 * own cookie is re-issued afterwards so they are not logged out by their own
 * change.
 */
export async function changePassword(data: unknown): Promise<ActionResult> {
  const parsed = changePasswordSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const me = await getCurrentUser();
  if (!me) return { success: false, error: "Not signed in" };

  const user = await prisma.user.findUnique({ where: { id: me.id } });
  if (!user) return { success: false, error: "Not signed in" };

  const valid = await verifyPassword(
    parsed.data.currentPassword,
    user.passwordHash,
  );
  if (!valid) return { success: false, error: "Current password is wrong" };

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      passwordChangedAt: new Date(),
    },
  });

  // re-issued after the write, so this cookie is newer than the change
  await setSessionCookie(await createSessionToken(user.id));

  return { success: true, data: undefined };
}

/**
 * A manager puts a colleague on the books.
 *
 * `caseId` comes from the session, never from the form: the same rule
 * `requireWorkshop()` enforces on every data route, for the same reason — a
 * manager must not be able to post a user into another workshop. The new
 * account is always `staff`; there is no way to mint a second manager yet, and
 * inventing one before anyone asks would be a permission nobody wanted.
 */
export async function addWorkshopUser(
  data: unknown,
): Promise<ActionResult<WorkshopUser[]>> {
  const parsed = addUserSchema.safeParse(data);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const manager = await currentManager();
  if (!manager)
    return {
      success: false,
      error: "Only a workshop manager can add someone to the book",
    };

  const { name, email, password } = parsed.data;
  const existing = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });
  // never says which workshop the address already belongs to
  if (existing) return { success: false, error: "Email already registered" };

  await prisma.user.create({
    data: {
      name,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      caseId: manager.caseId,
      role: "staff",
    },
  });

  return { success: true, data: await listWorkshopUsers(manager.caseId) };
}
