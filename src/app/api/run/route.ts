import { NextResponse } from "next/server";
import { z } from "zod";
import { CaseSchema } from "@/lib/case-schema";
import {
  buildCallList,
  buildForecast,
  type CaseData,
  vehicleStatuses,
} from "@/lib/engine";

/**
 * The judge's entry point: arbitrary JSON in, answers out. Stateless — it never
 * reads or writes the database, so a second case never needs storage, and it is
 * deliberately not behind the session cookie. The case shape is a trust
 * boundary, so it is parsed, not trusted.
 */
export async function POST(request: Request) {
  const parsed = CaseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: z.prettifyError(parsed.error) },
      { status: 400 },
    );

  const data = parsed.data as CaseData;
  return NextResponse.json({
    case_id: data.case_id,
    today: data.today,
    vehicles: data.vehicles.map((v) => ({
      vehicle_id: v.id,
      items: vehicleStatuses(v, data.today).map((s) => ({
        item: s.item.name,
        next_due: s.dueDate,
        days_left: Number.isFinite(s.daysLeft) ? s.daysLeft : null,
        status: s.status,
        reason: s.reason,
        score: Math.round(s.score),
      })),
    })),
    call_list: buildCallList(data).map((r, i) => ({
      rank: i + 1,
      owner_id: r.owner.id,
      owner: r.owner.name,
      phone: r.owner.phone,
      vehicle_id: r.vehicle.id,
      plate: r.vehicle.plate,
      score: Math.round(r.score),
      total_cost_bdt: r.totalCost.toFixed(2),
      composition: r.composition,
    })),
    workload: buildForecast(data),
  });
}
