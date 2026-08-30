# Data model

Three files own persistence: the Prisma schema, the Zod contract, and the
assembly layer that converts between rows and the one shape.

## `prisma/schema.prisma`

### Design decisions that are load-bearing

**Dates are `String`, not `DateTime`.** Every date is a plain ISO string
(`"2026-08-30"`). `today` is a field on the case, no date arithmetic ever happens
in SQL, and ISO strings sort chronologically as-is. `DateTime` would only add a
timezone bug.

**Money is `Decimal(10,2)`,** serialised back with `.toFixed(2)` so the assembled
case is byte-identical to the published file.

**`caseId` is part of every key.** Ids are unique only _within_ a case — PUB-01
and PUB-02 both have a `V01`. So `Owner` and `Vehicle` are keyed
`@@id([caseId, id])`, and every foreign key, unique constraint and index carries
`caseId`. Every query must be scoped by it. Getting this wrong hands one
workshop another workshop's data, silently.

### Tables

| Model             | Key                                          | Purpose                                                                                                |
| ----------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `User`            | `id` (uuid7)                                 | Workshop staff login. Not an `Owner` — owners are the customers. `caseId` pins the account to one book |
| `Case`            | `id` (`"PUB-01"`)                            | One published case, carrying that case's `today`                                                       |
| `Owner`           | `[caseId, id]`                               | Customer: name, phone                                                                                  |
| `Vehicle`         | `[caseId, id]`                               | Model, plate; `@@unique([caseId, plate])`                                                              |
| `OdometerReading` | uuid7, `@@unique([caseId, vehicleId, date])` | One reading per vehicle per day — a same-day correction upserts                                        |
| `ServiceItem`     | uuid7, `@@unique([caseId, vehicleId, name])` | `rule` enum + exactly one of `dueDate` / `everyMonths` / `everyKm`; `costBdt`                          |
| `ServiceRecord`   | uuid7                                        | History: date, km (null for period items), cost                                                        |

`User.caseId` is nullable: the seed predates it and `/api/run` needs no user. An
account with no workshop is _told so_ rather than defaulted into someone else's
book — see `src/app/dashboard/page.tsx`.

> Two further models, `VehiclePrediction` and `RetrainRequest`, were dropped:
> nothing in `src/`, `ml/` or `scripts/` ever referenced them, and both tables
> were empty. They are recoverable from git history if a retrain loop is ever
> built.

### Which rule columns are set

`ServiceItem` has three nullable columns and exactly one is set per rule. This is
enforced by the Zod discriminated union at the API boundary, **not** by a CHECK
constraint — the seed and the two write routes are the only writers.

| `rule`          | `dueDate` | `everyMonths` | `everyKm` |
| --------------- | --------- | ------------- | --------- |
| `fixed_date`    | set       | null          | null      |
| `period_months` | null      | set           | null      |
| `distance_km`   | null      | null          | set       |

## `src/lib/case-schema.ts` — the trust boundary

Zod schemas for the published case JSON, exactly as it arrives. Both `POST
/api/run` (arbitrary judge-supplied JSON) and `GET /api/case` (assembled from
Postgres) parse through here, so the engine downstream can assume the invariants
instead of defending against every field.

Beyond field types, four refinements matter:

- `odometer_readings` must be non-empty — `currentKm()` and `kmPerDay()` read
  `.at(-1)`, and an empty list has no current odometer.
- `service_items` must be non-empty.
- Item names must be **unique within a vehicle** — `recordService()` and
  `lastDone()` look items up by name.
- `service_history` may not reference an unknown item, and `vehicle.owner_id`
  must match an owner.

`cost_bdt` is a decimal _string_ (`/^\d+(\.\d{1,2})?$/`), never a float.

## `src/lib/case-db.ts` — Postgres ⇄ `CaseData`

### `loadCase(caseId): Promise<CaseData>`

The single read path. Two queries (case + owners, and vehicles with their three
relations), assembled into the published shape.

