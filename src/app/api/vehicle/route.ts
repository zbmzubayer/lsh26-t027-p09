import { NextResponse } from "next/server";
import { z } from "zod";
import { denied, fail, requireWorkshop } from "@/lib/api";
import { intakeVehicle } from "@/lib/case-db";

const Item = z.object({
  name: z.string().min(1),
  dueDate: z.iso.date().optional(),
  cost: z.number().nonnegative().optional(),
});

const Body = z.object({
  customer: z.union([
    z.object({ existingId: z.string().min(1) }),
    z.object({ name: z.string().min(1), phone: z.string().regex(/^\d{11}$/) }),
  ]),
  model: z.string().min(1),
  plate: z.string().min(1),
  km: z.number().int().nonnegative(),
  items: z.array(Item).min(1),
});

/** Customer + car + first reading + service items, in one transaction. */
export async function POST(request: Request) {
  const w = await requireWorkshop();
  if (denied(w)) return w;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 },
    );

  try {
    const { vehicleId, data } = await intakeVehicle(w.caseId, parsed.data);
    // the id sits beside the case so CaseData keeps the published shape
    return NextResponse.json({ vehicleId, case: data });
  } catch (e) {
    return fail(e);
  }
}
