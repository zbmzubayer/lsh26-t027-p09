import {
  type CaseData,
  DEFAULT_OPTS,
  type EngineOpts,
  vehicleStatuses,
} from "@/lib/engine";
import { lastVisitOf, pReturn } from "@/lib/visit";

/**
 * The 8-week workload bars show work that is *due*. This says what will
 * actually land.
 *
 * Those are different numbers and the gap is the point: a due date is a
 * property of the car, but the job only happens when the owner turns up, and
 * the hazard in ml/return_model.py says most of them will not turn up soon.
 * The deterministic bar quietly claims everyone arrives on their due date. This
 * is what to staff for.
 *
 * No new model. It draws visit dates from the same hazard the call list ranks
 * on, and uses the rule engine for what gets done once they arrive — the
 * "earliest next due" heuristic, measured at 87.2% top-1 in plans/ML-PLAN.md,
 * which holds because 2,588 of 2,600 visits in this data are a single item.
 */

const HORIZON_DAYS = 56;
const WEEKS = 8;

/**
 * Seeded so the same case always draws the same forecast. `today` is a case
 * field precisely so results are reproducible; a chart that reshuffled on every
 * render would throw that away.
 */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dayOf = (iso: string) => Date.parse(iso) / 86400000;
const isoAt = (today: string, offset: number) =>
  new Date((dayOf(today) + offset) * 86400000).toISOString().slice(0, 10);

/** Each vehicle that could turn up, with how long it has been away and the job it would get. */
interface Candidate {
  daysAway: number;
  /** Cost of the item the rule engine says is next — one visit, one item. */
  cost: number;
}

function candidates(data: CaseData, opts: EngineOpts): Candidate[] {
  const out: Candidate[] = [];
  for (const v of data.vehicles) {
    const last = lastVisitOf(v);
    if (!last) continue; // never seen: no absence to measure, so no draw
    const statuses = vehicleStatuses(v, data.today, opts)
      .filter((s) => Number.isFinite(s.daysLeft))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!statuses.length) continue;
    out.push({
      daysAway: Math.max(0, Math.round(dayOf(data.today) - dayOf(last))),
      cost: statuses[0].cost,
    });
  }
  return out;
}

/**
 * The day within the horizon this vehicle turns up, or null.
 *
 * Inverts the return CDF: `pReturn(away, t)` is P(visit within t days), so a
 * uniform draw above P(visit within 56) means they do not come at all, and
 * otherwise the smallest t whose CDF covers the draw is the day. Reusing the
 * audited function rather than re-deriving survival keeps one formula.
 */
function drawVisitDay(daysAway: number, u: number): number | null {
  const total = pReturn(daysAway, HORIZON_DAYS);
  if (total == null || u > total) return null;
  let lo = 1;
  let hi = HORIZON_DAYS;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((pReturn(daysAway, mid) ?? 0) >= u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export interface SimWeek {
  week: number;
  start: string;
  end: string;
  /** Work whose due date lands in this week — what the deterministic bar shows. */
  dueJobs: number;
  dueValue: number;
  /** Work expected to actually arrive: mean over the draws. */
  expJobs: number;
  expValue: number;
  /** 10th-90th percentile of the drawn value, i.e. what to staff between. */
  p10Value: number;
  p90Value: number;
}

export interface SimResult {
  weeks: SimWeek[];
  draws: number;
  /** Vehicles with no service history, which have no absence to draw from. */
  skipped: number;
  totals: {
    dueJobs: number;
    dueValue: number;
    expJobs: number;
    expValue: number;
  };
}

export function simulateWorkload(
  data: CaseData,
  opts: EngineOpts = DEFAULT_OPTS,
  draws = 200,
  seed = 20260830,
): SimResult {
  const cands = candidates(data, opts);
  const skipped = data.vehicles.length - cands.length;

  // What the existing bars claim: everything arrives exactly when it is due.
  const dueJobs = new Array(WEEKS).fill(0);
  const dueValue = new Array(WEEKS).fill(0);
  for (const v of data.vehicles)
    for (const s of vehicleStatuses(v, data.today, opts))
      if (s.daysLeft >= 0 && s.daysLeft < HORIZON_DAYS) {
        const w = Math.floor(s.daysLeft / 7);
        dueJobs[w]++;
        dueValue[w] += s.cost;
      }

  const rand = mulberry32(seed);
  const jobDraws: number[][] = Array.from({ length: WEEKS }, () => []);
  const valDraws: number[][] = Array.from({ length: WEEKS }, () => []);

  for (let d = 0; d < draws; d++) {
    const j = new Array(WEEKS).fill(0);
    const val = new Array(WEEKS).fill(0);
    for (const c of cands) {
      const day = drawVisitDay(c.daysAway, rand());
      if (day == null) continue;
      const w = Math.min(Math.floor((day - 1) / 7), WEEKS - 1);
      j[w]++;
      val[w] += c.cost;
    }
    for (let w = 0; w < WEEKS; w++) {
      jobDraws[w].push(j[w]);
      valDraws[w].push(val[w]);
    }
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const pct = (xs: number[], q: number) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  };

  const weeks: SimWeek[] = Array.from({ length: WEEKS }, (_, w) => ({
    week: w + 1,
    start: isoAt(data.today, w * 7),
    end: isoAt(data.today, w * 7 + 6),
    dueJobs: dueJobs[w],
    dueValue: dueValue[w],
    expJobs: Math.round(mean(jobDraws[w]) * 10) / 10,
    expValue: Math.round(mean(valDraws[w])),
    p10Value: pct(valDraws[w], 0.1),
    p90Value: pct(valDraws[w], 0.9),
  }));

  return {
    weeks,
    draws,
    skipped,
    totals: {
      dueJobs: dueJobs.reduce((a, b) => a + b, 0),
      dueValue: dueValue.reduce((a, b) => a + b, 0),
      expJobs: Math.round(weeks.reduce((a, w) => a + w.expJobs, 0) * 10) / 10,
      expValue: weeks.reduce((a, w) => a + w.expValue, 0),
    },
  };
}
