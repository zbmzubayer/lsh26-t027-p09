// Run: npx tsx src/lib/workload-check.ts
import "dotenv/config";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import type { CaseData, Vehicle } from "@/lib/engine";
import { simulateWorkload } from "@/lib/workload-sim";

/**
 * A real backtest, not a self-consistency check.
 *
 * Rewind each case's `today` by eight weeks and delete everything that happened
 * after it — service records and odometer readings alike, so the rewound case
 * is genuinely the book as it stood then. Forecast forward. Compare against the
 * visits that actually followed.
 *
 * The baseline is what the existing bars implicitly claim: every item arrives
 * on its due date. Beating that is the whole argument for the second series.
 */

const HORIZON = 56;
const day = (iso: string) => Date.parse(iso) / 86400000;
const isoAt = (from: string, off: number) =>
  new Date((day(from) + off) * 86400000).toISOString().slice(0, 10);

function rewind(c: CaseData, days: number): CaseData {
  const cut = isoAt(c.today, -days);
  return {
    ...c,
    today: cut,
    vehicles: c.vehicles
      .map(
        (v): Vehicle => ({
          ...v,
          service_history: v.service_history.filter((h) => h.date <= cut),
          odometer_readings: v.odometer_readings.filter((r) => r.date <= cut),
        }),
      )
      // a vehicle whose first reading is later than the cut did not exist yet
      .filter((v) => v.odometer_readings.length > 0),
  };
}

/** Visits that actually happened in the window after the cut. */
function actual(c: CaseData, days: number) {
  const cut = isoAt(c.today, -days);
  let jobs = 0;
  let value = 0;
  for (const v of c.vehicles)
    for (const h of v.service_history)
      if (h.date > cut && h.date <= c.today) {
        jobs++;
        value += Number(h.cost_bdt);
      }
  return { jobs, value };
}

function loadCases(): CaseData[] {
  const raw = JSON.parse(readFileSync("ml/cases.json", "utf8"));
  return (raw.cases ?? raw) as CaseData[];
}

function main() {
  const cases = loadCases();

  let simErr = 0;
  let dueErr = 0;
  let actJobs = 0;
  let simJobs = 0;
  let dueJobs = 0;
  let covered = 0;

  for (const c of cases) {
    const past = rewind(c, HORIZON);
    const truth = actual(c, HORIZON);
    const sim = simulateWorkload(past, undefined, 200);

    actJobs += truth.jobs;
    simJobs += sim.totals.expJobs;
    dueJobs += sim.totals.dueJobs;
    simErr += Math.abs(sim.totals.expJobs - truth.jobs);
    dueErr += Math.abs(sim.totals.dueJobs - truth.jobs);

    // Did the 10-90 band contain the truth? Summed across weeks as a whole-case band.
    const lo = sim.weeks.reduce((a, w) => a + w.p10Value, 0);
    const hi = sim.weeks.reduce((a, w) => a + w.p90Value, 0);
    if (truth.value >= lo && truth.value <= hi) covered++;
  }

  const n = cases.length;
  console.log(
    `workload-check: backtest over ${n} cases, ${HORIZON}-day horizon`,
  );
  console.log(
    `  actually happened      : ${actJobs} jobs (${(actJobs / n).toFixed(1)} per case)`,
  );
  console.log(
    `  simulated              : ${simJobs.toFixed(0)} jobs — MAE ${(simErr / n).toFixed(1)} per case`,
  );
  console.log(
    `  "all arrive on time"   : ${dueJobs} jobs — MAE ${(dueErr / n).toFixed(1)} per case`,
  );
  console.log(`  80% band covered truth : ${covered}/${n} cases`);

  assert(
    simErr < dueErr,
    `simulation (MAE ${(simErr / n).toFixed(1)}) did not beat "everything arrives on its due date" ` +
      `(MAE ${(dueErr / n).toFixed(1)}) — do not ship the second series`,
  );
  // The deterministic bar overstates arrivals; the sim must not overstate them more.
  assert(
    simJobs < dueJobs,
    "the simulation expects more work than is even due, which cannot be right",
  );
  console.log("workload-check: simulation beats the due-date baseline");
}

main();
