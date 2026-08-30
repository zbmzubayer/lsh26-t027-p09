# ML — the visit predictor

> **Status:** both models are committed and live on `POST /api/visit`. The
> _ranking_ change the return probability was built for — a fourth `EngineOpts`
> knob, defaulting off — is specified in [`ml/RETURN-HANDOFF.md`](../ml/RETURN-HANDOFF.md)
> and deliberately not landed: switched on by default it would break the
> `engine-check` fixtures that are the reason anyone believes the call list.

## Why there is a model at all

The rule engine says when an item is **due**. It cannot say when the customer
actually **comes**, and those are different dates — usually months apart.

That gap is also the only place a fitted model earns its keep here. Across all
25 cases, every item name carries exactly one cost and one interval; within-
vehicle km/day is stable to ±0.6 km/day; 2,588 of 2,600 visits are a single
item. **Customer behaviour is the only thing in this data that genuinely
varies**, so it is the only thing modelled. See
[`plans/ML-PLAN.md`](../plans/ML-PLAN.md) for the ideas that were measured and
rejected, with the numbers.

## The seam

```
Postgres ──npm run ml:export──▶ ml/cases.json ──▶ visit_model.py ──┬─▶ src/data/visit-predictions.json
                                     │                            │      (committed, offline fallback)
                                     └──▶ return_model.py ────────┘
                                                                  └─▶ ml/serve.py  (FastAPI, live)
```

**The Python never receives `DATABASE_URL`.** `ml/cases.json` is the seam:
TypeScript owns the database, Python owns the model, and a JSON file passes
between them. The service sits behind a public ngrok tunnel, so handing it
database credentials to save one step would be a bad trade.

## Model 1 — visit gap (`ml/visit_model.py`)

**Question:** how many days until this vehicle's next visit?

|              |                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Rows         | 1,549 observed inter-visit gaps, 1,052 vehicles, 25 workshops                                                                          |
| Model        | `RandomForestRegressor`, 300 trees, `max_depth=5`                                                                                      |
| Features (9) | `km_per_day`, `n_items`, `n_distance`, `n_period`, `n_fixed`, `annual_burden_bdt`, `prev_gap_days`, `visit_month`, `cost_at_visit_bdt` |
| Validation   | Leave-one-**case**-out — fit on 24 workshops, score the one held out                                                                   |

**Results:**

|                                                 | MAE                                |
| ----------------------------------------------- | ---------------------------------- |
| Baseline (median gap of the training workshops) | 62.5 days                          |
| Model                                           | **41.5 days**                      |
| Same model, shuffled labels, 12 refits          | 64.3 days — 0 of 12 beat the model |

The held-out unit is a whole workshop, so that number is what to expect on a
case the model has never seen — exactly what happens when a judge loads a fresh
fixture.

**Two details that matter:**

- **A visit is a distinct date, not a history row.** Several items done on one
  day is one visit. Counting them separately would invent gaps of zero days and
  teach the model that customers come constantly.
- **`max_depth=5` is measured, not chosen.** At 56 rows anything past depth 3
  memorised; at ~1,500 rows depth 5 pays. If the training set ever shrinks,
  re-check against `permuted_mae_days` before trusting a deeper tree.

**Output** is a lookup table, not a pickle: a predicted gap **for each of the
twelve months**, per vehicle, per case. Only `visit_month` changes as the
calendar moves, so the app re-predicts after a recorded service with an array
index — no Python at request time.

## Model 2 — return probability (`ml/return_model.py`)

**Question:** given that they have already been away _E_ days, what is the
chance they walk in on their own within the next 30?

This exists because the gap model clamps to today, and **538 of 1,051 vehicles
are already past the median gap** — for half the book the point prediction is
"today", which conveys nothing.

|            |                                                                                 |
| ---------- | ------------------------------------------------------------------------------- |
| Method     | Discrete-time hazard, 30-day buckets, capped at 720 days                        |
| Rows       | 9,952 person-periods, from 1,549 completed gaps **and 1,051 still-open spells** |
| Validation | Leave-one-case-out, Brier score + a 10-decile calibration table                 |

**Results:** Brier **0.1258** vs a flat-rate baseline of 0.1314 (flat rate
0.1556). Calibration is close across all ten deciles — the top decile predicts
0.337 and observes 0.323.

The hazard rises with absence, which is the whole point:

| Away      | P(returns in the next 30 days) |
| --------- | ------------------------------ |
| 0–30 d    | 0.110                          |
| 60–90 d   | 0.139                          |
| 150–180 d | 0.230                          |
| 240–270 d | 0.548                          |

