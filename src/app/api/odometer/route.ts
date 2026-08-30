import { NextResponse } from "next/server";
import { z } from "zod";
import { denied, fail, requireWorkshop } from "@/lib/api";
import { addOdometerReadingDb } from "@/lib/case-db";

const Body = z.object({
  vehicleId: z.string().min(1),
  km: z.number().int().nonnegative(),
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

  const { vehicleId, km } = parsed.data;
  try {
    return NextResponse.json(
      await addOdometerReadingDb(w.caseId, vehicleId, km),
    );
  } catch (e) {
    return fail(e);
  }
}
