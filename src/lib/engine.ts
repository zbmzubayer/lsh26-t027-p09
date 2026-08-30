import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  parseISO,
} from "date-fns";

export type Rule = "fixed_date" | "period_months" | "distance_km";
export type Status = "overdue" | "due_soon" | "fine";

export interface Owner {
  id: string;
  name: string;
  phone: string;
}
export interface OdoReading {
  date: string;
  km: number;
}
export interface ServiceItem {
  name: string;
  rule: Rule;
  due_date?: string;
  every_months?: number;
  every_km?: number;
  cost_bdt: string;
}
export interface HistoryEntry {
  item: string;
  date: string;
  km: number | null;
  cost_bdt: string;
}
export interface Vehicle {
  id: string;
  owner_id: string;
  model: string;
  plate: string;
  odometer_readings: OdoReading[];
  service_items: ServiceItem[];
  service_history: HistoryEntry[];
}
export interface CaseData {
  case_id: string;
  today: string;
  owners: Owner[];
  vehicles: Vehicle[];
}

export const DUE_SOON_DAYS = 30;
/** Fallback when a vehicle has a single odometer reading (fleet median). */
export const FLEET_MEDIAN_KM_PER_DAY = 51;
/** Safety/legal items where overdue means a car that shouldn't be on the road. */
export const RISK_ITEMS = new Set([
  "brake pads",
  "tyres",
  "fitness certificate",
  "insurance",
]);
export const LATE_CAP_DAYS = 180;

/**
 * The three knobs the workshop can turn on the dashboard. The defaults are the
 * ones every fixture in engine-check.ts is pinned to, so passing nothing keeps
 * the published answers exactly as they are.
 */
export interface EngineOpts {
  /** How many days ahead still counts as "due soon". */
  dueSoonDays: number;
  /** Daily running measured over every reading, or just the last two. */
  kmBasis: "span" | "last-two";
  /** Whether safety/legal items get the 1.5x bump. */
  riskWeights: boolean;
}
export const DEFAULT_OPTS: EngineOpts = {
  dueSoonDays: DUE_SOON_DAYS,
  kmBasis: "span",
  riskWeights: true,
};

export interface ItemStatus {
  vehicleId: string;
  item: ServiceItem;
  cost: number;
  dueDate: string; // yyyy-MM-dd (estimated for distance items), "—" if never
  daysLeft: number; // negative = overdue by that many days; Infinity = never due
  status: Status;
  reason: string;
  urgency: number;
  risk: number;
  score: number; // cost × urgency × risk
}

const sortedReadings = (v: Vehicle) =>
  [...v.odometer_readings].sort((a, b) => a.date.localeCompare(b.date));

export const currentKm = (v: Vehicle) => sortedReadings(v).at(-1)?.km ?? 0;

/** Average km/day over the vehicle's readings; 0 means no usage. */
export function kmPerDay(
  v: Vehicle,
  basis: EngineOpts["kmBasis"] = "span",
): number {
  const r = sortedReadings(v);
  const first = basis === "last-two" ? r.at(-2) : r[0];
  const last = r.at(-1);
  if (!first || !last || first === last) return FLEET_MEDIAN_KM_PER_DAY;
  const days = differenceInCalendarDays(
    parseISO(last.date),
    parseISO(first.date),
  );
  if (days <= 0) return FLEET_MEDIAN_KM_PER_DAY;
  return (last.km - first.km) / days;
}

