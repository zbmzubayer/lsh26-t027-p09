# How prediction works

A from-first-principles walkthrough of every number this app predicts: what
question it answers, why it exists, and how it arrives at an answer. Worked
examples throughout, with the real numbers from the shipped tables.

For the plumbing — file layout, the FastAPI service, the ngrok fallback — see
[ml-visit-predictor.md](ml-visit-predictor.md). This document is the _why_ and
the _how it thinks_.

---

## The one idea underneath everything

The workshop asks two questions that look like one question and are not:

| Question                         | Depends on                               | Answered by                 |
| -------------------------------- | ---------------------------------------- | --------------------------- |
| **When is this car's work due?** | The car — paperwork, odometer, intervals | A deterministic rule engine |
| **When will the owner walk in?** | The person — habit, money, memory        | A fitted model              |

The first is arithmetic. Brake pads at 40,000 km on a car reading 138,632 km
that runs 61.4 km/day are due on a date you can compute exactly; there is no
uncertainty to model and fitting one would be superstition.

The second is behaviour, and it is the only quantity in this data that genuinely
varies. Every item name carries exactly one cost and one interval across all 25
workshops. Within-vehicle km/day is stable to about ±0.6. So **the model is
pointed at the only place there is real variance**, and everything else is
computed.

Three predictors ship, in the order they were built:

```
                    ┌────────────────────────────────────────────┐
  1. Rule engine    │ when is it due?          deterministic      │
                    └────────────────────────────────────────────┘
                    ┌────────────────────────────────────────────┐
  2. Visit gap      │ when will they come?     random forest      │
                    └────────────────────────────────────────────┘
                    ┌────────────────────────────────────────────┐
  3. Return hazard  │ will they come at all?   survival table     │
                    └────────────────────────────────────────────┘
                                     │
                    ┌────────────────▼───────────────────────────┐
  4. Workload sim   │ what lands next week?    3 drawn, 1 applied │
                    └────────────────────────────────────────────┘
```

Number 4 is not a fourth model. It is a Monte Carlo that draws arrival days from
(3) and asks (1) what gets done when they arrive.

---

## 1. The rule engine — `src/lib/engine.ts`

**Question:** on what date does this item become due?

Not machine learning, and deliberately so. It is a pure function of the case:
no clock, no database, no network. `today` is a field on the case, so the same
input always produces the same output.

### The three due rules

| Rule            | Next due                                                                        | Example                       |
| --------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| `fixed_date`    | the date on the paper                                                           | insurance, fitness, tax token |
| `period_months` | last service date + interval                                                    | engine oil, coolant, AC       |
| `distance_km`   | last service km + interval, **converted to a date using this car's own km/day** | brake pads, tyres, plugs      |

The third one is the whole point of the brief. A fixed calendar interval is
wrong for almost every car in the fleet:

```
km/day = (latest odometer − earliest odometer) / days between them
days until due = (last_service_km + every_km − current_km) / km/day
due date = today + that
```

**Worked example.** Brake pads, every 40,000 km, last done at 98,632 km. The car
now reads 138,632 km and its odometer history spans 61.4 km/day:

```
due at        98,632 + 40,000 = 138,632 km
now           138,632 km  →  0 km left
days to due   0 / 61.4 = 0  →  due today
```

The same car at 18 km/day would have taken 3.4× as long to get there. That
difference is why the estimate is per-vehicle and not per-fleet. A car with a
single odometer reading has no span to measure, so it falls back to the fleet
median of 51 km/day and the reason string says so.

### Classification and ranking

```
overdue    daysLeft < 0
due soon   0 ≤ daysLeft ≤ 30
fine       everything else
```

The call list ranks by **money at risk, weighted by lateness and safety**:

```
score = cost × urgency × risk

urgency   overdue   1 + min(days_late, 180) / 30      →  1.00 … 7.00
          due soon  0.5 × (1 − days_left / 30)        →  0.00 … 0.50
          fine      0
risk      1.5 for brake pads, tyres, fitness, insurance;  1.0 otherwise
```

The two urgency bands do not overlap by construction, so any overdue item
outranks any due-soon item of the same cost by at least 2×. Lateness saturates
at 180 days, so a car abandoned for three years cannot monopolise the list.

Every row prints its own arithmetic — `Tyres 32,000 × 1.97 × 1.5 = 94,400 +
oil 19,250` — so any position on the list is defensible without reading code.

