# API reference

Seven HTTP routes and three Server Actions. Every route is thin: authorise,
parse, delegate to `src/lib/`, serialise.

## Conventions

- **Content type** is `application/json` in both directions.
- **Errors** are `{ "error": "..." }` with an HTTP status. Zod failures are
  rendered with `z.prettifyError()`, so a bad body comes back readable.
- **The workshop is never a parameter.** `requireWorkshop()`
  (`src/lib/api.ts`) reads `caseId` from the session cookie. It cannot be
  swapped in a query string or body to read someone else's book.
- **Write routes return the whole re-assembled case**, so the client has one
  read path.

| Status | Meaning                                                  |
| ------ | -------------------------------------------------------- |
| 400    | Body failed Zod, or a `BadWrite` (business rule)         |
| 401    | Not signed in                                            |
| 404    | No such case or vehicle                                  |
| 409    | Signed in, but the account is not attached to a workshop |
| 500    | Unexpected                                               |

---

## `POST /api/run` — stateless case runner

**The only unauthenticated route, and deliberately so.** This is the judge's
entry point: arbitrary case JSON in, answers out. It never reads or writes the
database.

```bash
curl -X POST http://localhost:3000/api/run \
  -H 'content-type: application/json' \
  -d @src/data/case-pub-01.json
```

Request: a whole `CaseData` object, parsed by `CaseSchema`.

Response (`buildAnswers()` in `src/lib/answers.ts`):

```jsonc
{
  "case_id": "PUB-01",
  "today": "2026-08-30",
  "vehicles": [
    { "vehicle_id": "V01",
      "items": [{ "item": "Tyres", "next_due": "2026-09-15", "days_left": 16,
                  "status": "due_soon", "reason": "…", "score": 4040 }] }
  ],
  "call_list": [
    { "rank": 1, "owner_id": "O18", "owner": "…", "phone": "…",
      "vehicle_id": "V28", "plate": "…", "score": 117690,
      "total_cost_bdt": "50000.00", "composition": "Tyres 32,000 × 1.97 × 1.5 = 94,400 + …" }
  ],
  "workload": { "backlog": {…}, "weeks": [{ "label": "Wk 1", "start": "…", "end": "…", "count": 8, "cost": 61300 }] }
}
```

`days_left` is `null` for an item that can never come due (zero km/day) rather
than `Infinity`, which is not valid JSON.

The answers are built by `buildAnswers()` rather than inline, so this route and
the `npm run cases` CLI cannot disagree for the same file.

---

## `GET /api/case` — the signed-in workshop's book

Returns `loadCase(session.caseId)` — the full `CaseData`. This is the dashboard's
only read.

**401** not signed in · **409** no workshop · **404** the case vanished.

---

## `POST /api/service` — record a completed service

```jsonc
{
  "vehicleId": "V01",
  "itemName": "Air filter",
  "date": "2026-08-30",
  "km": 101743,
}
```

`date` defaults to the case's `today`. `km` is **required for `distance_km`
items** and rejected as a `BadWrite` if missing. A km above the current reading
also appends an odometer reading dated the same day.

Any `km` is checked for plausibility against the vehicle's own history — see
[`readingProblem`](domain-engine.md#readingproblemreadings-date-km) — and a
reading that goes backwards or implies more than 3× the car's km/day comes back
as **400** with the offending number named.

Returns the re-assembled `CaseData`. Exactly one item's next-due date will have
changed.

---

## `POST /api/odometer` — new reading

```jsonc
{ "vehicleId": "V01", "km": 101743 }
```

Upserts the reading dated `case.today` — a same-day correction replaces rather
than appends. Every distance-based estimate on the vehicle recomputes. Returns
the re-assembled `CaseData`.

Implausible readings are rejected with **400**: backwards, above a later
reading, or implying more than 3× the vehicle's own km/day (floored at 300
km/day so a long trip is not refused).

---

## `POST /api/vehicle` — walk-in intake

