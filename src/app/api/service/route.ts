import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, requireSession } from "@/lib/api";
import { recordServiceDb } from "@/lib/case-db";

const Body = z.object({
  caseId: z.string().min(1),
  vehicleId: z.string().min(1),
  itemName: z.string().min(1),
  date: z.iso.date().optional(),
  km: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 },
    );

  const { caseId, vehicleId, itemName, date, km } = parsed.data;
  try {
    // returns the freshly re-assembled case, so the UI has one read path
    return NextResponse.json(
      await recordServiceDb(caseId, vehicleId, itemName, date, km),
    );
  } catch (e) {
    return fail(e);
  }
}
