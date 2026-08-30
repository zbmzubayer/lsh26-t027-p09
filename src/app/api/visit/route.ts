import { NextResponse } from "next/server";
import { z } from "zod";
import { ENV_PRIVATE } from "@/config/env-private";
import { denied, fail, requireWorkshop } from "@/lib/api";
import { loadCase } from "@/lib/case-db";
import type { Vehicle } from "@/lib/engine";
import {
  joinPrediction,
  predictVisit,
  VISIT_MODEL,
  type VisitPrediction,
} from "@/lib/visit";

/**
 * "When will this customer next turn up?" for one vehicle, or for every vehicle
 * an owner has.
 *
 * The model lives in a FastAPI process behind an ngrok tunnel (ml/serve.py). A
 * tunnel is not something to bet a demo on, so this route treats it as an
 * optimisation, not a dependency: if ML_URL is unset, slow, or down, it answers
 * from the lookup table bundled in src/data and reports which one it used. The
 * button on the vehicle page therefore always returns a date.
 */

const Body = z
  .object({
    vehicleId: z.string().min(1).optional(),
    ownerId: z.string().min(1).optional(),
  })
  .refine((b) => Boolean(b.vehicleId) !== Boolean(b.ownerId), {
    message: "Pass exactly one of vehicleId or ownerId",
  });

const LIVE_TIMEOUT_MS = 5000;

const LiveResponse = z.object({
  predictions: z.array(
    z.object({
      vehicle_id: z.string(),
      predicted_gap_days: z.number().int(),
      basis: z.string(),
    }),
  ),
});

/**
 * Only what the model actually reads. It derives its nine features from the
 * odometer, the fitted items and the service history; `plate`, `model` and
 * `owner_id` are never looked at. The service is reached over a public ngrok
 * URL, so sending registration numbers it ignores is cost with no benefit.
 */
const forTheModel = (v: Vehicle) => ({
  id: v.id,
  odometer_readings: v.odometer_readings,
  service_items: v.service_items,
  service_history: v.service_history,
});

/** Returns null on any failure — an unreachable tunnel is expected, not an error. */
async function live(
  vehicles: Vehicle[],
  today: string,
): Promise<Map<string, { gap: number; basis: string }> | null> {
  if (!ENV_PRIVATE.ML_URL) return null;
  try {
    const res = await fetch(`${ENV_PRIVATE.ML_URL}/predict`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        // ngrok's free tier serves an HTML interstitial to anything that looks
        // like a browser; this header is what makes it return the JSON.
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify({ today, vehicles: vehicles.map(forTheModel) }),
      signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const parsed = LiveResponse.safeParse(await res.json());
    if (!parsed.success) return null;
    return new Map(
      parsed.data.predictions.map((p) => [
        p.vehicle_id,
        { gap: p.predicted_gap_days, basis: `live model — ${p.basis}` },
      ]),
    );
  } catch {
    return null;
  }
}

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
    const data = await loadCase(w.caseId);
    const { vehicleId, ownerId } = parsed.data;
    const vehicles = data.vehicles.filter((v) =>
      vehicleId ? v.id === vehicleId : v.owner_id === ownerId,
    );
    if (!vehicles.length)
      return NextResponse.json({ error: "No such vehicle" }, { status: 404 });

    const gaps = await live(vehicles, data.today);
    const predictions: VisitPrediction[] = vehicles.map((v) => {
      const hit = gaps?.get(v.id);
      return hit
        ? joinPrediction(v, data.today, hit.gap, hit.basis)
        : predictVisit(v, data.today, data.case_id);
    });

    return NextResponse.json({
      today: data.today,
      source: gaps ? "live" : "bundled",
      note: gaps
        ? undefined
        : ENV_PRIVATE.ML_URL
          ? "Model service unreachable — answered from the bundled model."
          : "ML_URL not set — answered from the bundled model.",
      metrics: VISIT_MODEL.metrics,
      intervalDays: VISIT_MODEL.interval_days,
      predictions: predictions.map((p) => {
        const v = vehicles.find((x) => x.id === p.vehicleId);
        const owner = data.owners.find((o) => o.id === v?.owner_id);
        return {
          ...p,
          plate: v?.plate ?? "",
          model: v?.model ?? "",
          ownerId: owner?.id ?? "",
          owner: owner?.name ?? "",
          phone: owner?.phone ?? "",
        };
      }),
    });
  } catch (e) {
    return fail(e);
  }
}
