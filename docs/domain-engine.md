# Domain engine — `src/lib/engine.ts`

The whole domain, in one pure module. No imports with side effects, no database,
no clock, no React. Everything else in the application is plumbing around it.

447 lines, and the only file where a due date is decided.

## Types

```ts
type Rule = "fixed_date" | "period_months" | "distance_km";
type Status = "overdue" | "due_soon" | "fine";
```

`CaseData` → owners + vehicles + `today`. A `Vehicle` carries
`odometer_readings`, `service_items` and `service_history`. Types are inferred
from the Zod schemas in `case-schema.ts`; the engine re-exports them rather than
declaring a looser second copy.

## Constants

| Constant                  | Value                                             | Meaning                                                             |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `DUE_SOON_DAYS`           | 30                                                | Default "due soon" window                                           |
| `FLEET_MEDIAN_KM_PER_DAY` | 51                                                | Fallback for a vehicle with one reading                             |
| `RISK_ITEMS`              | brake pads, tyres, fitness certificate, insurance | Overdue here means a car that should not be on the road             |
| `LATE_CAP_DAYS`           | 180                                               | Urgency saturates here, so a 3-year-old lapse cannot swamp the list |

## `kmPerDay(vehicle, basis)`

The number invariant 2 rests on.

```
km/day = (last reading km − first reading km) / (last date − first date)
```

- `basis: "span"` (default) uses every reading; `"last-two"` uses only the final
  pair. The dashboard exposes the toggle so the modelling choice is auditable.
- One reading, or a zero-day span → `FLEET_MEDIAN_KM_PER_DAY`.
- On PUB-01 the rates run **18–80 km/day**. A fixed interval for every vehicle
  is exactly what the problem statement says will not score.

## `computeItem(vehicle, item, today, opts)`

Returns an `ItemStatus`: due date, days left, status, a plain-English reason,
and the three scoring components.

### fixed_date

Next due **is** the printed expiry. Reason: `fixed date on the paper: 2026-08-25`.

### period_months

```
next due = last service date + every_months   (calendar months)
```

`date-fns` `addMonths` clamps to month end, so 31 Jan + 1 month = 28 Feb, leap
years included. With no history the item is anchored on the vehicle's first
odometer reading, and the reason says so.

### distance_km

```
due km   = (last service km ?? current odometer) + every_km
days     = (due km − current km) / km/day
next due = today + days
```

Two guards worth knowing:

- **No history counts from the current reading, not from zero.** A car reading
  139,157 km with a 10,000 km brake interval would otherwise be ~2,000 days
  "overdue" and head the call list on its first day on the books.
- **Zero km/day never divides.** The item is reported as
  `no usage recorded (0 km/day) — due at 148,000 km, cannot come due`, status
  `fine`, `daysLeft = Infinity`.

The reason string carries the arithmetic:
`last done at 62,853 km, every 40,000 km → due at 102,853 km, now 101,743 —
1,110 km left at 74.3 km/day`.

## `readingProblem(readings, date, km)`

Input validation for the one number the whole distance rule rests on. A mistyped
digit — 101,743 entered as 1,017,430 — lands without complaint, every distance
estimate on the car recomputes off it, and nothing anywhere reports an error;
the vehicle then reads years overdue and heads the call list.

Judged against the vehicle's own history, not a fleet constant:

| Rejected                                                      | Message                                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Below the previous reading                                    | `an odometer does not go backwards: 59,000 km is below the 59,935 km read on 2026-07-31`                |
| Above a later reading (a backdated entry)                     | `70,000 km is above the 61,135 km already read on 2026-08-30`                                           |
| Implies more than 3× this car's km/day, floored at 300 km/day | `611,350 km means 18,341 km/day since 2026-08-30 — this car runs about 40.0 km/day. Check the reading.` |

The 300 km/day floor keeps a genuine Dhaka–Chittagong run from being refused on
a car that normally sits in traffic; a mistyped digit is ≥10× and never squeaks
past. A reading dated the same day **replaces** rather than appends, so it is
judged against the reading before it, not against itself.

`guardReading()` in `case-db.ts` calls it from **both** write paths that can
land a km — a new odometer reading and the km on a recorded service. Guarding
only one would leave the other able to poison the same estimates.