/** Latest service_history entry for an item, by date. */
export function lastDone(
  v: Vehicle,
  itemName: string,
): HistoryEntry | undefined {
  return v.service_history
    .filter((h) => h.item === itemName)
    .sort((a, b) => a.date.localeCompare(b.date))
    .at(-1);
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");
// en-US grouping throughout: the screens format money the same way, and a
// reason reading "1,38,632 km" beside a cost column reading "32,000" looks broken
const num = (n: number) => Math.round(n).toLocaleString("en-US");
export const bdt = (n: number) => `৳${num(n)}`;

/**
 * Urgency band: overdue 1.00–7.00 (saturates at 180 days late),
 * due soon 0.00–0.50, fine 0. The two ranges never overlap, so any
 * overdue item outranks a due-soon item of the same cost by ≥2×.
 */
export function urgencyOf(
  status: Status,
  daysLeft: number,
  dueSoonDays: number = DUE_SOON_DAYS,
): number {
  // the overdue band always divides by 30 so that widening the due-soon window
  // re-labels items without silently re-scaling how late everything already is
  if (status === "overdue")
    return 1 + Math.min(-daysLeft, LATE_CAP_DAYS) / DUE_SOON_DAYS;
  if (status === "due_soon") return 0.5 * (1 - daysLeft / dueSoonDays);
  return 0;
}

export function computeItem(
  v: Vehicle,
  item: ServiceItem,
  today: string,
  opts: EngineOpts = DEFAULT_OPTS,
): ItemStatus {
  const todayDate = parseISO(today);
  const cost = Number(item.cost_bdt);
  const risk =
    opts.riskWeights && RISK_ITEMS.has(item.name.toLowerCase()) ? 1.5 : 1;
  let dueDate: Date;
  let reason: string;

  if (item.rule === "fixed_date") {
    dueDate = parseISO(item.due_date ?? today);
    reason = `fixed date on the paper: ${item.due_date}`;
  } else if (item.rule === "period_months") {
    const last = lastDone(v, item.name);
    const base = last?.date ?? sortedReadings(v)[0]?.date ?? today;
    dueDate = addMonths(parseISO(base), item.every_months ?? 0);
    reason = last
      ? `last done ${last.date}, every ${item.every_months} months`
      : `no history — anchored on first reading ${base}, every ${item.every_months} months`;
  } else {
    const last = lastDone(v, item.name);
    const every = item.every_km ?? 0;
    const nowKm = currentKm(v);
    // With no past service to count from, count from the odometer we do have.
    // Falling back to 0 would put the due point at `every_km` absolute — on a
    // car already reading 139,157 km that is ~2,000 days "overdue" and it would
    // head the call list. Every seeded distance item has exactly one history
    // row, so this branch only fires on a vehicle entered by hand.
    const startKm = last?.km ?? nowKm;
    const dueKm = startKm + every;
    const rate = kmPerDay(v, opts.kmBasis);
    if (rate <= 0) {
      // no usage: the item can never come due — report it, don't divide
      return {
        vehicleId: v.id,
        item,
        cost,
        dueDate: "—",
        daysLeft: Number.POSITIVE_INFINITY,
        status: "fine",
        reason: `no usage recorded (0 km/day) — due at ${num(dueKm)} km, cannot come due`,
        urgency: 0,
        risk,
        score: 0,
      };
    }
    const daysToDue = Math.round((dueKm - nowKm) / rate);
    dueDate = addDays(todayDate, daysToDue);
    const from = last
      ? `last done at ${num(last.km ?? 0)} km`
      : `no history — counted from the current reading at ${num(startKm)} km`;
    reason =
      dueKm >= nowKm
        ? `${from}, every ${num(every)} km → due at ${num(dueKm)} km, now ${num(nowKm)} — ${num(dueKm - nowKm)} km left at ${rate.toFixed(1)} km/day`
        : `${from}, every ${num(every)} km → due at ${num(dueKm)} km, now ${num(nowKm)} — ${num(nowKm - dueKm)} km past, at ${rate.toFixed(1)} km/day`;
  }

  const daysLeft = differenceInCalendarDays(dueDate, todayDate);
  const status: Status =
    daysLeft < 0
      ? "overdue"
      : daysLeft <= opts.dueSoonDays
        ? "due_soon"
        : "fine";
  const urgency = urgencyOf(status, daysLeft, opts.dueSoonDays);
  return {
    vehicleId: v.id,
    item,
    cost,
    dueDate: iso(dueDate),
    daysLeft,
    status,
    reason,
    urgency,
    risk,
    score: cost * urgency * risk,
  };
}

export const vehicleStatuses = (
  v: Vehicle,
  today: string,
  opts: EngineOpts = DEFAULT_OPTS,
) => v.service_items.map((it) => computeItem(v, it, today, opts));

export type CallSort = "score" | "most_overdue" | "highest_value";

export interface CallRow {
  owner: Owner;
  vehicle: Vehicle;
  items: ItemStatus[]; // non-fine, highest score first
  score: number;
  worstDaysLeft: number;
  totalCost: number;
  composition: string; // the arithmetic behind the score, e.g. "Tyres 32,000 × 1.97 × 1.5 = 94,400 + oil 19,250"
}

/**
 * Daily call list, one row per owner+vehicle. Default rule: taka of work
 * at risk, weighted by how late it is, with a 1.5× bump for safety/legal
 * items (brake pads, tyres, fitness certificate, insurance).
 */
export function buildCallList(
  data: CaseData,
  sort: CallSort = "score",
  opts: EngineOpts = DEFAULT_OPTS,
): CallRow[] {
  const rows: CallRow[] = [];
  for (const v of data.vehicles) {
    const due = vehicleStatuses(v, data.today, opts)
      .filter((s) => s.status !== "fine")
      .sort((a, b) => b.score - a.score);
    if (!due.length) continue;
    const owner = data.owners.find((o) => o.id === v.owner_id);
    if (!owner) continue;
    const lead = due[0];
    const composition = [
      `${lead.item.name} ${num(lead.cost)} × ${lead.urgency.toFixed(2)} × ${lead.risk} = ${num(lead.score)}`,
      ...due.slice(1).map((s) => `+ ${s.item.name} ${num(s.score)}`),
    ].join(" ");
    rows.push({
      owner,
      vehicle: v,
      items: due,
      score: due.reduce((sum, s) => sum + s.score, 0),
      worstDaysLeft: Math.min(...due.map((s) => s.daysLeft)),
      totalCost: due.reduce((sum, s) => sum + s.cost, 0),
      composition,
    });
  }
  const cmp: Record<CallSort, (a: CallRow, b: CallRow) => number> = {
    score: (a, b) => b.score - a.score,
    most_overdue: (a, b) => a.worstDaysLeft - b.worstDaysLeft,
    highest_value: (a, b) => b.totalCost - a.totalCost,
  };
  return rows.sort(cmp[sort]);
}

export interface ForecastWeek {
  label: string;
  start: string;
  end: string;
  count: number;
  cost: number;
}

/** Overdue backlog + item counts/value per week for the next 8 weeks. */
export function buildForecast(
  data: CaseData,
  opts: EngineOpts = DEFAULT_OPTS,
): {
  backlog: ForecastWeek;
  weeks: ForecastWeek[];
} {
  const todayDate = parseISO(data.today);
  const all = data.vehicles.flatMap((v) =>
    vehicleStatuses(v, data.today, opts),
  );
  const backlog: ForecastWeek = {
    label: "Overdue",
    start: "",
    end: data.today,
    count: 0,
    cost: 0,
  };
  const weeks: ForecastWeek[] = Array.from({ length: 8 }, (_, i) => ({
    label: `Wk ${i + 1}`,
    start: iso(addDays(todayDate, i * 7)),
    end: iso(addDays(todayDate, i * 7 + 6)),
    count: 0,
    cost: 0,
  }));
  for (const s of all) {
    if (s.daysLeft < 0) {
      backlog.count++;
      backlog.cost += s.cost;
    } else if (s.daysLeft < 56) {
      const w = weeks[Math.floor(s.daysLeft / 7)];
      w.count++;
      w.cost += s.cost;
    }
  }
  return { backlog, weeks };
}

/** Copy-ready reminder for one owner, all their vehicles, items oldest first. */
export function reminderMessage(
  data: CaseData,
  ownerId: string,
  opts: EngineOpts = DEFAULT_OPTS,
): string {
  const owner = data.owners.find((o) => o.id === ownerId);
  if (!owner) return "";
  const lines: string[] = [];
  let total = 0;
  for (const v of data.vehicles.filter((v) => v.owner_id === ownerId)) {
    const due = vehicleStatuses(v, data.today, opts)
      .filter((s) => s.status !== "fine")
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!due.length) continue;
    lines.push(
      lines.length
        ? `Your ${v.model} (${v.plate}) is also due for:`
        : `Assalamu alaikum ${owner.name}. Your ${v.model} (${v.plate}) is due for:`,
    );
    for (const s of due) {
      const when =
        s.daysLeft < 0
          ? `overdue by ${-s.daysLeft} days`
          : s.daysLeft === 0
            ? "due today"
            : `due in ${s.daysLeft} days`;
      lines.push(` • ${s.item.name} — ${when} — ${bdt(s.cost)}`);
      total += s.cost;
    }
  }
  if (!lines.length) return "";
  lines.push(`Estimated total ${bdt(total)}. Reply or call to book a slot.`);
  return lines.join("\n");
}

