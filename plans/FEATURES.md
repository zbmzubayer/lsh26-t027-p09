# P09 — Vehicle Service Due Predictor · Feature List

Scoring: **all four mandatory items are scored.** Three of four on _both_ problems unlocks the early
bonus. Additional features count only once the four mandatory ones already work.

Status key: **Built** = implemented and verified · **Partial** = works, but not the way the row once
claimed · **Open** = not started.

Counts below are for **PUB-01**, the published fixture, so they do not move. Fleet-wide figures
across all 25 cases drift as the app is used and are not quoted here.

---

## Mandatory features

### M1 · Fleet data set

_Scored item 1 — at least 40 vehicles belonging to at least 25 owners._

| #    | Feature                                                                         | Verified by                                         | Status  |
| ---- | ------------------------------------------------------------------------------- | --------------------------------------------------- | ------- |
| M1.1 | Load a case: 27 owners, 42 vehicles, 3–5 service items each                     | PUB-01 in the database; 25 cases seeded             | Built   |
| M1.2 | All three rule types present — `fixed_date`, `period_months`, `distance_km`     | 66 / 57 / 42 of 165 items on PUB-01                 | Built   |
| M1.3 | Current odometer readings, 2–4 per vehicle, ascending                           | Reading list on the vehicle page                    | Built   |
| M1.4 | Past service records with date and, for distance items, km                      | Service history section, grows on record            | Built   |
| M1.5 | Accept an arbitrary case — single object, bare array, or a file wrapping either | `POST /api/run` and `npm run cases`, byte-identical | Partial |

**M1.1** — each account is pinned to one workshop (`9e32881`), so `caseId` comes from the session
and never the client. There is no in-app case picker; the other 24 cases are reachable through
`/api/run` and `npm run cases`.

**M1.5** — the capability is real and validated by `CaseSchema`, but it is headless. There is no
"load a case file" control in the UI, so a judge exercises it from curl or the CLI, not on screen.

### M2 · Next due date and status for every item

_Scored item 2 — compute a due date using each item's own rule; mark overdue, due soon or fine._

| #    | Feature                                                                               | Verified by                                     | Status |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------- | ------ |
| M2.1 | Fixed-date rule — next due is the printed expiry                                      | Insurance, fitness, tax token, battery          | Built  |
| M2.2 | Period rule — last service date + N calendar months, clamped to month end             | 31 Jan + 1 mo → 28 Feb, leap years covered      | Built  |
| M2.3 | Distance rule — due km from history + interval, dated using **that vehicle's** km/day | Per-vehicle rate, 18–80 km/day on PUB-01        | Built  |
| M2.4 | km/day derived from the vehicle's own reading span                                    | Shown on the vehicle page as the arithmetic     | Built  |
| M2.5 | Three-state banding: overdue / due soon (30 days) / fine                              | 45 / 34 / 86 of 165 items on PUB-01             | Built  |
| M2.6 | Plain-English "why that date" on every item                                           | Same string reused by call list, page, reminder | Built  |

### M3 · Daily call list

_Scored item 3 — who to call, which vehicle, which items and why, sorted by an explainable rule._

| #    | Feature                                                   | Verified by                                | Status |
| ---- | --------------------------------------------------------- | ------------------------------------------ | ------ |
| M3.1 | Owner name and phone against each row                     | Call list rows                             | Built  |
| M3.2 | Vehicle identified by model and plate                     | Call list rows                             | Built  |
| M3.3 | Flagged items listed per row with status, cost and reason | Row expands to the item detail             | Built  |
| M3.4 | Ranked by `Σ cost × urgency × safety weight`              | PUB-01 top six reproduced exactly in tests | Built  |
| M3.5 | The score's components shown on screen, per item          | `cost × urgency × weight ≈ score` line     | Built  |
| M3.6 | Ranking beats a raw "everything not fine" list            | 41 ranked vehicles vs 79 loose items       | Built  |

### M4 · Vehicle page and recording a service

_Scored item 4 — every item with next due date and cost; record a service, that item resets, history grows._

| #    | Feature                                                                     | Verified by                 | Status |
| ---- | --------------------------------------------------------------------------- | --------------------------- | ------ |
| M4.1 | Full item table: rule, next due, days, cost, status, why                    | Vehicle page                | Built  |
| M4.2 | Job-card header — odometer, km/day with its basis in words, total value due | Vehicle page header         | Built  |
| M4.3 | Record a completed service, with km required for distance items             | Record-service form         | Built  |
| M4.4 | **Exactly one item resets** — every other next due date unchanged           | Asserted once per rule type | Built  |
| M4.5 | Service history grows and stays in date order                               | History section             | Built  |
| M4.6 | Fixed-date renewals take the new expiry, pre-filled from a renewal term     | 12 mo fitness/insurance/tax | Built  |