### Guarding the input

Prediction quality is capped by odometer quality, and a mistyped digit is
silent poison: `101,743` entered as `1,017,430` recomputes every distance
estimate on the car and sends it to the top of the call list, with no error
anywhere. `readingProblem()` rejects a reading that goes backwards, that exceeds
a later reading, or that implies more than `max(3 × this car's own rate, 300)`
km/day since the previous one. Judged against the vehicle's own history, not a
fleet constant.

---

## 2. The visit-gap model — `ml/visit_model.py`

**Question:** how many days from this vehicle's last visit until its next one?

### Why a model here

Because the answer is not in the paperwork. Two identical cars with identical
items come back at different times, and the difference is the owner. The rule
engine has no way to express that. This is the one place a fitted model earns
its keep.

### What it learns from

A **visit** is a distinct service _date_, not a service record. Three items done
on one Tuesday is one visit. Counting them separately would manufacture gaps of
zero days and teach the model that customers come constantly.

Collapsed that way, the database yields **1,549 observed inter-visit gaps**
across 1,052 vehicles in 25 workshops. One training row per gap: features as of
visit _i_, label = days until visit _i+1_.

### The nine features

| Feature                             | Why it might matter                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `km_per_day`                        | a car that runs harder wears out sooner and comes sooner                                               |
| `n_items`                           | more fitted items, more reasons to return                                                              |
| `n_distance`, `n_period`, `n_fixed` | the _mix_ of reasons, which have different rhythms                                                     |
| `annual_burden_bdt`                 | implied yearly spend — a proxy for what this customer is used to paying                                |
| `prev_gap_days`                     | habit; the single strongest signal (`-1` when there is no previous gap, which trees split off cleanly) |
| `visit_month`                       | seasonality — monsoon, Eid, year-end                                                                   |
| `cost_at_visit_bdt`                 | a big bill last time changes when they come back next time                                             |

Note what is _absent_: no plate, no model, no owner name, no id. The route
strips those before sending anything to the service — they carry no signal and
the tunnel is public.

### The model

`RandomForestRegressor(n_estimators=300, max_depth=5)`.

A forest rather than a linear fit because the relationships are not monotone —
`prev_gap_days = -1` is a category, not a small number, and month effects wrap
around. Depth 5 rather than deeper because anything past depth 3 memorised when
the training set was 56 rows; at ~1,500 rows depth 5 pays, and the code carries
a comment saying to re-check against the permutation score if the training set
ever shrinks again.

### How it is validated

**Leave-one-_case_-out.** Fit on 24 workshops, predict the 25th. The held-out
unit is a whole workshop, not a random row — which is the situation that
actually happens when a fresh fixture is loaded.

|                                             | MAE                                    |
| ------------------------------------------- | -------------------------------------- |
| Baseline — always guess the training median | 62.5 days                              |
| **Model**                                   | **41.5 days**                          |
| Same pipeline, labels shuffled, 12 refits   | 64.3 days — **0 of 12** beat the model |

The shuffled-label refits are the part that matters. With nine features and
1,549 rows, fitting noise is a real possibility, so it is _measured_ rather than
assumed away. A model that beat the baseline on shuffled labels would be
memorising; this one collapses to worse-than-baseline, which is what genuine
signal looks like.

The 80% interval is quantiles of the **held-out** residuals, not the training
fit: **−67 to +63 days** around the prediction. Wide, and stated plainly on
screen rather than hidden.

### How it predicts at request time

Of the nine features, eight are fixed once the vehicle's history is known. Only
`visit_month` changes as the calendar moves. So training precomputes all twelve
answers per vehicle:

```json
"V28": {
  "last_visit": "2026-05-08",
  "gap_by_month": [92, 82, 70, 57, 47, 42, 34, 170, 167, 176, 174, 135],
  "predicted_gap_days": 47,
  "predicted_visit": "2026-06-24"
}
```

Recording a service then re-predicts through **an array index**. No Python at
request time, no model artifact to keep in sync, and the app works with the
Python process switched off.

### Two corrections applied to the raw output

**Clamping.** Every vehicle's last visit is _right-censored_ — we know they have
not come back yet. A predicted gap landing in the past therefore means "overdue
a visit", never a date. It is clamped to today.

