import { hash, verify } from "argon2";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { ENV_PRIVATE } from "@/config/env-private";
import prisma from "@/lib/prisma";

const SESSION_COOKIE = "session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getAuthSecret(): Uint8Array {
  return new TextEncoder().encode(ENV_PRIVATE.AUTH_SECRET);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}

type SessionPayload = {
  userId: string;
  /** Issued-at, seconds. jose sets it; used to retire pre-password-change sessions. */
  iat?: number;
};

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getAuthSecret());
}

export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify<SessionPayload>(token, getAuthSecret());
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/**
 * Whether a token predates the account's last password change.
 *
 * Nothing but `userId` is in the token and there is no session store, so this
 * comparison is what makes "change your password" end the other sessions —
 * including one held by whoever knew the old password. Pure, so auth-check.ts
 * can assert it without a request.
 *
 * Compared at second granularity because `iat` is whole seconds while
 * `passwordChangedAt` carries milliseconds: without the floor, the very cookie
 * issued by the change would look older than the change itself. The cost is a
 * one-second window in which a token issued in the same second survives.
 */
// ponytail: no session store. A row per session would allow revoking one device
// instead of all of them; add it when anyone asks for that.
export const sessionIsStale = (
  iat: number | undefined,
  passwordChangedAt: Date | null,
): boolean =>
  passwordChangedAt != null &&
  Math.floor(passwordChangedAt.getTime() / 1000) > (iat ?? 0);

export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      name: true,
      email: true,
      caseId: true,
      role: true,
      createdAt: true,
      passwordChangedAt: true,
    },
  });
  if (!user) return null;
  // A valid signature is not enough: the password may have changed under it.
  if (sessionIsStale(session.iat, user.passwordChangedAt)) return null;

  return user;
}

/**
 * The signed-in manager and the workshop they run, or null.
 *
 * One implementation of "is a manager", used by the actions that mint and list
 * accounts. `caseId` comes from here — the session — and never from a form, so
 * a manager cannot post a colleague into someone else's workshop.
 */
export async function currentManager(): Promise<{
  id: string;
  caseId: string;
} | null> {
  const user = await getCurrentUser();
  if (!user?.caseId || user.role !== "manager") return null;
  return { id: user.id, caseId: user.caseId };
}

/** Everyone who works out of one workshop, oldest account first. */
export async function listWorkshopUsers(caseId: string) {
  return prisma.user.findMany({
    where: { caseId },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
}

export type WorkshopUser = Awaited<
  ReturnType<typeof listWorkshopUsers>
>[number];
