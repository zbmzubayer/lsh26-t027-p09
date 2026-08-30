import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import model from "../data/visit-predictions-pub-01.json";
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
 * up", which is the only quantity in PUB-01 that genuinely varies: 56 observed
 * inter-visit gaps, mean 100 days, sd 71. A random forest fitted on those gaps
 * (ml/visit_model.py) beats "always guess the fleet median" by 12 days of MAE
 * under leave-one-vehicle-out CV, and 0 of 12 shuffled-label refits matched it.
 *
 * The model ships as a lookup table — a predicted gap for each of the twelve
 * months — so recording a service re-predicts through an array index and no
 * Python runs at request time. Regenerate with `npm run ml`.
 */

export interface VisitModel {
  case_id: string;
  metrics: {
    n_gaps: number;
    cv: string;
    baseline_mae_days: number;
    model_mae_days: number;
    permuted_mae_days: number;
    permutations_beating_model: number;
  };
  interval_days: { p10: number; p90: number };
  vehicles: Record<string, { last_visit: string; gap_by_month: number[] }>;
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
 * `caseId` scopes the lookup. The table is keyed by bare vehicle id ("V01"),
 * but ids repeat across the 25 cases — PUB-02's V01 is a different car from
 * PUB-01's. The per-vehicle curves differ by 55-94 days for the same month,
 * more than the model's own 46-day MAE, so reusing one case's curve on another
 * is not a small error. When the model was not trained on this case we drop to
 * the fleet median and say so, rather than showing a confident wrong date.
 */
export function predictVisit(
  v: Vehicle,
  today: string,
  opts: EngineOpts = DEFAULT_OPTS,
  m: VisitModel = VISIT_MODEL,
  caseId?: string,
): VisitPrediction {
  const lastVisit = lastVisitOf(v);
  const sameCase = caseId === undefined || caseId === m.case_id;
  const row = sameCase ? m.vehicles[v.id] : undefined;
  const gap =
    lastVisit && row
      ? row.gap_by_month[parseISO(lastVisit).getMonth()]
      : FALLBACK_GAP_DAYS;
  const basis = !sameCase
    ? `fleet median — the bundled model was trained on ${m.case_id}, not this workshop`
    : lastVisit && row
      ? `bundled model, last visit ${lastVisit}`
      : "fleet median";
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
    .map((v) => predictVisit(v, data.today, opts, m, data.case_id))
    .filter((p) => p.willDrift)
    .sort((a, b) => b.driftDays - a.driftDays);
}