**Case scoping.** The lookup is keyed by case first, then vehicle. Vehicle ids
are unique only _within_ a case — `V01` exists in all 25 — and per-vehicle
curves differ by more than the model's own MAE. Flattening the table would
silently hand one workshop another workshop's prediction. A workshop the model
has never seen drops to the fleet median of 84 days and says so in the basis
string.

---

## 3. The return hazard — `ml/return_model.py`

**Question:** given that this owner has already been away _E_ days, what is the
chance they walk in on their own within the next 30?

### Why a second model

Because clamping destroyed the answer for half the book. **538 of 1,051
vehicles** are already past their median gap, so the point model says "today"
for all of them — technically correct and completely uninformative. You cannot
rank a call list on a column that reads "today" 538 times.

There is also a data problem the point model cannot use. The 1,051 vehicles that
have _not_ come back yet are **censored**: their spell has no end date, so there
is no label, so `visit_model.py` throws them away. But they are the strongest
evidence in the dataset — they are exactly the customers who stay away.

### Discrete-time hazard

The trick is to change the unit of observation from _spell_ to
**person-period**. Every spell contributes one row per 30-day period it
survived, and the final row carries the event flag:

```
a gap that ended after 95 days   →  [0] [0] [0] [1]      (survived 3, then visited)
a spell still open at 95 days    →  [0] [0] [0] [0]      (survived 3, still away)
```

A censored spell now contributes three perfectly good rows. The count goes from
1,549 usable spells to **9,952 person-periods**, 1,051 of which come from
customers the point model had to discard.

The estimate is then just a table of conditional rates:

```
h[k] = visits during bucket k / spells still away at the start of bucket k
```

This is counting, not fitting — no new dependency, no optimiser. The shipped
table:

| Days away            | 0–30  | 30–60 | 60–90 | 90–120 | 120–150 | 150–180 | 180–210 | 210–240 | 240–270 |
| -------------------- | ----- | ----- | ----- | ------ | ------- | ------- | ------- | ------- | ------- |
| P(visit this bucket) | 0.110 | 0.126 | 0.139 | 0.155  | 0.160   | 0.230   | 0.300   | 0.358   | 0.548   |

Reading upward, as it should: the longer a car has been away, the more likely
it is that something has finally broken.

Features were tried and **measured not to beat the bare table**, so the bare
table is what ships. That is the honest outcome, not a shortcut.

### Two guards that came from real failures

**Thin buckets.** Past ~240 days the risk set collapses. The 360–390 day bucket
contained _one_ spell and read `1.000` — carried forward, that told the UI a
long-absent customer was **certain** to walk in, the exact opposite of what a
long absence means. Any bucket with fewer than 40 spells at risk now inherits
the last rate measured from a risk set big enough to mean something. Hence the
flat 0.5 tail.

**Prorated horizons.** A 14-day question must not silently round up to 30. The
survival product prorates partial buckets:

```
P(visit within h days | away E days) = 1 − Π (1 − h_k) ^ share_k
```

**Worked example.** A customer 180 days away, asked about the next 30 days:

```
bucket 6 (180–210d) covers the whole horizon,  h = 0.29969
survive = (1 − 0.29969)^1 = 0.700
P(return) = 1 − 0.700 = 0.300
```

Against 0.110 for a customer who was just in last week. That is the ranking
signal: the second customer is walking in anyway; the first one needs a call.

### How it is validated

Same protocol — leave-one-case-out — scored with the Brier score, which is mean
squared error for probabilities.

|                                         | Brier       |
| --------------------------------------- | ----------- |
| Baseline — the flat fleet rate (0.1556) | 0.13143     |
| **Hazard table**                        | **0.12583** |

A modest but real gain, from 9,952 person-periods across 25 held-out workshops.

**Calibration is checked, not assumed.** Within each predicted-probability
decile, the observed rate is compared to the promised one — decile 2 promises
0.1106 and observes 0.1106; decile 4 promises 0.1258 and observes 0.1327. A
probability nobody checked is decoration.

`return_model.check()` refuses to ship a table that loses to the flat rate,
that contains a hazard of exactly 1.0, that reads a 365-day absence as a >90%
certain return, or whose horizons are non-monotonic.

### Where it is used

Two places, and one of them is off by default:

- **Ranking** — `EngineOpts.returnWeighting` multiplies each call-list row by
  `1 − P(return in 30 days)`, so a call that _changes an outcome_ outranks a
  customer who was walking in anyway. **Default off**, deliberately: every
  published number in the README and in `engine-check.ts` is measured without
  it. A missing probability weighs 1, not 0 — an unknown customer is one to
  call, not one to skip.
- **Workload simulation** — always on, see below.

---

## 4. The workload simulation — `src/lib/workload-sim.ts`

**Question:** how many jobs will actually land in each of the next 8 weeks?

The deterministic 8-week bars show work that is **due**. That quietly assumes
every owner arrives on their due date, and the hazard table says most of them
will not. Those are different numbers and the gap is the entire point — one is
what the cars need, the other is what to staff for.

No new model. It composes the two that exist:

1. For every vehicle with history, take `daysAway` and draw a uniform `u`.
2. **Invert the return CDF.** `pReturn(away, t)` is P(visit within _t_ days), so
   `u > pReturn(away, 56)` means they do not come inside the horizon at all;
   otherwise binary-search the smallest _t_ whose CDF covers `u`. That is their
   arrival day.
3. Ask the **rule engine** what gets done when they arrive: the earliest next
   due item. Measured at 87.2% top-1, which holds because 2,588 of 2,600 visits
   in this data are a single item.
4. Repeat 200 times with a seeded PRNG — `today` is a case field precisely so
   results are reproducible, and a chart that reshuffled every render would
   throw that away. Report the mean and the 10th–90th percentile band.

### How it is validated

`workload-check.ts` rewinds every case eight weeks and forecasts forward against
what actually happened:

|                                      | Jobs           | MAE per case |
| ------------------------------------ | -------------- | ------------ |
| What actually happened               | 322            | —            |
| **Simulation**                       | 206            | **4.8**      |
| "Everyone arrives on their due date" | 441            | 6.7          |
| 80% band covered the truth           | 20 of 25 cases |              |

The naive bar overshoots by 37% because it assumes perfect attendance. The
simulation undershoots, but by less, and it ships an interval.

---

## Reading the whole pipeline at once

```
odometer + items + history
        │
        ├──▶ engine.ts ────────────▶ due date, status, score        [deterministic]
        │                                    │
        ├──▶ visit_model.py ───────▶ predicted gap → visit date     [random forest]
        │                                    │
        └──▶ return_model.py ──────▶ P(returns unprompted)          [hazard table]
                                             │
             ┌───────────────────────────────┤
             ▼                               ▼
        drift = predicted visit −    workload-sim.ts: 200 draws
        earliest due date            → what actually lands per week
             │
             ▼
        "will not come back before something is already due"  →  call them
```

**Drift** is the join that makes the two halves useful together. A car whose
predicted visit lands _after_ its earliest due date will be driven while
something is overdue — that is the list the phone actually changes. Everything
else walks in anyway.

---

## What none of this claims

Stated plainly, because a prediction without its limits is a sales pitch:

- **The 80% window is ±65 days.** Useful for ranking, not for booking a bay.
  Predictions are clamped to today rather than fitted with a proper survival
  model such as Cox or AFT.
- **The hazard has no covariates.** Features were tried and did not beat the
  bare table on this data. With more history they might; the harness to measure
  that is already in `return_model.evaluate()`.
- **The 0.5 tail past 240 days is a floor, not a measurement.** It is what the
  thin-bucket guard carries forward, and it should be read as "we stopped
  knowing here".
- **Item choice is a heuristic, not a model.** "Earliest next due" is 87.2%
  top-1 only because this data is overwhelmingly single-item visits.
- **The rule engine is not predicting anything.** It is arithmetic on the
  paperwork. If the paperwork is wrong the answer is wrong, which is why
  `readingProblem()` exists.
- **Everything is validated leave-one-workshop-out**, which is the honest
  protocol here, but 25 workshops is 25 held-out folds — the confidence
  intervals on these MAEs are not narrow.

---

## Reproducing every number in this document

```bash
npm run ml:export                    # Postgres → ml/cases.json
npm run ml                           # retrain both models, print the metrics
npx tsx src/lib/engine-check.ts      # the rule engine, against pinned answers
npm run check:visit                  # bundled table vs the live service
npx tsx src/lib/workload-check.ts    # the forecast, backtested
```

Each of those ends in an `assert` that fails loudly if the claim stops holding.