**No new dependency** — this is counting, not fitting. Whether features beat the
bare table was measured rather than assumed; on this data they do not, so the
table is what ships.

`MIN_AT_RISK = 40` is a guard with a story: the 300–330 d bucket has 26 spells
and reads 0.692, and the 360–390 d bucket has _one_ and reads 1.000. Carried
forward, that told the UI a long-absent customer was **certain** to return — the
exact opposite of what it means. Thin buckets are floored instead.

`p_return()` is implemented in both Python and TypeScript (`pReturn` in
`src/lib/visit.ts`), prorating partial buckets so a 14-day question is not
silently rounded up to 30. `visit-check.ts` asserts the two agree.

## The service — `ml/serve.py`

FastAPI + uvicorn on `127.0.0.1:8010`, stateless by design, exactly like
`/api/run`.

| Endpoint        | Purpose                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `POST /predict` | `{ today, vehicles[] }` → predicted gap, 12-month grid, basis, and `p_return_30` / `p_return_60` per vehicle |
| `GET /health`   | `{ ok, n_gaps, metrics }`                                                                                    |

It **refits on boot** (~3 s) from the same training set as the bundled table, so
the live service and the offline fallback cannot disagree — no model artifact to
keep in sync. Request shapes are Pydantic models: the tunnel is a trust
boundary, so input is parsed, not trusted.

It answers **only** the behavioural half. Due dates stay in `engine.ts`;
duplicating the rules here would give the workshop two answers that could
disagree.

## The TypeScript side — `src/lib/visit.ts`

| Export                                 | Purpose                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `predictVisit(v, today, caseId)`       | Prediction from the bundled table. No network, always available                                                                            |
| `joinPrediction(v, today, gap, basis)` | Joins any predicted gap onto the engine's due dates — used by both the bundled path and the live one, so the UI cannot tell which answered |
| `driftList(data)`                      | Vehicles that are due **and** will not come back on their own, worst drift first                                                           |
| `pReturn(elapsed, horizon)`            | The hazard question, mirroring the Python                                                                                                  |

**`caseId` is required, not optional.** Vehicle ids are unique only within a
case — PUB-02's `V01` is a different car from PUB-01's — and per-vehicle curves
differ by more than the model's own MAE. A workshop the model was not trained on
drops to the fleet median and _says so_ in `basis`, rather than showing a
confident wrong date.

**Censoring is handled honestly:** every vehicle's last visit is right-censored,
so a predicted gap landing in the past means "overdue a visit", never a date.
It is clamped to today.

The most useful derived field is `willDrift` — _due, and they will not walk in
on their own_. That is the list the phone actually changes.

## The route — `POST /api/visit`

The model is an **optimisation, not a dependency**:

```
ML_URL set? ──no──▶ bundled table, source: "bundled"
     │yes
     ▼
POST {ML_URL}/predict, 5s timeout, ngrok-skip-browser-warning
     │
     ├─ ok + parses ──▶ live gaps, source: "live"
     └─ anything else ─▶ bundled table, source: "bundled" + a note
```

Called **server-side**, so the tunnel URL never enters the client bundle and the
session check still applies. Only the odometer, items and history are sent — the
plate, model and owner id are never given to the tunnel, because the model does
not read them.

## Running it

```bash
npm run ml:export      # Postgres -> ml/cases.json  (the only step touching the DB)
npm run ml             # retrain, rewrite src/data/visit-predictions.json
npm run ml:serve       # FastAPI on 127.0.0.1:8010, refits on boot
ngrok http 8010        # copy the https URL into ML_URL, then restart `next dev`
npm run check:visit    # assert the bundled table and the live service agree
```

Python dependencies (`ml/requirements.txt`) are installed on the fly by `uv`;
there is no virtualenv to manage.

## Operational gotchas

- **The ngrok URL changes on every restart** (free tier). When it does, update
  `ML_URL` and restart `next dev`, or the app silently drops to `"bundled"` —
  visible in the UI as "offline model".
- **Free-tier ngrok serves an HTML interstitial** to anything browser-shaped.
  `/api/visit` sends `ngrok-skip-browser-warning: true`; keep it anywhere else
  you call the tunnel.
- **`npm run ml` after `npm run ml:export`** if the database has changed.
  `check:visit` fails when the committed table and the live service disagree —
  that means one of them is stale.
- **A deployed instance should leave `ML_URL` unset** and answer from the
  bundled table.

## Honest limitations

- The 80% window is roughly ±65 days. That is what this much behavioural noise
  buys; the point date is far less useful than the probability.
- Predictions are clamped to today rather than fitted with a full survival
  model. The hazard table above is the first step at fixing that.
- A workshop outside the training set gets the fleet median, and says so.
