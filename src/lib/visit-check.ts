// Run: npx -y tsx src/lib/visit-check.ts
import assert from "node:assert";
import pub01 from "../data/case-pub-01.json";
import type { CaseData } from "./engine";
import { driftList, lastVisitOf, predictVisit, VISIT_MODEL } from "./visit";

const data = pub01 as CaseData;
const preds = data.vehicles.map((v) =>
  predictVisit(v, data.today, data.case_id),
);

// The model must not invent a visit that already happened, and the window must
// bracket the prediction — both are silent-wrong-answer bugs, not crashes.
assert(
  preds.every((p) => p.predictedVisit >= data.today),
  "predicted a visit in the past",
);
assert(
  preds.every(
    (p) => p.windowFrom <= p.predictedVisit && p.predictedVisit <= p.windowTo,
  ),
  "prediction outside its own interval",
);
assert(
  preds.every((p, i) => p.lastVisit === lastVisitOf(data.vehicles[i])),
  "prediction not aligned with its vehicle",
);

// Recording a service moves the last visit, so the prediction must move with it.
const v = structuredClone(data.vehicles[0]);
const before = predictVisit(v, data.today, data.case_id).predictedVisit;
v.service_history.push({
  item: "Air filter",
  date: data.today,
  km: null,
  cost_bdt: "1200.00",
});
assert(
  predictVisit(v, data.today, data.case_id).predictedVisit !== before,
  "prediction ignored a new service",
);

const drift = driftList(data);
assert(
  drift.every((p, i) => i === 0 || drift[i - 1].driftDays >= p.driftDays),
  "drift list unsorted",
);
assert(
  VISIT_MODEL.metrics.model_mae_days < VISIT_MODEL.metrics.baseline_mae_days,
);

console.log(
  `visit-check: ${preds.length} vehicles, ${drift.length} will drift past a due date` +
    ` (model MAE ${VISIT_MODEL.metrics.model_mae_days}d vs baseline ${VISIT_MODEL.metrics.baseline_mae_days}d)`,
);

// Contract check against the FastAPI service (ml/serve.py). Skipped when the
// tunnel is not configured, so this stays runnable with the model process down.
// Run: ML_URL=http://127.0.0.1:8010 npx tsx src/lib/visit-check.ts
async function checkLive(url: string) {
  const res = await fetch(`${url}/predict`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "ngrok-skip-browser-warning": "true",
    },
    body: JSON.stringify({ today: data.today, vehicles: data.vehicles }),
  });
  assert(res.ok, `model service returned ${res.status}`);
  const body = (await res.json()) as {
    predictions: { vehicle_id: string; predicted_gap_days: number }[];
  };
  assert(
    body.predictions.length === data.vehicles.length,
    "service dropped vehicles",
  );

  // The service and the bundled table are the same forest, so a vehicle the app
  // has not modified must get the same answer either way. If this drifts, the
  // committed JSON is stale — rerun `npm run ml`.
  const byId = new Map(body.predictions.map((p) => [p.vehicle_id, p]));
  for (const p of preds) {
    const live = byId.get(p.vehicleId);
    assert(live, `service skipped ${p.vehicleId}`);
    assert(
      Math.abs(live.predicted_gap_days - p.predictedGapDays) <= 1,
      `${p.vehicleId}: service says ${live.predicted_gap_days}d, bundled says ${p.predictedGapDays}d — rerun npm run ml`,
    );
  }
  console.log(
    `visit-check: live service agrees on all ${preds.length} vehicles`,
  );
}

if (process.env.ML_URL) {
  checkLive(process.env.ML_URL).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.log("visit-check: ML_URL unset, skipped the live service contract");
}
