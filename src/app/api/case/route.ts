import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { fail, requireSession } from "@/lib/api";
import { CaseNotFound, loadCase } from "@/lib/case-db";

export async function GET(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;

  const caseId = request.nextUrl.searchParams.get("caseId") ?? "PUB-01";
  try {
    return NextResponse.json(await loadCase(caseId));
  } catch (e) {
    return fail(e, e instanceof CaseNotFound ? 404 : 500);
  }
}
