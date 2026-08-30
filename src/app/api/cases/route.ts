import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { listCases } from "@/lib/case-db";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  return NextResponse.json(await listCases());
}
