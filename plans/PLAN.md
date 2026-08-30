# P09 — Vehicle Service Due Predictor: Build Plan

Detailed, executable plan for the whole system. Phases 1–4 are **built, but on a
side branch** (see _Repo state_ below) and documented here so they can be rebuilt
or extended from scratch. Phases 5–7 are the remaining backend + ML work.

Golden rule for everything: **`today` is a case field, never the clock.**
No `new Date()` / `Date.now()` anywhere in the engine.

---

## Repo state (read this before Phase 5)

The two halves of this project are on **different branches**, and neither half
builds on its own:

| Branch                                            | Head      | Has                                                                                               | Missing                                  |
| ------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `claude/vehicle-service-predictor-249e72` (PR #1) | `5f17971` | engine, engine-check, `case-pub-01.json`, the whole UI                                            | forked from `756a7ce` — no Prisma at all |
| `main`                                            | `d1fd190` | Prisma scaffold (`prisma/schema.prisma`, `prisma.config.ts`, `src/lib/prisma.ts`), TanStack Query | no engine, boilerplate `page.tsx`        |

Known breakage to clear first:

- Dependencies were never installed: `node_modules` had no `@prisma/client` and
  no `prisma` CLI, so `src/lib/prisma.ts` (`import ... from
"@/generated/prisma/client"`) could not resolve and `next build` failed on
  `main`. `npm install` has now been run; **`npx prisma generate` still has to
  run** to create `src/generated/prisma`.
- `prisma.config.ts` and `prisma7.config.ts` are near-duplicates, and the CLI
  loads **`prisma7.config.ts`** (confirmed: `Loaded Prisma config from
prisma7.config.ts`). Delete `prisma7.config.ts` and keep the `env()`-based
  `prisma.config.ts`, or the `DATABASE_URL` wiring silently comes from the wrong
  file.
- `prisma/schema.prisma` shipped with a placeholder `User` model. Removed — the
  real schema is Phase 5.

---

## Phase 1 — Data contract (`src/lib/engine.ts` types + `src/data/case-pub-01.json`)

Model the published JSON exactly; never mutate it. Every mutation returns a
**new** case object.

```ts
type CaseData = {
  case_id: string;
  today: string; // "2026-08-30"
  owners: { id; name; phone }[]; // ≥25 (PUB-01 has 27)
  vehicles: Vehicle[]; // ≥40 (PUB-01 has 42)
};
type Vehicle = {
  id;
  owner_id;
  model;
  plate: string;
  odometer_readings: { date: string; km: number }[]; // ascending, last dated today
  service_items: ServiceItem[]; // 3–5 per vehicle
  service_history: { item; date; km: number | null; cost_bdt: string }[];
};
type ServiceItem =
  | { name; rule: "fixed_date"; due_date: string; cost_bdt: string }
  | { name; rule: "period_months"; every_months: number; cost_bdt: string }
  | { name; rule: "distance_km"; every_km: number; cost_bdt: string };
```

Invariants in the public data (defensive code beyond these is noise):

- period/distance items have exactly one history row; fixed_date items have none
- distance history rows carry `km`; period rows carry `km: null`
- readings strictly increase; current odometer = `readings.at(-1).km`
- `cost_bdt` is a decimal **string** — `Number()` it once at the boundary

Seed: `src/data/case-pub-01.json` (the PUB-01 case verbatim).

---

## Phase 2 — Pure engine (`src/lib/engine.ts`)

No React, no fetch, no clock. date-fns for all date math (`addMonths` clamps to
month end: 2026-01-31 + 1m = 2026-02-28).

### Constants

```
DUE_SOON_DAYS = 30
FLEET_MEDIAN_KM_PER_DAY = 51       // fallback for single-reading vehicles
LATE_CAP_DAYS = 180                // urgency saturation
RISK_ITEMS = { brake pads, tyres, fitness certificate, insurance }  // 1.5×
```

### `kmPerDay(vehicle)`

`(last_km − first_km) / days(first_date → last_date)` over **all** readings.
Fallbacks: single reading → 51; span ≤ 0 days → 51. May return 0 (no usage).

### `computeItem(vehicle, item, today) → ItemStatus`

Per rule:

- **fixed_date**: `dueDate = item.due_date`
- **period_months**: `dueDate = addMonths(lastHistoryDate, every_months)`;
  no history → anchor on earliest odometer reading date (say so in `reason`)
- **distance_km**:
  ```
  dueKm     = lastHistoryKm + every_km
  daysToDue = round((dueKm − currentKm) / kmPerDay(vehicle))
  dueDate   = today + daysToDue
  ```
  `kmPerDay ≤ 0` → status fine, daysLeft = ∞, reason "cannot come due", never divide

Then:

```
daysLeft = calendarDays(dueDate − today)
status   = daysLeft < 0 ? overdue : daysLeft ≤ 30 ? due_soon : fine
urgency  = overdue  → 1 + min(−daysLeft, 180) / 30      // 1.00–7.00
           due_soon → 0.5 × (1 − daysLeft / 30)          // 0.00–0.50
           fine     → 0
risk     = RISK_ITEMS has item ? 1.5 : 1
score    = cost × urgency × risk
```

`ItemStatus = { vehicleId, item, cost, dueDate, daysLeft, status, reason, urgency, risk, score }`
The human `reason` string is generated **here** — every screen prints the same
sentence.

### `buildCallList(data, sort = "score") → CallRow[]`

One row per owner+vehicle with any non-fine item.

- `score = Σ item scores`, items sorted score-desc inside the row
- `composition` string: `"Tyres 32,000 × 1.97 × 1.5 = 94,400 + Engine oil 19,250 + …"`
- sorts: `score` (default, desc) · `most_overdue` (min daysLeft asc) ·
  `highest_value` (total cost desc)

### `buildForecast(data) → { backlog, weeks[8] }`

Backlog = items with daysLeft < 0 (count + Σ cost). Weeks: bucket
`floor(daysLeft / 7)` for daysLeft in [0, 56).

### `reminderMessage(data, ownerId) → string`

```
Assalamu alaikum {name}. Your {model} ({plate}) is due for:
 • {item} — overdue by N days | due today | due in N days — ৳cost
Estimated total ৳X. Reply or call to book a slot.
```

Items due-date order oldest first; multi-vehicle owners get one message.

### Mutations (return new CaseData)

- `recordService(data, vehicleId, itemName, date?, km?)`
  1. distance items **require** km — throw without one
  2. push `{ item, date, km: km ?? null, cost_bdt }` onto history
  3. km > last reading → also append an odometer reading
  4. fixed_date items renew `due_date = date + 12 months` (extra beyond the
     guide; makes "mark done" visible on insurance/fitness)
     Reset falls out of recomputation — **exactly one item's next_due changes.**
- `addOdometerReading(data, vehicleId, km)` — replace/append reading dated
  `today`; every distance estimate recomputes automatically.

---

## Phase 3 — Verification (`src/lib/engine-check.ts`)

Run: `npx -y tsx src/lib/engine-check.ts`. Assert-based, no framework.
Must reproduce **exactly**:

1. Format-note example (Toyota Axio): km/day 30; insurance +5d due_soon;
   air filter 2026-08-26 overdue; brake pads 0d due_soon; row score 13,360;
   recordService resets only the filter; distance record without km throws;
   new reading 62,835 flips pads overdue.
2. PUB-01 / V28 fixture (all three rules on one vehicle, km/day = 2210/123 = 17.97):

   | Item                | Next due   | Days | Status  |
   | ------------------- | ---------- | ---- | ------- |
   | Engine oil          | 2026-04-17 | −135 | overdue |
   | Air filter          | 2026-06-20 | −71  | overdue |
   | Tyres               | 2026-08-01 | −29  | overdue |
   | Fitness certificate | 2027-01-14 | +137 | fine    |
   | Battery warranty    | 2027-03-16 | +198 | fine    |

3. PUB-01 top-6 call list (vehicle, rounded score): V28 117,690 · V15 91,100 ·
   V16 79,338 · V41 77,625 · V27 74,637 · V07 64,000.
4. Backlog: **45 jobs, ৳387,700**. Weekly buckets (count, ৳): (8, 80,100)
   (8, 121,700) (8, 111,500) (8, 69,800) (4, 53,500) (3, 10,200) (4, 28,700)
   (3, 10,800).

Any mismatch = engine bug. (Historical trap: a 30 km/day fallback on
zero-usage vehicles inflated the backlog to ৳410,700 — the 0-rate guard fixed it.)

---

## Phase 4 — UI (`src/app/page.tsx`, single client page)

`useState<CaseData>(seed)`; mutations feed `setData`; everything else is
`useMemo` off `data`. Three tabs:

1. **Daily call list** — rule sentence printed, sort dropdown (score /
   most overdue / highest value), ranked cards: `#n owner · phone · model ·
plate`, score + total ৳, mono composition line, item rows
   (status badge, due label, reason, cost), Copy-reminder button (clipboard).
2. **Vehicles** — filterable list with worst-status dot; detail card: owner,
   odometer, km/day; odometer form (`min = currentKm`); per-item rows with
   "Mark done today" (passes `currentKm` as km for distance items); history
   date-desc.
3. **8-week forecast** — Overdue backlog bar (red) + Wk1–8 bars, `count · ৳cost`,
   widths scaled to max.

Header strip: today · vehicles · owners · overdue count · due-soon count ·
৳backlog. Status colors: overdue destructive, due_soon amber, fine outline.

Gates: `npx biome check` clean, `npx next build` clean, engine-check passes.

---

## Phase 5 — Persistence: Prisma + hosted Postgres

**5.0 — Merge first.** `git merge claude/vehicle-service-predictor-249e72` into
`main`. Expect conflicts in `src/app/page.tsx` and `src/app/layout.tsx` (main's
`d1fd190` touched both) — take the branch's side, it is the real UI. Then
`npm install && npx prisma generate`, and confirm `npx -y tsx
src/lib/engine-check.ts` still prints all-passed. Nothing below is worth
starting until that command is green on `main`.

**5.1 — The contract lives in Zod** (`src/lib/case-schema.ts`, written).
`POST /api/run` is fed arbitrary JSON by a judge, so the case shape is a trust
boundary and gets parsed, not trusted. The schemas mirror the published JSON
field-for-field (snake_case included) and the types are inferred from them:

- `ServiceItemSchema` is a **discriminated union on `rule`**, so `due_date`,
  `every_months` and `every_km` are each required exactly where they belong.
  `engine.ts` deletes its hand-written `interface ServiceItem` and imports the
  inferred types instead — which also lets the `item.due_date ?? today` and
  `?? 0` fallbacks go, since TS now narrows them per branch.
- Refinements encode the invariants the engine actually relies on: at least one
  odometer reading (`currentKm` reads `.at(-1)`), service-item names unique per
  vehicle (`lastDone`/`recordService` look items up by name), no history row
  pointing at an unknown item, every `owner_id` resolving to an owner.
- Verified against the real `case-pub-01.json`: parses; a `distance_km` item
  carrying `every_months` and a history row naming a missing item are both
  rejected.

**5.2 — Prisma schema** (`prisma/schema.prisma`, written). Decisions worth
defending at the demo:

- **Dates are `String`, not `DateTime`.** `today` is a case field, no date math
  ever happens in SQL, and ISO strings already sort chronologically. `DateTime`
  would buy nothing and cost a timezone bug.
- **Money is `Decimal(10,2)`**; the API serialises it back with `.toFixed(2)`.
- **`Case` is a singleton config row** (`id`, `today`) that nothing points at.
  One workshop, one case, so `Owner.id`/`Vehicle.id` stay the case's own ids
  (`O01`, `V01`) and joins stay trivial. `/api/run` is stateless, so a second
  case never needs storage. `ponytail:` comment in the file names the upgrade
  path (add `caseId` to those PKs) if that ever changes.
- **Two unique constraints encode engine assumptions**, so the DB fails loudly
  instead of the engine failing quietly: `@@unique([vehicleId, name])` on
  `ServiceItem`, `@@unique([vehicleId, date])` on `OdometerReading` (which is
  what makes `addOdometerReading`'s replace-today semantics an `upsert`).
- `enum Rule { fixed_date period_months distance_km }` — snake_case on purpose,
  so the JSON value passes through with zero mapping code.
- `ServiceRecord` FKs to `ServiceItem` rather than repeating the item name.
- `VehiclePrediction` (PK = `vehicleId`) and `RetrainRequest` are in from the
  start so Phase 6 needs no second migration.

**5.3 — API routes.** Thin; the engine stays pure and shared.

- `GET /api/case` → assemble and return **byte-identical CaseData** —
  `cost_bdt` back to a `"32000.00"` string, dates as-is. This is the whole point:
  engine, UI and `engine-check.ts` are untouched by persistence, and
  `case-pub-01.json` stays valid as the offline fixture.
- `POST /api/service` → `recordService` semantics as DB writes: insert the
  `ServiceRecord`, upsert the odometer reading when `km` exceeds the current
  one, **and update `ServiceItem.dueDate` for `fixed_date` items** (the renewal
  is easy to drop on the way to SQL). Reject a `distance_km` item with no `km`,
  same as the pure function.
- `POST /api/odometer` → upsert on `(vehicleId, today)`.
- Both writes **return the freshly re-assembled CaseData** so there is exactly
  one read path and the UI just replaces its state.
- `POST /api/run` → `CaseSchema.parse(body)` → engine → `{ vehicles, callList,
workload }`. Never touches the DB.

**5.4 — Seed** (`prisma/seed.ts`): load `case-pub-01.json`, write the `Case`
row's `today` from the file. No clock.

**5.5 — The check that matters.** Extend `engine-check.ts` to run its PUB-01
assertions against the **DB-assembled** case as well as the JSON: same top-6
scores, same 45-job / ৳387,700 backlog, same weekly buckets. Any drift in the
assembly layer shows up as a number, not as a subtly wrong call list.

**5.6 — UI switch.** Seed → `useQuery` on `/api/case`; mutations `POST` and
replace the cache with the returned case. TanStack Query is already installed.

## Phase 6 — ML, model on the local PC

Two codebases, one deployment. The hosted DB is the bridge; production never
depends on the PC being on.

- **Keep `CaseData` pure.** Predictions must _not_ be folded into `/api/case`,
  or the 5.5 contract check breaks. Serve them from `GET /api/predictions` and
  thread them in at exactly one place: `vehicleStatuses(v, today, rateOverride?)`
  passing through to `computeItem`, with `kmPerDayPred ?? kmPerDay(vehicle)`.
  One optional parameter is the entire integration.
- **Local Python project** (`~/pet/ls-hackathon`, uv): `train.py` —
  `pandas.read_sql` → features per vehicle → GradientBoosting for next-interval
  km/day, logistic/RF for lateness risk (labels reconstructed from history) →
  upsert `VehiclePrediction`. joblib to persist.
- **Be honest about the data ceiling.** PUB-01 has 42 vehicles and 99 history
  rows — exactly one completed service per period/distance item, and none for
  `fixed_date` items. That is not enough to beat a trailing average on merit.
  So: report MAE against the naive trailing average and AUC against 0.5, and
  **when the model does not beat the baseline, leave the prediction rows empty
  and let the rule engine run.** A judged "we measured it and the rule wins"
  scores better than a model that quietly makes the call list worse.
- **Retrain loop**: `poller.py` does `while True: claim a pending RetrainRequest
→ train → mark done`. The Retrain button just inserts a row. Full refit each
  time — the data is tiny.
  `ponytail:` one poller assumed; claim with a conditional
  `UPDATE ... WHERE status='pending'` if a second one ever runs.
- Stale or missing predictions fall back silently. Show `trainedAt` and a
  "model / rule" chip so the fallback is visible rather than hidden.

## Phase 7 — Ship

- README (run, verify, architecture), `evaluation-manifest.json`, LICENSES.md.
- `engine-check.ts` wired into the pre-commit hook — the fixtures are the spec.
- Deploy to Vercel; the live URL must work with the laptop closed. Demo that
  deliberately: the rule-engine fallback is the reason it does.
- Demo script: call list → composition arithmetic ("why is this first") → mark
  done (one row moves) → odometer update (all distance estimates shift) →
  forecast → copy reminder → retrain button.

## What loses points (guardrails for every phase)

1. Any call to the clock in engine code.
2. A fixed interval on distance items — must use that vehicle's own km/day.
3. A service reset touching more than one item — asserted, not eyeballed.
4. A call-list order you can't defend row by row — print the arithmetic.
5. Naive month math that rolls over month ends.
6. `cost_bdt` reaching a component as a string.
7. A DB assembly that drifts from the published JSON shape — the fixtures in
   `engine-check.ts` must produce identical numbers from Postgres and from the
   file, or the call list is being ranked on different data than it claims.