---

## Additional features

### A1 · Named in the problem statement

| #    | Feature                                               | Detail                                                                   | Status |
| ---- | ----------------------------------------------------- | ------------------------------------------------------------------------ | ------ |
| A1.1 | Work coming in the next 8 weeks                       | PUB-01: 8/8/8/8/4/3/4/3 jobs, ৳486,300 total; click a week for its jobs  | Built  |
| A1.2 | Overdue backlog shown separately                      | 45 jobs, ৳387,700 — outside the weekly bars so the weeks are not misread | Built  |
| A1.3 | New odometer reading, every distance estimate updates | Names the km/day change and each estimate that moved                     | Built  |
| A1.4 | Copy-ready reminder message per owner                 | One per owner in call-list order, copy button, WhatsApp send             | Built  |

### A2 · Beyond the brief

| #     | Feature                                                          | Why it earns its place                                                  | Status |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| A2.1  | Method tab — rules, ranking formula, three defensible properties | Answers "why is this first" without you in the room                     | Built  |
| A2.2  | Answers JSON export for the whole case                           | The response shape for the hidden-case runner                           | Built  |
| A2.3  | km/day basis toggle — full span vs last two readings             | Makes the modelling choice auditable                                    | Built  |
| A2.4  | Alternate sorts — most overdue, highest value                    | Shows the default is a deliberate combination                           | Built  |
| A2.5  | Distance projections anchor on the reading date, not `today`     | Stays correct once a newer reading is added                             | Built  |
| A2.6  | Odometer sparkline per vehicle                                   | Running pattern readable at a glance                                    | Built  |
| A2.7  | Theme-aware, responsive at 1360 / 820 / 420 px                   | Demo survives whatever screen the judge uses                            | Built  |
| A2.8  | Accounts — jose JWT sessions, argon2 hashing, `proxy.ts` gating  | The register is customer data; it should not be open                    | Built  |
| A2.9  | Search across owners, vehicles and plates                        | 42 vehicles is already too many to scroll                               | Built  |
| A2.10 | Walk-in intake — new customer and car onto the books             | The book has to grow, not just be read                                  | Built  |
| A2.11 | Fit a new service item from a catalogue                          | Cars gain items; a fixed set would go stale                             | Built  |
| A2.12 | **Next-visit prediction** — random forest over 1,549 visit gaps  | Due ≠ when they come. 41.5 d MAE vs 62.5 d baseline, leave-one-case-out | Built  |
| A2.13 | CLI runner — `npm run cases`                                     | Byte-identical to `POST /api/run`, no browser or database               | Built  |

### A3 · Open

| #    | Feature                           | Detail                                                  | Status   |
| ---- | --------------------------------- | ------------------------------------------------------- | -------- |
| A3.1 | Vercel deploy and a live URL      | Next.js port is done; the deploy and `live_url` are not | **Open** |
| A3.2 | In-app case loader                | A paste/upload control so M1.5 is exercisable on screen | Open     |
| A3.3 | Owner-level batching in the model | A customer's cars are scored independently today        | Open     |

---

## Constraints — the four ways this problem is failed

| Constraint                                                                           | Guard                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Distance items must use the vehicle's daily running; a fixed interval will not score | Per-vehicle km/day, asserted; PUB-01 range 18–80              |
| Recording a service must reset **that item only**                                    | One-item-reset test per rule type                             |
| The call list must be sorted by an explainable rule                                  | Formula published in the Method tab, components on every row  |
| `today` is a case field, never the clock                                             | Zero `new Date()` / `Date.now()` anywhere in `src/`, asserted |

---

## Submission checklist

| Item                          | Status                                    |
| ----------------------------- | ----------------------------------------- |
| `README.md`                   | Built                                     |
| `EVENT.md`                    | Built                                     |
| `LICENSES.md`                 | Built                                     |
| `evaluation-manifest.json`    | R1–R4 complete; **`live_url` still TODO** |
| Live URL, opens with no setup | **Open — blocks every scored item**       |
| Team member contributions     | **Two entries still TODO**                |
| `npm run build`               | Passes                                    |
| `npm run lint`                | Passes                                    |
