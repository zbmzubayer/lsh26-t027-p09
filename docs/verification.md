# Verification

There is no test framework here. Verification is `assert`-based self-checks that
run as plain scripts, plus the type checker, the linter and the build.

That is a deliberate trade for a four-hour event, and it is listed as a
limitation in `evaluation-manifest.json`. What it buys: the checks are readable
top to bottom, need no config, and assert **the documented answers** rather than
re-implementing the logic they are checking.

## `src/lib/engine-check.ts` — the domain

```bash
npx tsx src/lib/engine-check.ts
```

Three blocks:

**1. A hand-built fixture** (Rahim Uddin / Toyota Axio) that pins the arithmetic
of each rule:

- `kmPerDay` is exactly 30 over a 30-day, 900 km span
- Insurance due in 5 days → `due_soon`; air filter → `2026-08-26`, `overdue`;
  brake pads → `daysLeft = 0`, `due_soon`
- One call row, `worstDaysLeft = -4`, score 13,360
- **Recording a service resets one item**: history grows to 3, the serviced
  item's date moves, and every other date is unchanged — asserted once per rule
  type
- `recordService` on a distance item **throws** without a km
- A new odometer reading raises km/day and moves the distance estimate
- 31 Jan + 1 month = 28 Feb (month-end clamping, leap years)
- A newly entered car's tyres are `fine`, not overdue — the no-history-counts-
  from-current-reading guard

**2. PUB-01, from the committed JSON fixture:**

- The top six call-list rows, exactly (V28 at 117,690 down to V07 at 64,000)
- Backlog: 45 jobs, ৳387,700
- All eight weekly buckets
- Per-item due dates, days left and statuses for named vehicles

**3. The same PUB-01 assertions against the case assembled out of Postgres.**

Block 3 is the one that earns its keep. It means any drift in the persistence
layer — a wrong join, a lost decimal, a reordered relation — shows up as a
**wrong number**, not as a subtly wrong ordering nobody notices. It skips itself
with a message when `DATABASE_URL` is unset, so a fresh clone still gets blocks
1 and 2.

## `src/lib/visit-check.ts` — the model

```bash
npm run check:visit
# or, against a running service:
ML_URL=http://127.0.0.1:8010 npx tsx src/lib/visit-check.ts
```

Asserts the silent-wrong-answer bugs, which is what matters for a model:

- No prediction is earlier than `today` (censoring clamp)
- Every prediction sits inside its own 80% window
- Each prediction is aligned with its own vehicle
- Recording a service **moves** the prediction — a model that ignores new
  history is worse than no model
- The bundled table and the live service agree, so a stale committed table is
  caught rather than shipped

## `ml/visit_model.py` and `ml/return_model.py` — self-checks

Both end in a `check()` that runs on every training run and asserts the claim
the file exists to make:

| Assertion                                                                                  | Why                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Model MAE < baseline MAE                                                                   | If it loses to the median, it should not ship                                  |
| 0 of 12 shuffled-label refits beat it                                                      | With nine features on 1,549 rows, fitting noise is a real risk worth measuring |
| No case dropped from the output                                                            | Silent data loss                                                               |
| Every vehicle's table is keyed under its own case                                          | Getting this wrong hands one workshop another's prediction                     |
| No predicted visit in the past                                                             | Censoring                                                                      |
| Brier < baseline Brier; no hazard equals 1.0; horizons monotonic; censored spells retained | The hazard model's equivalents                                                 |

## `src/lib/auth-check.ts` — accounts

```bash
npm run check:auth
```

No database and no request. It pins the two things that are silently wrong when
they break:

- **`sessionIsStale(iat, passwordChangedAt)`** — false when the password has
  never changed, true for a token issued before a change, false for one issued
  after, **false for the cookie the change itself re-issued** (the millisecond
  trap: `iat` is whole seconds, `passwordChangedAt` is not), and true when a
  token carries no `iat` at all. Too strict logs a user out of their own
  password change; too loose leaves whoever knew the old password signed in for
  another week.
- **`changePasswordSchema` and `addUserSchema`** — a short password, an empty
  current password, and a new password identical to the old one are all refused;
  a valid colleague is accepted.

Two things it cannot cover, because they cross the session boundary and a mock
would only be testing itself — do them by hand once:

1. A manager adds a user → sign in as them → they see that workshop's book and
   only that one.
2. Change the password in one browser → the other browser's session is dead on
   its next request, and the browser that made the change is still signed in.

## `npm run cases` — the CLI runner

```bash
npm run cases -- src/data/case-pub-01.json
npm run cases -- ml/cases.json --out answers.json
```

Answers for one or more case files with no browser and no database. It accepts
the three shapes a case can arrive in — a single object, a bare array, or a file
wrapping either under `case` / `cases` — and produces output from the **same**
`buildAnswers()` as `POST /api/run`, so the two cannot disagree.

A case that fails `CaseSchema` **exits non-zero**. Silently skipping it would
report fewer answers than the judge handed over and look like a pass.

## Static checks

```bash
npx tsc --noEmit     # types
npm run lint         # Biome (check)
npm run format       # Biome (write)
npm run build        # next build
```

Husky + lint-staged run Biome on staged files at commit time
(`.husky/pre-commit`, `lint-staged.config.mjs`).

## Suggested order before a demo

```bash
npm run db:generate
npx tsc --noEmit
npx tsx src/lib/engine-check.ts   # domain, file + database
npm run check:visit               # model
npm run check:auth                # sessions and the account forms
npm run lint
npm run build
```
