# Plan — taking a walk-in customer onto the books

A customer arrives at the workshop with a car nobody has seen before. By the end
of the visit their name, their car, and everything that car is due for should be
in the system, and the car should appear on tomorrow's call list on its own.

Today there is no way in: every owner, vehicle, item and reading came from the
seed. This is the plan to close that.

Constraints that do not bend: `today` is a case field (never the clock), every
write is scoped to the session's workshop, and the engine stays as
`engine-check` pins it.

---

## Phase 0 — the blocker (**done**, commit `8c548a5`)

A hand-entered car has no service history, and the distance rule counted from
zero when history was missing:

```
before   Tyres   due 2021-05-04   -1944 days   OVERDUE   "due at 40,000 km, now 139,157"
after    Tyres   due 2028-10-22    +784 days   fine      "no history — counted from
                                                          the current reading at 139,157 km"
```

Every intake would have produced four bogus overdue items and poisoned the
ranking. Fixed, with a fixture pinning the new shape; all published numbers
unmoved.

---

## The shape of the feature

One intake form, three sections, because a walk-in is a single event — not three
errands:

```
┌─ New car on the books ──────────────────────────────┐
│  1. Customer   ( ) existing  [ Salma Ahmed      ▾ ]  │
│                (•) new       [ name ] [ phone ]      │
│  2. Car        [ model ▾ ] [ plate ] [ odometer now ]│
│  3. Services   ☑ Engine oil      every 3 mo   3,500  │
│                ☑ Brake pads      every 10k km 6,000  │
│                ☑ Insurance       expires [____] 12,000│
│                ☐ …                                    │
│                                      [ Add to books ] │
└──────────────────────────────────────────────────────┘
```

A returning customer bringing a second car uses the same form with "existing"
ticked. Adding a service to a car already on the books is a separate, smaller
action on that car's page.

---

## Phase 1 — the service catalogue

The 25 cases contain exactly **twelve** service types, and each has a fixed
rule, interval and cost — `min(cost) == max(cost)` across all 4,188 rows. This
is a closed vocabulary:

| Service             | Rule          | Interval | Cost (Tk) | Safety/legal ×1.5 |
| ------------------- | ------------- | -------- | --------: | :---------------: |
| Engine oil          | period_months | 3        |     3,500 |                   |
| Air filter          | period_months | 6        |     1,200 |                   |
| Coolant             | period_months | 12       |     1,800 |                   |
| AC service          | period_months | 12       |     4,500 |                   |
| Brake pads          | distance_km   | 10,000   |     6,000 |         ✓         |
| Spark plugs         | distance_km   | 20,000   |     2,400 |                   |
| Tyres               | distance_km   | 40,000   |    32,000 |         ✓         |
| Timing belt         | distance_km   | 80,000   |    15,000 |                   |
| Fitness certificate | fixed_date    | —        |     2,500 |         ✓         |
| Insurance           | fixed_date    | —        |    12,000 |         ✓         |
| Tax token           | fixed_date    | —        |     6,500 |                   |
| Battery warranty    | fixed_date    | —        |     9,000 |                   |

New file `src/lib/service-catalogue.ts` holds exactly this and nothing else.

**Why a picker, not a text box.** `RISK_ITEMS` matches on the lowercased item
name. Someone typing "Brake pad" or "Tyre" silently loses the 1.5× safety
weighting — the car ranks too low and nothing reports an error. A closed list
makes that impossible. The user picks a name; rule, interval and cost fill
themselves in. Cost stays editable, rule and interval do not.

---

## Phase 2 — write functions (`src/lib/case-db.ts`)

No schema change: `Owner`, `Vehicle`, `ServiceItem` and `OdometerReading`
already hold all of this. Same shape as `recordServiceDb` — validate, write in
one transaction, return `loadCase(caseId)` so the UI replaces its cache from the
single read path.

```ts
nextId(tx, caseId, "Vehicle")  // -> "V43"   max(id) + 1, zero-padded
nextId(tx, caseId, "Owner")    // -> "O28"

intakeVehicle(caseId, {
  customer: { existingId: "O07" } | { name, phone },
  model, plate,
  km,                                    // what the odometer reads right now
  items: [{ name, dueDate?, cost? }],    // >= 1, names from the catalogue
})

addServiceItem(caseId, vehicleId, { name, dueDate?, cost? })
```

