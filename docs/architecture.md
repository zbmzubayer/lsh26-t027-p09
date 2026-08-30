# Architecture

## What the application is

A car servicing workshop in Dhaka looks after a few hundred customer vehicles.
Every vehicle has parts with their own service life, and the workshop currently
finds out something was due when the customer arrives with a problem. This
application computes what is due on every vehicle, ranks who to ring today, and
records the work when it is done.

## The four invariants

Everything below exists to keep these four true. Break one and the numbers stop
being defensible.

| #   | Invariant                                                          | Enforced by                                                                                                             |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | **`today` is a field on the case, never the system clock.**        | No `new Date()` / `Date.now()` anywhere in `src/`; `today` is a column on `Case` and a field on the case JSON           |
| 2   | **Distance items are projected from _that vehicle's_ own km/day.** | `kmPerDay()` in `engine.ts`, derived from the vehicle's odometer span; asserted in `engine-check.ts`                    |
| 3   | **Recording a service resets exactly one item.**                   | Reset falls out of recomputation, not mutation; the UI names the item whose date moved and counts the ones that did not |
| 4   | **The call list is ranked by a published, explainable formula.**   | `score = Σ cost × urgency × safety`, printed per row and on the Method tab                                              |

## Layers

```
                    ┌───────────────────────────────────────────┐
   browser  ───────▶│  src/app  (Next.js 16 App Router)         │
                    │    /                landing               │
                    │    /login /register auth pages            │
                    │    /dashboard       the due book          │
                    └──────────────┬────────────────────────────┘
                                   │  fetch (TanStack Query)
                    ┌──────────────▼────────────────────────────┐
                    │  src/app/api/*  seven thin routes         │
                    │  src/actions/*  auth Server Actions       │
                    └──────┬─────────────────────┬──────────────┘
                           │                     │
              ┌────────────▼──────────┐   ┌──────▼───────────────┐
              │ src/lib/case-db.ts    │   │ src/lib/visit.ts     │
              │ Postgres <-> CaseData │   │ behavioural model    │
              └────────────┬──────────┘   └──────┬───────────────┘
                           │                     │  (optional HTTP)
              ┌────────────▼──────────┐   ┌──────▼───────────────┐
              │ PostgreSQL (Prisma 7) │   │ ml/serve.py, FastAPI │
              └───────────────────────┘   └──────────────────────┘

                    ┌───────────────────────────────────────────┐
   every path ─────▶│  src/lib/engine.ts   pure, no I/O         │
                    │  the only place a due date is decided     │
                    └───────────────────────────────────────────┘
```

## The one shape

There is exactly one data shape in this application: `CaseData`, defined by Zod
in [`src/lib/case-schema.ts`](../src/lib/case-schema.ts) and inferred as
TypeScript types from there.

- The published fixture `src/data/case-pub-01.json` **is** that shape.
- `loadCase()` assembles that shape out of Postgres, byte-identical — money via
  `Decimal.toFixed(2)`, dates as plain ISO strings, absent keys omitted rather
  than set to `null`.
- `POST /api/run` parses arbitrary judge-supplied JSON into that shape.
- The engine, the UI, the CLI runner and the self-checks all consume that shape.

So the same code runs over a file, over the database, or over a case nobody has
ever seen, and cannot give three different answers.

## Request flow, worked example

Recording a service on the dashboard:

1. `VehicleDetail` (presentational) calls `onRecord` from `DueBook`.
2. `DueBook`'s `write` mutation snapshots every item's current next-due date,
   then `POST /api/service`.
3. The route calls `requireWorkshop()` — the `caseId` comes from the session
   cookie, never the body — parses the body with Zod, and calls
   `recordServiceDb()`.
4. `recordServiceDb()` runs one transaction: insert the history row, push the
   odometer forward if the km beats the current reading, renew a `fixed_date`
   item's paper by 12 months. It then returns `loadCase(caseId)` — the whole
   re-assembled case.
5. The client replaces the query cache with that response (one read path, no
   invalidate-and-refetch) and diffs the new next-due dates against the
   snapshot, flashing _"Air filter now due 2027-02-28 (was 2026-08-26). The
   other 4 items on this vehicle did not move."_

Invariant 3 is therefore shown on screen every time, not asserted in a comment.

## Two questions, two models

| Question                            | Answered by                                       | Kind                         |
| ----------------------------------- | ------------------------------------------------- | ---------------------------- |
| When is this **item due**?          | `src/lib/engine.ts`                               | Deterministic rules          |
| When will the **customer turn up**? | `ml/visit_model.py`, joined in `src/lib/visit.ts` | Fitted model (random forest) |

They are deliberately separate processes and separate languages. The Python
never receives `DATABASE_URL`; `ml/cases.json` is the seam. Duplicating the due
rules in Python would give the workshop two answers that could disagree.

The model is an **optimisation, not a dependency**: if `ML_URL` is unset or the
tunnel is down, `/api/visit` answers from the lookup table committed at
`src/data/visit-predictions.json` and reports `source: "bundled"`. See
[ml-visit-predictor.md](ml-visit-predictor.md).

## Technology

| Layer        | Choice                                         | Note                                                                               |
| ------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| Framework    | Next.js 16, App Router                         | `src/proxy.ts` is the middleware entry point in this version                       |
| UI           | React 19, shadcn/ui over Base UI, Tailwind 4   | Dashboard styling is a scoped design system in `src/app/due-book.css` (`.duebook`) |
| Client state | TanStack Query                                 | One query (`["case", caseId]`), mutations replace it                               |
| Database     | PostgreSQL via Prisma 7 (`@prisma/adapter-pg`) | Client generated to `src/generated/prisma`                                         |
| Validation   | Zod 4                                          | At every trust boundary, both directions                                           |
| Auth         | jose (JWT) + argon2                            | HTTP-only cookie, 7-day expiry                                                     |
| ML           | scikit-learn, FastAPI, uvicorn                 | Run locally, exposed via ngrok                                                     |
| Tooling      | Biome, Husky + lint-staged, tsx                | `npm run lint`, `npm run format`                                                   |
