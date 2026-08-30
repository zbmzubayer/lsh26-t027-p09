import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import model from "../data/visit-predictions.json";
import {
  type CaseData,
  DEFAULT_OPTS,
  type EngineOpts,
  type Vehicle,
  vehicleStatuses,
} from "./engine";

/**
 * The behavioural half of the due book.
 *
 * engine.ts answers "when is this item due" — a rule, and in this fixture a
 * deterministic one. It cannot answer "when will the customer actually turn
 * up", which is the only quantity in these cases that genuinely varies — every
 * cost, interval and km/day in them is a constant. A random forest fitted on
 * the 1,549 observed inter-visit gaps across all 25 workshops in the database
 * (ml/visit_model.py) beats "always guess the fleet median" by 21 days of MAE
 * under leave-one-CASE-out CV — scored on a workshop it has never seen — and
 * 0 of 12 shuffled-label refits matched it.
 *
 * The model ships as a lookup table — a predicted gap for each of the twelve
 * months — so recording a service re-predicts through an array index and no
 * Python runs at request time. Regenerate with `npm run ml`.
 */

export interface VisitModel {
  source: string;
  metrics: {
    n_gaps: number;
    n_cases: number;
    cv: string;
    max_depth: number;
    baseline_mae_days: number;
    model_mae_days: number;
    permuted_mae_days: number;
    permutations_beating_model: number;
  };
  interval_days: { p10: number; p90: number };
  /**
   * Discrete-time hazard of a return, by 30-day bucket of elapsed absence.
   * Fitted on completed gaps *and* the still-open spells the point model has to
   * discard — see ml/return_model.py. Optional so an older table still loads.
   */
  return_hazard?: {
    bucket_days: number;
    hazard: number[];
    metrics: {
      model_brier: number;
      baseline_brier: number;
      n_person_periods: number;
      n_censored_spells: number;
      flat_rate: number;
    };
  };
  /**
   * Keyed by case first: vehicle ids are only unique within a case, so `V01`
   * exists in all 25 of them. Flattening this would silently hand one workshop
   * another workshop's prediction.
   */
  cases: Record<
    string,
    Record<string, { last_visit: string; gap_by_month: number[] }>
  >;
}

export const VISIT_MODEL = model as VisitModel;

/** Fleet median gap, used when a vehicle has no history for the model to stand on. */
export const FALLBACK_GAP_DAYS = 84;

