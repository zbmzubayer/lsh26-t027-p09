# Visit predictor — UI handoff

Predicts **when a customer will next turn up**, per vehicle. The rule engine
(`src/lib/engine.ts`) already says when an item is _due_; this says when the
owner actually comes in, which is a different date and usually a later one.

The API route is done and tested. What is left is the button and the panel.

---

## 1. Run the model service

```bash
npm run ml:export         # DB -> ml/cases.json (25 workshops, 1,549 visit gaps)
npm run ml                # retrain, rewrite src/data/visit-predictions.json
npm run ml:serve          # FastAPI + uvicorn on 127.0.0.1:8010, refits on boot (~3s)
ngrok http 8010           # copy the https://….ngrok-free.app URL
```

`ml:export` is the only step that touches Postgres. The Python never gets
`DATABASE_URL` — a JSON file is the seam, so nothing behind the public tunnel
holds database credentials.

Put the tunnel URL in `.env` and **restart `next dev`** (env is read at boot):

```
ML_URL="https://xxxx-xx-xx-xx-xx.ngrok-free.app"
```

Verify before wiring anything:

```bash
curl -s $ML_URL/health -H 'ngrok-skip-browser-warning: true'
ML_URL=http://127.0.0.1:8010 npx tsx src/lib/visit-check.ts   # asserts service == bundled model
```

**If the tunnel is down, nothing breaks.** `/api/visit` falls back to a lookup
table bundled in `src/data/visit-predictions.json` and sets
`source: "bundled"`. The button always returns a date. Build the UI against the
fallback first, then plug the tunnel in.

---

## 2. The endpoint

`POST /api/visit` — session-protected, same as `/api/service` and `/api/odometer`.

Send **exactly one** of:

```jsonc
{ "vehicleId": "V01" }   // one vehicle
{ "ownerId": "O01" }     // every vehicle that owner has
```

Response:

```jsonc
{
  "today": "2026-08-30",
  "source": "live",              // "live" = FastAPI answered, "bundled" = fallback
  "note": "…",                   // only present when source is "bundled"
  "metrics": { "model_mae_days": 46.2, "baseline_mae_days": 58.2, "n_gaps": 56, … },
  "intervalDays": { "p10": -65, "p90": 72 },
  "predictions": [
    {
      "vehicleId": "V01",
      "lastVisit": "2026-07-04",
      "predictedGapDays": 69,
      "predictedVisit": "2026-09-11",   // never earlier than today
      "windowFrom": "2026-07-08",
      "windowTo": "2026-11-22",
      "earliestDue": "2026-08-25",
      "driftDays": 17,                  // predictedVisit − earliestDue
      "willDrift": true,                // true = they arrive AFTER something is due
      "basis": "live model — 3 past visits, last 2026-07-04",
      "reason": "last in 2026-07-04, typically back after 69 days — that is 17 days past 2026-08-25, so call them",
      "plate": "Dhaka Metro Cha 76-9961",
      "model": "Toyota Axio",
      "ownerId": "O01",
      "owner": "Salma Ahmed",
      "phone": "01481704039"
    }
  ]
}
```

Errors: `400` bad body, `401` not signed in, `404` no such vehicle.

Types are already exported — **do not redeclare them**:

```ts
import type { VisitPrediction } from "@/lib/visit";
```

---

## 3. Wiring the button

`VehicleDetail` is presentational and takes its callbacks from `DueBook`
(`onRecord`, `onOdometer`, `onAddItem`). Follow that: the mutation goes in
`DueBook`, two new props go down.

### In `src/components/due-book/due-book.tsx`

```tsx
const visit = useMutation({
  mutationFn: (body: { vehicleId: string } | { ownerId: string }) =>
    json<{
      source: "live" | "bundled";
      note?: string;
      predictions: VisitPrediction[];
    }>("/api/visit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
});
```

Pass into `<VehicleDetail … />`:

```tsx
onCheckVisit={() => vehicleId && visit.mutate({ vehicleId })}
visit={visit.data?.predictions[0] ?? null}
visitSource={visit.data?.source ?? null}
visitPending={visit.isPending}
visitError={visit.error?.message ?? null}
```

Reset between vehicles so a stale date never shows under the wrong plate —
add `visit.reset()` wherever `setVehicleId` is called.

### In `src/components/due-book/vehicle-detail.tsx`

Add to the props type, then a button near the odometer controls:

```tsx
<button type="button" onClick={onCheckVisit} disabled={visitPending}>
  {visitPending ? "Checking…" : "Check next visit"}
</button>;

{
  visitError && <p role="alert">{visitError}</p>;
}

{
  visit && (
    <div>
      <strong>{visit.predictedVisit}</strong>
      <span>
        {" "}
        ({visit.windowFrom} – {visit.windowTo}, 80% window)
      </span>
      <p>{visit.reason}</p>
      {visit.willDrift && (
        <p>
          Arrives {visit.driftDays} days after {visit.earliestDue} — call them.
        </p>
      )}
      <small>
        {visitSource === "bundled" ? "offline model" : "live model"}
      </small>
    </div>
  );
}
```

Use the existing `tkS` / `Plate` / date helpers in `./format` rather than new
ones, and match the surrounding Tailwind classes — the snippet above is
unstyled on purpose.

### Owner-level button (optional)

Same mutation with `{ ownerId }` returns one row per vehicle — good for the
call list, where `willDrift` separates "due, and they will not come on their
own" from "due, but they walk in anyway".

---

## 4. What to know before the demo

- **The ngrok URL changes every restart** on the free tier. When it does, update
  `ML_URL` and restart `next dev`, or the app silently drops to `"bundled"`.
- **Free-tier ngrok serves an HTML interstitial** to anything browser-shaped.
  `/api/visit` already sends `ngrok-skip-browser-warning: true`; keep it if you
  call the tunnel from anywhere else.
- **Call it from the server, not the browser.** Going through `/api/visit` keeps
  the tunnel URL out of the client bundle and keeps the session check.
- **`npm run ml` regenerates the bundled table**, and `npm run ml:export` first
  if the database has changed. `visit-check.ts` fails if the committed table and
  the live service disagree — that means one of them is stale.
- **The bundled table is keyed by case, then vehicle.** Vehicle ids repeat
  across the 25 workshops, so `predictVisit(v, today, caseId)` takes the case id
  as a required argument. A workshop the model has not been trained on falls
  back to the fleet median and says so in `basis`.
- The service is stateless: it never touches the database, so the tunnel carries
  no workshop data and a restart loses nothing.

## 5. Honest numbers, for the README and the pitch

|                                                 |                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------ |
| Training rows                                   | 1,549 observed inter-visit gaps, 1,051 vehicles, 25 workshops            |
| Model                                           | random forest, depth 5, 9 features                                       |
| Validation                                      | leave-one-**case**-out — fit on 24 workshops, scored on the one held out |
| Baseline (median gap of the training workshops) | MAE **62.5 days**                                                        |
| Model                                           | MAE **41.5 days**                                                        |
| Same model on shuffled labels, 12 refits        | MAE 64.3 days, best 63.9 — none beat it                                  |

The held-out unit is a whole workshop, so the number above is what to expect on
a case the model has never seen — which is exactly what happens when a judge
loads a fresh fixture.

Two limitations worth saying out loud rather than hiding: the 80% window is
roughly ±65 days, which is what this much behavioural noise buys you; and every
vehicle's last visit is
right-censored — they have not come back yet — so predictions are clamped to
today instead of being fitted with a proper survival model.
