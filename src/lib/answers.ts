import {
  buildCallList,
  buildForecast,
  type CaseData,
  DEFAULT_OPTS,
  type EngineOpts,
  vehicleStatuses,
} from "./engine";

/**
 * The answers for a whole case, in the shape `/api/run` returns.
 *
 * Lives here rather than in the route so the HTTP entry point and the CLI
 * runner cannot drift apart — a judge piping a case file through
 * `npm run cases` must get byte-identical output to POSTing it.
 */
export function buildAnswers(data: CaseData, opts: EngineOpts = DEFAULT_OPTS) {
  return {
    case_id: data.case_id,
    today: data.today,
    vehicles: data.vehicles.map((v) => ({
      vehicle_id: v.id,
      items: vehicleStatuses(v, data.today, opts).map((s) => ({
        item: s.item.name,
        next_due: s.dueDate,
        days_left: Number.isFinite(s.daysLeft) ? s.daysLeft : null,
        status: s.status,
        reason: s.reason,
        score: Math.round(s.score),
      })),
    })),
    call_list: buildCallList(data, "score", opts).map((r, i) => ({
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
    workload: buildForecast(data, opts),
  };
}
