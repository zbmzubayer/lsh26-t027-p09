import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAnswers } from "@/lib/answers";
import { CaseSchema } from "@/lib/case-schema";
import type { CaseData } from "@/lib/engine";

/**
 * The judge's entry point: arbitrary JSON in, answers out. Stateless — it never
 * reads or writes the database, so a second case never needs storage, and it is
 * deliberately not behind the session cookie. The case shape is a trust
 * boundary, so it is parsed, not trusted.
 *
 * The answers themselves are built by buildAnswers() so that this route and the
 * `npm run cases` CLI cannot give different results for the same file.
 */
export async function POST(request: Request) {
  const parsed = CaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 },
    );

  return NextResponse.json(buildAnswers(parsed.data as CaseData));
}
