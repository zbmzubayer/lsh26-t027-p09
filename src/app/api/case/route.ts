import { NextResponse } from "next/server";
import { denied, fail, requireWorkshop } from "@/lib/api";
import { CaseNotFound, loadCase } from "@/lib/case-db";

export async function GET() {
  const w = await requireWorkshop();
  if (denied(w)) return w;

  try {
    return NextResponse.json(await loadCase(w.caseId));
  } catch (e) {
    return fail(e, e instanceof CaseNotFound ? 404 : 500);
  }
}