export interface VisitPrediction {
  vehicleId: string;
  lastVisit: string | null;
  /** Days the model expects between the last visit and the next one. */
  predictedGapDays: number;
  /** yyyy-MM-dd, never earlier than today. */
  predictedVisit: string;
  /** 80% interval from the held-out CV residuals, not the training fit. */
  windowFrom: string;
  windowTo: string;
  /** Earliest due date the engine computed for this vehicle, "—" if nothing is dated. */
  earliestDue: string | null;
  /** predictedVisit − earliestDue. Positive means they drift in after it is due. */
  driftDays: number;
  /** They will not come back before something on this car is already due. */
  willDrift: boolean;
  /** Days since their last visit, which is what the hazard conditions on. */
  daysAway: number | null;
  /** P(they walk in on their own within 30 / 60 days). Null pre-dates the table. */
  pReturn30: number | null;
  pReturn60: number | null;
  /** Where the number came from — shown in the UI so a stale tunnel is visible. */
  basis: string;
  reason: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Distinct service dates are visits; several items on one date is one visit. */
export const lastVisitOf = (v: Vehicle): string | null =>
  v.service_history
    .map((h) => h.date)
    .sort()
    .at(-1) ?? null;

/**
 * Joins a predicted gap onto the engine's due dates. Split out from
 * `predictVisit` so the bundled lookup and the live FastAPI service produce a
 * byte-identical shape — the UI must not be able to tell which one answered.
 */
export function joinPrediction(
  v: Vehicle,
  today: string,
  gap: number,
  basis: string,
  opts: EngineOpts = DEFAULT_OPTS,
  m: VisitModel = VISIT_MODEL,
): VisitPrediction {
  const lastVisit = lastVisitOf(v);

  // The last visit of every vehicle is right-censored: we know they have not
  // come back yet, so a gap that lands in the past only tells us "overdue a
  // visit", never a date. Clamp to today rather than predict backwards.
  const raw = addDays(parseISO(lastVisit ?? today), gap);
  const predicted = raw < parseISO(today) ? parseISO(today) : raw;

  const dated = vehicleStatuses(v, today, opts)
    .map((s) => s.dueDate)
    .filter((x) => x !== "\u2014")
    .sort();
  const earliestDue = dated[0] ?? null;
  // what the hazard conditions on: how long they have already stayed away
  const daysAway = lastVisit
    ? differenceInCalendarDays(parseISO(today), parseISO(lastVisit))
    : null;
  const driftDays = earliestDue
    ? differenceInCalendarDays(predicted, parseISO(earliestDue))
    : 0;

  return {
    vehicleId: v.id,
    lastVisit,
    predictedGapDays: gap,
    predictedVisit: iso(predicted),
    windowFrom: iso(addDays(predicted, m.interval_days.p10)),
    windowTo: iso(addDays(predicted, m.interval_days.p90)),
    earliestDue,
    driftDays,
    willDrift: driftDays > 0,
    daysAway,
    pReturn30: pReturn(daysAway ?? 0, 30, m),
    pReturn60: pReturn(daysAway ?? 0, 60, m),
    basis,
    reason: !lastVisit
      ? `no service history, assuming the fleet median of ${FALLBACK_GAP_DAYS} days`
      : driftDays > 0
        ? `last in ${lastVisit}, typically back after ${gap} days \u2014 that is ${driftDays} days past ${earliestDue}, so call them`
        : `last in ${lastVisit}, typically back after ${gap} days \u2014 arrives before ${earliestDue} on their own`,
  };
}

/**
 * Prediction from the bundled lookup table. No network, always available.
 *
 * `caseId` scopes the lookup, and is not optional. Vehicle ids are unique only
 * within a case — PUB-02's V01 is a different car from PUB-01's — and the
 * per-vehicle curves differ by more than the model's own MAE, so serving one
 * workshop another workshop's curve is not a rounding error. A workshop the
 * model has never been trained on drops to the fleet median and says so, rather
 * than showing a confident wrong date.
 */
export function predictVisit(
  v: Vehicle,
  today: string,
  caseId: string,
  opts: EngineOpts = DEFAULT_OPTS,
  m: VisitModel = VISIT_MODEL,
): VisitPrediction {
  const lastVisit = lastVisitOf(v);
  const known = m.cases[caseId];
  const row = known?.[v.id];
  const gap =
    lastVisit && row
      ? row.gap_by_month[parseISO(lastVisit).getMonth()]
      : FALLBACK_GAP_DAYS;
  const basis = !known
    ? `fleet median — ${caseId} was not in the model's training set`
    : lastVisit && row
      ? `bundled model, last visit ${lastVisit}`
      : "fleet median — no service history for this vehicle";
  return joinPrediction(v, today, gap, basis, opts, m);
}

/**
 * Vehicles that are due AND will not come back on their own, worst drift first.
 * This is the list the phone actually changes: everything else walks in anyway.
 */
export function driftList(
  data: CaseData,
  opts: EngineOpts = DEFAULT_OPTS,
  m: VisitModel = VISIT_MODEL,
): VisitPrediction[] {
  return data.vehicles
    .map((v) => predictVisit(v, data.today, data.case_id, opts, m))
    .filter((p) => p.willDrift)
    .sort((a, b) => b.driftDays - a.driftDays);
}

/**
 * P(a visit within `horizonDays`, given they are already `elapsedDays` away).
 *
 * Mirrors `p_return` in ml/return_model.py exactly — survival across the
 * buckets the horizon covers, with partial buckets prorated so a 14-day
 * question is not silently rounded up to 30. Kept in TypeScript as well as
 * Python so the offline fallback answers the same question as the tunnel;
 * src/lib/visit-check.ts asserts the two agree.
 */
export function pReturn(
  elapsedDays: number,
  horizonDays: number,
  m: VisitModel = VISIT_MODEL,
): number | null {
  const hz = m.return_hazard;
  if (!hz || horizonDays <= 0) return null;
  const { hazard, bucket_days: bucket } = hz;
  const last = hazard.length - 1;
  let survive = 1;
  let pos = elapsedDays;
  const end = elapsedDays + horizonDays;
  let k = Math.min(Math.floor(pos / bucket), last);
  while (pos < end) {
    const edge = k < last ? Math.min((k + 1) * bucket, end) : end;
    survive *= (1 - hazard[k]) ** ((edge - pos) / bucket);
    pos = edge;
    k = Math.min(k + 1, last);
  }
  return Math.round((1 - survive) * 10000) / 10000;
}
