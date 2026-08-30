import { jwtVerify } from "jose";
import { type NextRequest, NextResponse } from "next/server";
import { ENV_PRIVATE } from "@/config/env-private";

const AUTH_ROUTES = ["/login", "/register"];
const PROTECTED_ROUTES = ["/dashboard"];
const SESSION_COOKIE = "session";

function getAuthSecret(): Uint8Array {
  return new TextEncoder().encode(ENV_PRIVATE.AUTH_SECRET);
}

function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

async function verifySessionToken(
  token: string,
): Promise<{ userId: string } | null> {
  try {
    const { payload } = await jwtVerify<{ userId: string }>(
      token,
      getAuthSecret(),
    );
    return payload;
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (isProtectedRoute(pathname) && !session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthRoute(pathname) && session) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
