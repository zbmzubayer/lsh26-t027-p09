import {
  buildCallList,
  type CallRow,
  type CallSort,
  type CaseData,
  currentKm,
  type EngineOpts,
  type ItemStatus,
  kmPerDay,
  type Owner,
  type Status,
  type Vehicle,
  vehicleStatuses,
} from "@/lib/engine";
import { lastVisitOf, pReturn } from "@/lib/visit";

/**
 * Everything the screens need, derived from the engine's own output. The engine
 * stays exactly as engine-check.ts pins it — this file only counts, groups and
 * totals what it already returns, so no screen can quietly rank on numbers the
 * fixtures never saw.
 */

export interface Counts {
  overdue: number;
  due_soon: number;
  fine: number;
}

export interface VehicleView {
  vehicle: Vehicle;
  owner: Owner;
  statuses: ItemStatus[];
  counts: Counts;
  worst: Status;
  currentKm: number;
  currentKmDate: string;
  rate: number;
  /** null when the vehicle has a single reading and is on the fleet median. */
  rateSpan: { from: string; to: string; days: number; km: number } | null;
  dueValue: number;
  score: number;
}

export interface WeekBucket {
  week: number; // 1-8
  start: string;
  end: string;
  jobs: number;
  value: number;
  items: JobRow[];
}

export interface JobRow {
  vehicleId: string;
  model: string;
  plate: string;
  owner: string;
  item: string;
  dueDate: string;
  status: Status;
  cost: number;
}

const UNKNOWN_OWNER = (id: string): Owner => ({
  id,
  name: "(unknown owner)",
  phone: "",
});

const worstOf = (c: Counts): Status =>
  c.overdue ? "overdue" : c.due_soon ? "due_soon" : "fine";

const countBy = (statuses: ItemStatus[]): Counts => ({
  overdue: statuses.filter((s) => s.status === "overdue").length,
  due_soon: statuses.filter((s) => s.status === "due_soon").length,
  fine: statuses.filter((s) => s.status === "fine").length,
});

const iso = (base: string, addDays: number) => {
  const [y, m, d] = base.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays)).toISOString().slice(0, 10);
};

export function analyse(
  data: CaseData,
  opts: EngineOpts,
  sort: CallSort = "score",
) {
  const ownersById = new Map(data.owners.map((o) => [o.id, o]));

  const vehicles: VehicleView[] = data.vehicles.map((v) => {
    const statuses = vehicleStatuses(v, data.today, opts);
    const counts = countBy(statuses);
    const readings = [...v.odometer_readings].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const first = opts.kmBasis === "last-two" ? readings.at(-2) : readings[0];
    const last = readings.at(-1);
    const days =
      first && last && first !== last
        ? Math.round(
            (Date.parse(last.date) - Date.parse(first.date)) / 86400000,
          )
        : 0;
    const due = statuses.filter((s) => s.status !== "fine");
    return {
      vehicle: v,
      owner: ownersById.get(v.owner_id) ?? UNKNOWN_OWNER(v.owner_id),
      statuses,
      counts,
      worst: worstOf(counts),
      currentKm: currentKm(v),
      currentKmDate: last?.date ?? data.today,
      rate: kmPerDay(v, opts.kmBasis),
      rateSpan:
        first && last && days > 0
          ? { from: first.date, to: last.date, days, km: last.km - first.km }
          : null,
      dueValue: due.reduce((s, x) => s + x.cost, 0),
      score: due.reduce((s, x) => s + x.score, 0),
    };
  });

  /**
   * P(this owner does NOT walk in unprompted within 30 days), from the hazard
   * in ml/return_model.py. Supplied to the engine rather than imported by it,
   * so the engine keeps knowing nothing about the model. A vehicle with no
   * recorded visit weighs 1: never seen is a reason to call, not to skip.
   */
  const wontReturn = (vehicleId: string) => {
    const v = data.vehicles.find((x) => x.id === vehicleId);
    const last = v ? lastVisitOf(v) : null;
    if (!last) return 1;
    const away = Math.max(
      0,
      Math.round((Date.parse(data.today) - Date.parse(last)) / 86400000),
    );
    const p = pReturn(away, 30);
    return p == null ? 1 : 1 - p;
  };

  const callList = buildCallList(data, sort, opts, wontReturn);
  const all = vehicles.flatMap((v) => v.statuses);
  const overdue = all.filter((s) => s.status === "overdue");
  const dueSoon = all.filter((s) => s.status === "due_soon");

  const totals = {
    items: all.length,
    owners: data.owners.length,
    vehicles: data.vehicles.length,
    overdue: overdue.length,
    due_soon: dueSoon.length,
    fine: all.length - overdue.length - dueSoon.length,
    overdueValue: overdue.reduce((s, x) => s + x.cost, 0),
    dueValue:
      overdue.reduce((s, x) => s + x.cost, 0) +
      dueSoon.reduce((s, x) => s + x.cost, 0),
    ownersToCall: new Set(callList.map((r) => r.owner.id)).size,
  };

  // 8 weekly buckets that keep their jobs, so a week can be opened and read
  const buckets: WeekBucket[] = Array.from({ length: 8 }, (_, i) => ({
    week: i + 1,
    start: iso(data.today, i * 7),
    end: iso(data.today, i * 7 + 6),
    jobs: 0,
    value: 0,
    items: [] as JobRow[],
  }));
  let backlogJobs = 0;
  let backlogValue = 0;
  for (const v of vehicles) {
    for (const s of v.statuses) {
      if (s.daysLeft < 0) {
        backlogJobs++;
        backlogValue += s.cost;
      } else if (s.daysLeft < 56) {
        const b = buckets[Math.floor(s.daysLeft / 7)];
        b.jobs++;
        b.value += s.cost;
        b.items.push({
          vehicleId: v.vehicle.id,
          model: v.vehicle.model,
          plate: v.vehicle.plate,
          owner: v.owner.name,
          item: s.item.name,
          dueDate: s.dueDate,
          status: s.status,
          cost: s.cost,
        });
      }
    }
  }
  for (const b of buckets)
    b.items.sort((a, z) => a.dueDate.localeCompare(z.dueDate));

  const workload = {
    buckets,
    backlog: { jobs: backlogJobs, value: backlogValue },
    totalJobs: buckets.reduce((s, b) => s + b.jobs, 0),
    totalValue: buckets.reduce((s, b) => s + b.value, 0),
    peak: Math.max(...buckets.map((b) => b.value), 0),
  };

  return {
    caseId: data.case_id,
    today: data.today,
    vehicles,
    callList,
    totals,
    workload,
  };
}

export type Analysis = ReturnType<typeof analyse>;
export type { CallRow };