Ordering: owners and vehicles by id; readings and history by date ascending —
as the published file has them. `service_items` is the one exception: the file's
order is neither alphabetical nor reconstructible (there is no order column), so
items come back name-ascending. Nothing downstream depends on it — the engine
sorts by score, `lastDone` looks up by name, and every number in `engine-check`
is order-independent.

Absent rule columns are **omitted** from the JSON rather than emitted as `null`,
matching the published file.

### Writes

| Function                 | Mirrors                | Notes                                                                                                                                                    |
| ------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recordServiceDb()`      | `recordService()`      | One transaction: history row, odometer push if the km beats the current reading, +12-month renewal for `fixed_date`. Returns the whole re-assembled case |
| `addOdometerReadingDb()` | `addOdometerReading()` | Upserts the reading dated `case.today`                                                                                                                   |
| `intakeVehicle()`        | —                      | Customer + car + first reading + items, all in one transaction                                                                                           |
| `addServiceItem()`       | —                      | One more service onto a car already on the books                                                                                                         |
| `listCases()`            | —                      | Case ids, `today`, and owner/vehicle counts                                                                                                              |

Every write returns `loadCase(caseId)` so the client has one read path and can
replace its cache rather than invalidate-and-refetch.

Errors are two typed classes, `CaseNotFound` (→ 404) and `BadWrite` (→ 400), so
routes map them to status codes without string-matching messages.

### Intake

`intakeVehicle()` is all-or-nothing on purpose: a vehicle without a reading has
no current odometer and would break `currentKm()`, and one with no items fails
the case's own Zod contract.

`nextId()` allocates the next `V43` / `O28` by parsing the numeric part rather
than taking `max()` of the string, so the 100th vehicle sorts after the 99th.

Validation at intake: model and plate non-empty, plate unique within the case,
km a non-negative integer, at least one item, no duplicate items, phone exactly
11 digits (`01711223344`), and the odometer reading is dated the case's own
`today` — never the clock.

## `src/lib/service-catalogue.ts`

The twelve services this workshop fits. Across all 25 cases these are the only
item names that appear, and each carries exactly **one** rule, one interval and
one price — `min(cost) === max(cost)` on every row.

| Item                | Rule          | Interval  | Cost (৳) | Safety |
| ------------------- | ------------- | --------- | -------- | ------ |
| Engine oil          | period_months | 3 mo      | 3,500    |        |
| Air filter          | period_months | 6 mo      | 1,200    |        |
| Coolant             | period_months | 12 mo     | 1,800    |        |
| AC service          | period_months | 12 mo     | 4,500    |        |
| Brake pads          | distance_km   | 10,000 km | 6,000    | ✔      |
| Spark plugs         | distance_km   | 20,000 km | 2,400    |        |
| Tyres               | distance_km   | 40,000 km | 32,000   | ✔      |
| Timing belt         | distance_km   | 80,000 km | 15,000   |        |
| Fitness certificate | fixed_date    | —         | 2,500    | ✔      |
| Insurance           | fixed_date    | —         | 12,000   | ✔      |
| Tax token           | fixed_date    | —         | 6,500    |        |
| Battery warranty    | fixed_date    | —         | 9,000    |        |

This is why intake is a picker, not a text box: `RISK_ITEMS` in the engine
matches on the lowercased name, so a typed "Brake pad" would silently lose the
1.5× weighting. **The price is editable at intake** — workshop prices drift —
but the rule and the interval are not.

`KNOWN_MODELS` offers the ten most common vehicle models as a datalist; the
field itself is free text.

## Dataset size

|                                 | Count |
| ------------------------------- | ----- |
| Cases (workshops)               | 25    |
| Vehicles                        | 1,052 |
| Owners                          | 677   |
| Service items                   | 4,197 |
| Visits (distinct service dates) | 2,600 |
| Observed inter-visit gaps       | 1,549 |

PUB-01, the published fixture, is 27 owners / 42 vehicles / 165 items and is
pinned — `engine-check.ts` asserts its exact answers, so it must not be written
to through the UI.