`intakeVehicle` writes in one transaction: the customer (if new), the vehicle,
**one odometer reading dated `case.today`**, and the chosen service items. All or
nothing — a half-created car with no reading would break `currentKm()`.

### Rules these enforce

| Rule                                                        | Why                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| ≥ 1 odometer reading                                        | `VehicleSchema` requires it; `currentKm()` reads `.at(-1)`                                                               |
| ≥ 1 service item                                            | `VehicleSchema` requires it — a 0-item vehicle makes the whole case fail its own contract and `/api/run` would reject it |
| Name must be in the catalogue                               | keeps the safety weighting honest                                                                                        |
| `fixed_date` ⇒ expiry date required                         | it is off the printed paper; nothing else can know it                                                                    |
| `period_months` / `distance_km` ⇒ **reject** an expiry date | those dates are computed, never entered                                                                                  |
| Plate unique within the workshop                            | `@@unique([caseId, plate])` — turn the constraint error into "that plate is already on the books as V17"                 |
| Item name unique per vehicle                                | `@@unique([caseId, vehicleId, name])` — already-fitted services are greyed out in the picker                             |
| Reading dated `case.today`                                  | never `new Date()`                                                                                                       |
| Phone: digits, 11 chars                                     | matches the `01XXXXXXXXX` shape every seeded owner uses                                                                  |

---

## Phase 3 — routes

Two, both behind `requireWorkshop()`, both taking the workshop from the session
and never from the body — same as the existing writes.

```
POST /api/vehicle       -> CaseData    (customer + car + services, one call)
POST /api/service-item  -> CaseData    (one service onto an existing car)
```

Customer creation folds into `POST /api/vehicle`: you never register a customer
who owns no car, and one call keeps the transaction honest.

`/api/run` is untouched — stateless, and it never sees any of this.

---

## Phase 4 — UI

**Intake form** — "Add a car" button on the Vehicles tab, opening a `.panel`:

- **Customer** — radio: existing (`<select>` of the workshop's customers, showing
  name and phone) or new (name + phone)
- **Car** — model as text with a `<datalist>` of the ten models already in the
  data; plate with placeholder `Dhaka Metro Ga 12-3456`; odometer now, required
- **Services** — the twelve catalogue rows as checkboxes with their interval and
  cost shown; ticking a `fixed_date` one reveals its expiry field; cost editable
- Submit disabled until at least one service is ticked

**Add a service later** — on the vehicle page, beside "Record a completed
service": a picker of catalogue entries not already fitted, plus an expiry field
when the pick is `fixed_date`.

Both reuse the existing `.panel` / `.field` / `.flash` styles. No new CSS.

On success the flash closes the loop by showing the thing they just made,
working:

> _V43 Toyota Axio added for Salma Ahmed with 4 services. First due: Insurance,
> 12 Sep 2026 — 13 days._

---

## Phase 5 — verification

1. `engine-check` passes unchanged — the intake path must not disturb any
   published number.
2. Intake a car with all three rules represented; re-fetch `/api/case` and assert
   it parses through `CaseSchema` — the contract `/api/run` is graded on.
3. Assert no item on the new car is overdue on day one. This is the Phase 0
   regression, and it is the one that would quietly wreck the call list.
4. Same plate twice ⇒ readable 409, not a Prisma stack trace.
5. Intake a car, then record a service against it — its date moves and no other
   item on that car does. The existing reset guarantee has to hold for
   hand-entered data too.
6. Add a service to a car that already has it ⇒ rejected, not a duplicate row.

---

## Deliberately out of scope

Editing or deleting customers, cars and services; a customer-management screen;
document or photo upload; bulk import. None are needed to show the feature
working, and each adds a way to break a case that currently cannot be broken.

## Open questions

1. **Free-text service names** — recommend no. The catalogue plus an editable
   cost covers real use without risking the safety weighting.
2. **Defining a thirteenth service type** — recommend not yet. It needs a rule
   and interval chosen by hand, which is a different and more expert form.
3. **Past service records at intake** — the form above records none, so a new
   car's items count from its current odometer and its intake date. If the
   customer brings a service book and you want to enter "brake pads done at
   120,000 km", that is a fourth section and a slightly bigger job. Worth it only
   if you want the demo to show a car arriving already overdue.