/* ---------- mutations (return a new CaseData, state stays in React) ---------- */

/**
 * Record a completed service: resets that one item only.
 * distance_km items require a km; a km above the last reading also
 * appends an odometer reading dated the same day.
 */
export function recordService(
  data: CaseData,
  vehicleId: string,
  itemName: string,
  date?: string,
  km?: number,
): CaseData {
  const when = date ?? data.today;
  return {
    ...data,
    vehicles: data.vehicles.map((v) => {
      if (v.id !== vehicleId) return v;
      const item = v.service_items.find((i) => i.name === itemName);
      if (!item) return v;
      if (item.rule === "distance_km" && km == null)
        throw new Error(`${itemName} is distance-based and needs a km`);
      return {
        ...v,
        // ponytail: fixed_date renewal (+12 months) isn't in the guide, but without
        // it "mark done" on insurance/fitness would visibly do nothing
        service_items: v.service_items.map((i) =>
          i === item && i.rule === "fixed_date"
            ? { ...i, due_date: iso(addMonths(parseISO(when), 12)) }
            : i,
        ),
        odometer_readings:
          km != null && km > currentKm(v)
            ? [...v.odometer_readings, { date: when, km }]
            : v.odometer_readings,
        service_history: [
          ...v.service_history,
          {
            item: itemName,
            date: when,
            km: km ?? null,
            cost_bdt: item.cost_bdt,
          },
        ],
      };
    }),
  };
}

/** Add a new odometer reading dated today; distance estimates recompute automatically. */
export function addOdometerReading(
  data: CaseData,
  vehicleId: string,
  km: number,
): CaseData {
  return {
    ...data,
    vehicles: data.vehicles.map((v) =>
      v.id === vehicleId
        ? {
            ...v,
            odometer_readings: [
              ...v.odometer_readings.filter((r) => r.date !== data.today),
              { date: data.today, km },
            ],
          }
        : v,
    ),
  };
}