## Classification

```
daysLeft < 0                 → overdue
daysLeft <= opts.dueSoonDays → due_soon
otherwise                    → fine
```

On PUB-01: 45 overdue, 34 due soon, 86 fine, of 165 items.

## Ranking — `urgencyOf` and `buildCallList`

```
score(item)    = cost × urgency × safety
score(vehicle) = Σ score(item) over its non-fine items
```

**Urgency bands, which deliberately never overlap:**

| Status   | Urgency                              | Range       |
| -------- | ------------------------------------ | ----------- |
| overdue  | `1 + min(daysLate, 180) / 30`        | 1.00 → 7.00 |
| due soon | `0.5 × (1 − daysLeft / dueSoonDays)` | 0.00 → 0.50 |
| fine     | `0`                                  | 0           |

Because the bands do not overlap, any overdue item outranks a due-soon item of
the same cost by at least 2×. The overdue band always divides by the constant
30, not by `opts.dueSoonDays`, so widening the due-soon window **re-labels**
items without silently re-scaling how late everything already is.

**Safety weight:** 1.5× for `RISK_ITEMS`, matched on the lowercased item name.
This is why service items come from a closed catalogue and are never typed — a
hand-entered "Tyre" would silently lose the weight and rank the car too low with
no error anywhere.

Each row carries a `composition` string — `Tyres 32,000 × 1.97 × 1.5 = 94,400 +
Engine oil 19,250` — so a row's position is defensible without trusting the sort.

**Return weighting (opt-in).** With `returnWeighting: true`, a vehicle's score
is multiplied by _P(the owner will **not** turn up on their own within 30 days)_
— so the list ranks the calls that change an outcome above the customers who
walk in anyway. The probability is **passed in** as a `wontReturn(vehicleId)`
callback rather than imported, so the engine stays free of I/O and knows nothing
about the model; `due-book-view.ts` supplies it from the hazard table. A vehicle
with no recorded visit weighs 1 — never seen is a reason to call, not to skip —
and the composition string gains
`→ × 0.84 won't come on their own = 98,542`. See
[ml-visit-predictor.md](ml-visit-predictor.md).

**Sort modes:** `score` (default), `most_overdue` (worst `daysLeft` first),
`highest_value` (largest bill first). The alternates exist to show the default is
a deliberate combination of the two, not an accident.

## `buildForecast(data, opts)`

The overdue backlog plus eight 7-day buckets from `today`, each with a job count
and a taka total. The backlog is kept **outside** the weekly bars — folding 45
already-late jobs into week 1 would misrepresent the week.

PUB-01: backlog 45 jobs / ৳387,700; weeks 8/8/8/8/4/3/4/3, ৳486,300 total.

## `reminderMessage(data, ownerId, opts)`

A copy-ready message for one owner, merged across every car they own, items
oldest first, with a taka total. Rendered on the Reminders tab with a copy
button and a `wa.me` deep link — a link, not a WhatsApp API integration, so the
workshop reviews the message and sends it themselves.

## Mutations

Two pure functions returning a **new** `CaseData`:

- `recordService(data, vehicleId, itemName, date?, km?)` — appends the history
  row; requires a km for distance items; appends an odometer reading when the km
  beats the current one; renews a `fixed_date` item's paper by 12 months.
  The reset is not a mutation — it falls out of recomputing from the new
  history, which is why exactly one item can move.
- `addOdometerReading(data, vehicleId, km)` — replaces (not appends) the reading
  dated `today`, so re-entering a correction does not create two readings for
  one day.

`src/lib/case-db.ts` mirrors both as database writes. The pure versions are what
`engine-check.ts` asserts against.

## Engine options

```ts
interface EngineOpts {
  dueSoonDays: number; // 14 / 30 / 45 on the dashboard
  kmBasis: "span" | "last-two";
  riskWeights: boolean;
  returnWeighting: boolean; // defaults OFF
}
```

`DEFAULT_OPTS` is what every fixture in `engine-check.ts` is pinned to, so
passing nothing reproduces the published answers exactly. That is why
`returnWeighting` defaults to **false**: every published number is measured
without it, and switching it on by default would break the fixtures that are
the reason anyone believes the call list.
