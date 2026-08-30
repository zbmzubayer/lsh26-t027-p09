# Vehicle Service Due Predictor

A Next.js application for a car servicing workshop in Dhaka to predict which vehicle service items are due, overdue, or fine — and produce a daily call list for the workshop.

## Background

The workshop looks after a few hundred customer vehicles. Every vehicle has parts with their own service life:

- **Fixed date items** — insurance, fitness, battery warranty.
- **Time based items** — engine oil, air filter, spark plugs.
- **Distance based items** — brake pads, tyres, clutch plate.

Currently this information lives in a register book and the manager's head. The workshop finds out something was due only when the customer arrives with a problem. This tool works out what is due on every vehicle and tells the workshop who to call today.

## Required features

1. **Seed data** — at least 40 vehicles belonging to at least 25 owners. Each vehicle has a set of service items with their own due rule, current odometer readings, and past service records.
2. **Due prediction** — calculate a next due date for every item using its own rule. Distance based items estimate the date from the vehicle's daily running distance. Items are marked as overdue, due soon, or fine.
3. **Daily call list** — which owner to call, which vehicle, which items are due and why. Sorted so the most overdue and highest value work comes first.
4. **Owner vehicle page** — shows every item, its next due date and its cost. The workshop can record a completed service so that item resets and the service history grows.

## Bonus features

- 8-week workload preview for the workshop.
- Enter a new odometer reading and update every distance based estimate.
- Copy-ready reminder message per owner naming the due items and cost.

## Constraints

- Distance based items must use the vehicle's daily running distance; a fixed interval for everything will not score.
- Recording a completed service must reset that one item only.
- The call list must be sorted by an explainable rule, not just a list of everything not fine.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router)
- [React](https://react.dev) 19
- [TypeScript](https://www.typescriptlang.org)
- [Prisma](https://prisma.io) with PostgreSQL
- [Tailwind CSS](https://tailwindcss.com)
- [shadcn/ui](https://ui.shadcn.com) components
- [jose](https://github.com/panva/jose) for JWT sessions
- [argon2](https://github.com/ranisalt/node-argon2) for password hashing

## Getting started

1. Copy the environment variables and fill in your values:

   ```bash
   cp .env.example .env
   ```

   Required variables:
   - `DATABASE_URL` — PostgreSQL connection string
   - `AUTH_SECRET` — at least 32 characters

   Optional:
   - `ML_URL` — the visit-prediction service (see below). Leave it unset and the
     app answers from the model bundled in `src/data`, which is what a deployed
     instance should do.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Generate the Prisma client and push the schema:

   ```bash
   npm run db:generate
   npm run db:push
   ```

4. Run the development server:

   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000).

## Available scripts

- `npm run dev` — start the development server
- `npm run build` — create a production build
- `npm run start` — start the production server
- `npm run lint` — run Biome linter
- `npm run format` — format code with Biome
- `npm run db:generate` — generate Prisma client
- `npm run db:push` — push schema changes to the database
- `npm run db:studio` — open Prisma Studio
- `npm run cases -- <case.json> [--out answers.json]` — answers for one or more
  case files without a browser or a database; byte-identical to `POST /api/run`
- `npm run ml:export` — export every case in the database to `ml/cases.json`
- `npm run ml` — retrain the visit predictor and rewrite `src/data/visit-predictions.json`
- `npm run ml:serve` — run the prediction service on `127.0.0.1:8010`
- `npm run check:visit` — assert the bundled model and the live service agree

## Answering a case without the app

`POST /api/run` takes a whole case as JSON and returns statuses, the ranked call
list and the 8-week workload. It is stateless — no session, no database — so a
case that is not in the workshop's book can still be scored:

```bash
curl -X POST http://localhost:3000/api/run \
  -H 'content-type: application/json' -d @src/data/case-pub-01.json
```

`npm run cases` does the same offline, and accepts a single case object, a bare
array of cases, or a file wrapping either under `case` / `cases`.

## Predicting the next visit

The rule engine says when an item is **due**. A separate model says when the
customer will actually **come**, which is the only quantity in the data that
genuinely varies — every cost, interval and km/day in it is a constant.

A random forest trained on the 1,549 observed inter-visit gaps across all 25
workshops predicts the gap from a vehicle's last visit. Validated
leave-one-case-out — fitted on 24 workshops, scored on the one held out:

|                                                 | MAE                      |
| ----------------------------------------------- | ------------------------ |
| baseline (median gap of the training workshops) | 62.5 days                |
| model                                           | **41.5 days**            |
| same model on shuffled labels, 12 refits        | 64.3 days — none beat it |

The workshop app cannot host Python, so `ml/serve.py` runs locally behind an
ngrok tunnel and `ML_URL` points at it. That tunnel is an optimisation, not a
dependency: if it is unset or unreachable, `/api/visit` answers from the lookup
table committed in `src/data/visit-predictions.json` and says so in `source`.
The button always returns a date.

See `ml/HANDOFF.md` for the endpoint contract and the UI wiring.
