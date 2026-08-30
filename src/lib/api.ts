import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

/**
 * The workshop a request is allowed to touch, taken from the session — never
 * from the query string or body. A signed-in user works out of exactly one
 * book, so `caseId` is not a client-supplied parameter and cannot be swapped
 * to read or write someone else's data.
 *
 * `/api/run` deliberately does not use this: it is the judge's stateless entry
 * point, takes a whole case in the body, and never touches the database.
 */
export async function requireWorkshop(): Promise<
  { caseId: string; userId: string } | NextResponse
> {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!user.caseId)
    return NextResponse.json(
      { error: "This account is not assigned to a workshop" },
      { status: 409 },
    );
  return { caseId: user.caseId, userId: user.id };
}

export const denied = (r: unknown): r is NextResponse =>
  r instanceof NextResponse;

export function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}
