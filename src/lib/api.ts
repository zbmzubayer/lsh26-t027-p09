import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/**
 * Every route that reads or writes the workshop's own data is behind the
 * session cookie. `/api/run` is deliberately not — it is the judge's stateless
 * entry point and never touches the database.
 */
export async function requireSession() {
  const session = await getSession();
  if (!session)
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  return null;
}

export function fail(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: message }, { status });
}