Customer + car + first odometer reading + service items, in one transaction.

```jsonc
{
  "customer": { "name": "Salma Ahmed", "phone": "01481704039" },
  // …or { "existingId": "O01" } for a customer already on the books
  "model": "Toyota Axio",
  "plate": "Dhaka Metro Cha 76-9961",
  "km": 101743,
  "items": [
    { "name": "Engine oil" },
    { "name": "Insurance", "dueDate": "2027-01-31", "cost": 12500 },
  ],
}
```

`dueDate` is **required for `fixed_date` items and rejected for the other two** —
their due date is worked out, not entered. `cost` overrides the catalogue price.
Item names must be in the catalogue.

Response: `{ "vehicleId": "V43", "case": CaseData }`. The id sits _beside_ the
case rather than inside it, so `CaseData` keeps the published shape.

---

## `POST /api/service-item` — fit one more service

```jsonc
{ "vehicleId": "V01", "name": "Coolant", "dueDate": "…", "cost": 1800 }
```

Same catalogue rules as intake. Rejects an item the vehicle already has.
Returns the re-assembled `CaseData`.

---

## `POST /api/visit` — when will they turn up?

Send **exactly one** of `{ "vehicleId": "V01" }` or `{ "ownerId": "O01" }`
(every vehicle that owner has).

```jsonc
{
  "today": "2026-08-30",
  "source": "live",          // "live" = the FastAPI service answered; "bundled" = fallback
  "note": "…",               // present only when source is "bundled"
  "metrics": { "model_mae_days": 41.5, "baseline_mae_days": 62.5, "n_gaps": 1549, … },
  "intervalDays": { "p10": -67, "p90": 63 },
  "predictions": [{
    "vehicleId": "V01",
    "lastVisit": "2026-07-04",
    "predictedGapDays": 69,
    "predictedVisit": "2026-09-11",      // never earlier than today
    "windowFrom": "2026-07-08",
    "windowTo": "2026-11-22",            // 80% window
    "earliestDue": "2026-08-25",
    "driftDays": 17,                     // predictedVisit − earliestDue
    "willDrift": true,                   // they arrive AFTER something is due
    "basis": "live model — 3 past visits, last 2026-07-04",
    "reason": "last in 2026-07-04, typically back after 69 days — that is 17 days past 2026-08-25, so call them",
    "plate": "…", "model": "…", "ownerId": "O01", "owner": "…", "phone": "…"
  }]
}
```

The route calls the model service **server-side** with a 5-second timeout, so
the tunnel URL never reaches the client bundle and the session check still
applies. It sends only what the model reads — odometer, items, history — never
the plate, model or owner id, because that data would otherwise cross a public
ngrok tunnel for no benefit.

Any failure (unset `ML_URL`, timeout, non-200, unparseable body) falls through
to the bundled table and is reported in `source`. **The button always returns a
date.** See [ml-visit-predictor.md](ml-visit-predictor.md).

Types are exported — import them, do not redeclare:

```ts
import type { VisitPrediction } from "@/lib/visit";
```

---

## Server Actions — `src/actions/auth.action.ts`

Mutations that set cookies, so they are actions rather than routes.

| Action           | Input                       | Result                                                                                 |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `login(data)`    | `{ email, password }`       | Sets the session cookie; `{ success, data: { email } }` or `{ success: false, error }` |
| `register(data)` | `{ name, email, password }` | Creates the user, hashes with argon2, signs them in                                    |
| `logout()`       | —                           | Clears the cookie, redirects to `/login`                                               |

Both return a discriminated `ActionResult` rather than throwing.
`src/services/auth.api.ts` wraps them to throw, so the forms can use TanStack
Query mutations uniformly.

**Login failures are deliberately indistinguishable** — an unknown email and a
wrong password both return "Invalid email or password", so the endpoint is not a
user-enumeration oracle.

A newly registered user has **no `caseId`**, and the dashboard says so rather
than showing another workshop's book. Assigning a workshop is currently a manual
database operation.
