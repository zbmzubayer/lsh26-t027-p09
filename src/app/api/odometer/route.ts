import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, requireSession } from "@/lib/api";
import { addOdometerReadingDb } from "@/lib/case-db";

const Body = z.object({
  caseId: z.string().min(1),
  vehicleId: z.string().min(1),
  km: z.number().int().nonnegative(),
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

  const { caseId, vehicleId, km } = parsed.data;
  try {
    return NextResponse.json(await addOdometerReadingDb(caseId, vehicleId, km));
  } catch (e) {
    return fail(e);
  }
}
