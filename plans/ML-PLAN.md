# P09 — Further ML features · plan

Written against the live database (25 cases, 1,052 vehicles, 2,600 visits, 1,549 gaps) and the
running service on `ML_URL` (`/health` answers, 1,549 gaps, MAE 41.5 d). Every number below was
measured on that data, not assumed.

## The constraint that shapes this plan

These cases are near-deterministic. Each item name has **exactly one** cost and one interval across
all 25 workshops; within-vehicle km/day is stable to ±0.6 km/day; 2,588 of 2,600 visits are a single
item. The one thing that genuinely varies is **when the customer turns up** — which is why A2.12
exists and why most obvious "add ML" ideas here are theatre. See _Measured and rejected_ at the
bottom; those numbers are worth saying out loud in the pitch.

There is real headroom left in exactly one place: the current model predicts a **gap from the last
visit** and clamps to today. **51% of the fleet (538 of 1,051 vehicles) is already past the median
gap**, so for half the book the model outputs "today" and conveys nothing. Conditioning on how long
they have _already_ been away is informative and unused:

| not seen for | P(comes in the next 30 days) | n at risk |
| ------------ | ---------------------------- | --------- |
| 0 d          | 0.185                        | 1,549     |
| 60 d         | 0.243                        | 981       |
| 90 d         | 0.264                        | 743       |
| 180 d        | 0.354                        | 277       |

---

## ML-1 · Return probability — "will they come on their own?"

**Ship this one first.** It is the only proposal here that attaches a model to a _scored_ item (M3,
the call list), rather than to a side panel.

- **What** — per vehicle, `P(visit within 14 / 30 / 60 days)` given how long they have already been
  away, replacing the ±65-day point date as the thing the UI ranks by.
- **Model** — discrete-time hazard on person-period rows: 1,549 completed gaps **plus** the 1,051
  right-censored current spells the point model has to throw away. Start with the empirical hazard
  table above (six numbers, conditioned on elapsed bucket) — that alone beats the clamp. Only add
  features (km/day, n_items, annual burden, month) if they beat the table on held-out Brier.
- **Validation** — leave-one-case-out, same protocol as `visit_model.py`. Brier score and a
  calibration curve (predicted vs observed return rate per decile) against a flat-fleet-rate
  baseline of 0.185. Ship the calibration plot; a probability nobody checked is a decoration.
- **Why it earns its place** — the call list currently ranks `Σ cost × urgency × safety`. It should
  rank `Σ cost × urgency × safety × (1 − P(returns on their own))`: **call the people who will not
  walk in anyway.** That is a defensible, explainable upgrade to a mandatory feature, and it fixes
  the limitation `HANDOFF.md` already admits to (censoring).
- **Wiring** — `visit_model.py` gains the hazard fit; `serve.py` `/predict` returns `p_return_30`,
  `p_return_60`; the table goes in `src/data/visit-predictions.json` so the offline fallback keeps
  working; `src/lib/visit.ts` joins it; `engine.ts` ranking takes the factor; the call-list row shows
  it as a chip ("72% will not come in 30 days"). No new endpoint, no new table, no new service.
- **Effort** — half a day, most of it in the ranking change and the chip.

## ML-2 · Probabilistic 8-week workload — "45 due, ~17 will actually come"

- **What** — A1.1 shows jobs _due_ per week. Add an **expected** series: jobs and ৳ that will
  actually land, with a band.
- **Model** — no new fit. Monte-Carlo 200 draws over the fleet using ML-1's hazard for the visit
  week, and the rule engine for what gets done when they arrive (measured at **87.2% top-1**, below).
  The band is the 10th–90th percentile of the draws.
- **Validation** — a genuine backtest: rewind each case's `today` by 8 weeks, forecast, compare
  against what actually happened in those 8 weeks. Report MAE in jobs and in ৳ against a "everything
  due arrives on its due date" baseline, which is what the current bars implicitly claim.
- **Why** — this is the slide that lands. The deterministic bar says ৳486,300 of work; the honest
  forecast says what to staff for. It also makes the overdue backlog (৳387,700, A1.2) legible as
  "money that will not arrive unless you call".
- **Wiring** — `workload.tsx` gains a second series and a band; the Method tab gains the simulation
  description. Simulation runs server-side in `src/lib/`, not Python — the hazard table is the only
  model input and it is already bundled.
- **Effort** — half a day.

## ML-3 · Owner-level batching (closes A3.3)

- **What** — a customer's cars are scored independently today. When ML-1 says an owner is coming for
  car A, roll every due item on car B into that same visit.
- **Model** — none. Composition over ML-1 at the owner level; `/api/visit` already accepts
  `{ ownerId }`.
- **Measurable claim** — number of distinct call events collapses, and expected value per call rises.
  Quote both before/after on PUB-01.
- **Effort** — two hours. Do it only after ML-1 and ML-2.

---

## Cheap add-ons (not ML, worth having)

- **Odometer sanity guard** — `/api/odometer` accepts anything. Within-vehicle km/day deviates by
  0.60 median, 3.29 max, so reject readings that go backwards or imply >3× the vehicle's own rate,
  with the offending number named. ~10 lines at a trust boundary; a mistyped `1017430` currently
  poisons every distance estimate on that vehicle silently.
- **`RetrainRequest` / `VehiclePrediction` are dead schema** — nothing in `src/`, `ml/` or `scripts/`
  references either model. Either wire the retrain button they were designed for, or delete them.
  Recommendation: **delete**. `serve.py` already refits on boot in ~3 s, which is the same demo for
  zero code.

## Measured and rejected — with the numbers

| Idea                              | Measurement                                                                                                | Verdict                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Classifier for the next job       | Rule engine ("earliest next due") already scores **87.2% top-1**; most-frequent-per-vehicle baseline 27.1% | 13% headroom on 1,549 rows — noise. Skip.      |
| Learned km/day forecaster         | Holdout MAE on the last reading: span-average **26.4 km**, recency-weighted **29.1 km**                    | The naive estimator wins. Skip.                |
| Basket / upsell association rules | 2,588 of 2,600 visits are a **single** item; top co-occurring pair appears 3 times                         | No co-occurrence exists. Skip.                 |
| Cost or interval prediction       | Each of the 12 item names has exactly **one** cost and one interval across all 25 cases                    | Constants cannot be modelled. Skip.            |
| Owner segmentation (k-means)      | Unvalidatable — descriptive only                                                                           | Only if a visual is needed. Label it honestly. |
| Any LLM feature                   | —                                                                                                          | No. Nothing here is a language problem.        |

Presenting these as _measured and rejected_ is worth more than shipping any of them: it is the
difference between a team that added models and a team that knows which model was load-bearing.

## Sequencing

1. **A3.1 — the live URL.** Still Open in `FEATURES.md` and it blocks every scored item. Nothing
   below scores if a judge cannot open the app. Do this before any of the above.
2. ML-1 (hazard + call-list ranking) — the only one touching a mandatory feature.
3. ML-2 (probabilistic workload) — the demo slide.
4. Odometer guard, then delete the dead schema.
5. ML-3 (owner batching) if time remains.

Everything above rides the seam that already exists: `npm run ml:export` → `ml/cases.json` → Python →
both the bundled table and the ngrok service, with `src/data/visit-predictions.json` as the offline
fallback. No new service, no new database table, no new dependency.
