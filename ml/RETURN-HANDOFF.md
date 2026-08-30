# Return probability — UI handoff

Answers **"will this customer turn up on their own?"** — as a probability, not a
date. The model and the endpoint are done; what is left is the ranking change
and one chip.

Read `ml/HANDOFF.md` first: this rides the same pipeline, the same service and
the same offline fallback.

---

## 1. Why this exists

The visit model predicts a _gap_ from the last visit and clamps to today. For
half the book that says nothing: **538 of 1,051 vehicles are already past the
median gap**, so the answer is "today" for all of them.

This asks a question that survives censoring instead. Given they have already
been away E days, what is the chance they walk in within the next 30?

| away   | P(returns within 30d) | within 60d |
| ------ | --------------------- | ---------- |
| 0 d    | 0.110                 | 0.223      |
| 60 d   | 0.139                 | 0.273      |
| 90 d   | 0.155                 | 0.290      |
| 180 d  | 0.300                 | 0.550      |
| 270 d+ | 0.500                 | 0.750      |

The useful direction is the inverse: a customer 101 days away has a **84% chance
of not coming in the next month**. That is the call worth making.

---

## 2. The numbers, honestly

|                                   |                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------ |
| Method                            | discrete-time hazard, 30-day buckets                                           |
| Rows                              | 9,952 person-periods from 1,549 completed gaps **and 1,051 still-open spells** |
| Validation                        | leave-one-**case**-out, same protocol as the visit model                       |
| Baseline (flat fleet rate, 0.124) | Brier **0.13143**                                                              |
| Model                             | Brier **0.12583** — 4.3% better                                                |
| Calibration                       | 10 deciles, predicted vs observed: 0.109→0.135, 0.156→0.160, 0.344→0.323       |

**Say the 4.3% out loud.** It is a modest gain and the calibration is the real
result: when it says 34% it happens 32% of the time. A probability nobody
checked is a decoration.

Two things it does _not_ do. It has no per-vehicle features — km/day, item
count and burden were tried and did not beat the bare table, so the table is
what ships. And past 270 days the risk set thins to under 40 spells, so the
rate is held flat at 0.5 rather than extrapolated; without that cap the tail
read 0.692, 0.875 and then **1.000**, telling the UI a long-absent customer was
certain to walk in — the exact opposite of the truth.

---

## 3. What the endpoint gives you

`POST /api/visit` is unchanged in shape. Three fields are new on every
prediction:

```jsonc
{
  "vehicleId": "V01",
  "daysAway": 101, // since their last visit; what the hazard conditions on
  "pReturn30": 0.157, // P(walks in within 30 days)
  "pReturn60": 0.3141,
  // ...everything already documented in HANDOFF.md
}
```

`null` on all three means the bundled table pre-dates the hazard — run
`npm run ml`.

These come from the **bundled** table whether the tunnel is up or not: the
formula is implemented in both Python (`ml/return_model.py`) and TypeScript
(`pReturn` in `src/lib/visit.ts`), and `visit-check.ts` asserts the two agree to
1e-3 on all 42 vehicles. So a dropped tunnel changes the _gap_, never the
probability.

Also exported for direct use:

```ts
import { pReturn } from "@/lib/visit";
pReturn(101, 30); // 0.157
```

---

## 4. The change worth making — call-list ranking

Today the call list ranks `Σ cost × urgency × safety`. It should rank:

```
Σ cost × urgency × safety × (1 − P(returns on their own))
```

**Call the people who will not walk in anyway.** A car that is due but whose
owner reliably appears every 60 days does not need a phone call; one that is due
and 200 days silent does. That is a defensible upgrade to a mandatory feature,
and it is the only place a model touches something the judges score.

### Do it as an opt-in flag, not a replacement

`src/lib/engine-check.ts` pins the current order — top-6 `V28 117,690 … V07
64,000`. Changing `buildCallList` unconditionally breaks those fixtures, and
those fixtures are the reason anyone believes the engine.

Follow the pattern already in `EngineOpts` (`dueSoonDays`, `kmBasis`,
`riskWeights`): add a fourth knob, default **off**, so every published number
stays exactly where it is.

```ts
export interface EngineOpts {
  // ...
  /** Weight the ranking by how unlikely the owner is to arrive unprompted. */
  returnWeighting: boolean;
}
```

Then a segmented control beside the other three in the options strip, and the
demo writes itself: flip it on and watch the order change, with the reason
printed per row exactly as the safety weighting already is.

`p_return` is per **vehicle**, not per item, so multiply it into the row score
in `buildCallList`, not into `computeItem`.

### The chip

On the call-list row and in the detail drawer:

> **84% will not come in 30 days** · last seen 101 days ago

Use `1 − pReturn30`, because the actionable number is the one that means "ring
them". Suppress it entirely when `pReturn30` is null rather than rendering a
blank.

---

## 5. What to know before the demo

- **Regenerate before you quote anything.** `npm run ml:export && npm run ml`
  rewrites `src/data/visit-predictions.json` with both models and runs both
  self-checks. The hazard block lives under `return_hazard`.
- **`npm run check:visit` fails loudly** if the committed table and the live
  service disagree, on gaps or on probabilities. That failure means one of them
  is stale, not that the model is wrong.
- **The hazard is fleet-wide, not per workshop.** It is fitted across all 25
  cases and applies to any of them, so unlike `cases[caseId][vehicleId]` it is
  safe on a workshop the model has never seen — including a hand-entered car.
- **A car with no service history has no `daysAway`**, so all three fields come
  back null. It needs one recorded visit before this says anything, and the UI
  should say so rather than showing 0%.
- The service is still stateless and still holds no database credentials; the
  seam is `ml/cases.json`.

## 6. Not built, and why

From `plans/ML-PLAN.md`, measured and rejected: a next-job classifier (the rule
engine already gets 87.2% top-1), a learned km/day forecaster (the naive span
average wins, 26.4 km vs 29.1), basket association rules (2,588 of 2,600 visits
are a single item), and cost or interval prediction (each of the twelve items
has exactly one cost and one interval across all 25 workshops — constants
cannot be modelled).

ML-2 in that plan, the probabilistic 8-week workload, is now unblocked: it needs
no new fit, only a Monte-Carlo over this hazard plus the rule engine. That is
the next thing to build.
