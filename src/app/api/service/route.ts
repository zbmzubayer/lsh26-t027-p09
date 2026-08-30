import { NextResponse } from "next/server";
import { z } from "zod";
import { denied, fail, requireWorkshop } from "@/lib/api";
import { recordServiceDb } from "@/lib/case-db";

const Body = z.object({
  vehicleId: z.string().min(1),
  itemName: z.string().min(1),
  date: z.iso.date().optional(),
  km: z.number().int().nonnegative().optional(),
});

export async function POST(request: Request) {
  const w = await requireWorkshop();
  if (denied(w)) return w;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 },
    );

  const { vehicleId, itemName, date, km } = parsed.data;
  try {
    // returns the freshly re-assembled case, so the UI has one read path
    return NextResponse.json(
      await recordServiceDb(w.caseId, vehicleId, itemName, date, km),
    );
  } catch (e) {
    return fail(e);
  }
}
