import { NextResponse } from "next/server";
import { z } from "zod";
import { denied, fail, requireWorkshop } from "@/lib/api";
import { addServiceItem } from "@/lib/case-db";

const Body = z.object({
  vehicleId: z.string().min(1),
  name: z.string().min(1),
  dueDate: z.iso.date().optional(),
  cost: z.number().nonnegative().optional(),
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

  const { vehicleId, ...pick } = parsed.data;
  try {
    return NextResponse.json(await addServiceItem(w.caseId, vehicleId, pick));
  } catch (e) {
    return fail(e);
  }
}
