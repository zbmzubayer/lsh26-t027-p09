# Operations

## Environment

`src/config/env-private.ts` parses `process.env` with Zod **at boot**, so a
missing or short secret fails immediately with a readable message rather than
at the first request.

| Variable       | Required | Notes                                                                                                                                                          |
| -------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | yes      | PostgreSQL connection string                                                                                                                                   |
| `AUTH_SECRET`  | yes      | Signs the session JWT. **≥32 characters** — `openssl rand -base64 32`                                                                                          |
| `ML_URL`       | no       | https URL of the visit-prediction service. Unset (or unreachable) and `/api/visit` answers from the bundled model, which is what a deployed instance should do |

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored.

## Scripts

| Command                           | Does                                                |
| --------------------------------- | --------------------------------------------------- |
| `npm run dev`                     | Development server on :3000                         |
| `npm run build` / `npm run start` | Production build / serve                            |
| `npm run lint` / `npm run format` | Biome check / write                                 |
| `npm run db:generate`             | Prisma client → `src/generated/prisma`              |
| `npm run db:push`                 | Push the schema to the database                     |
| `npm run db:studio`               | Prisma Studio                                       |
| `npm run cases -- <file>`         | Answers for case files, offline                     |
| `npm run ml:export`               | Database → `ml/cases.json`                          |
| `npm run ml`                      | Retrain, rewrite `src/data/visit-predictions.json`  |
| `npm run ml:serve`                | FastAPI prediction service on 127.0.0.1:8010        |
| `npm run check:visit`             | Assert the bundled model and the live service agree |
| `npx tsx src/lib/engine-check.ts` | The domain self-check (no npm script)               |

## First run

```bash
cp .env.example .env      # fill in DATABASE_URL and AUTH_SECRET
npm install
npm run db:generate
npm run db:push
npm run dev
```

Then register at `/register`. A new account has **no workshop** and will say so
— see the next section.

## Runbooks

### Make the first manager of a workshop

A manager can add colleagues from the Account tab, but the **first** account of
a workshop has to be made by hand — there is no bootstrap flow.

```sql
UPDATE "User"
SET "caseId" = 'PUB-02', role = 'manager'
WHERE email = 'someone@example.com';
```

Everyone after that is added from the dashboard: **Account → Add someone to this
workshop**. New accounts are always `staff`; there is no way to mint a second
manager from the UI yet.

**Do not assign `PUB-01`.** It is the pinned fixture that `engine-check.ts`
asserts against; recording a service against it through the UI would invalidate
the check.

### Bring the model service up

```bash
npm run ml:export && npm run ml     # only if the database has changed
npm run ml:serve                    # :8010, refits on boot (~3s)
ngrok http 8010
```

Put the https URL in `.env` as `ML_URL` and **restart `next dev`** — env is read
at boot. Verify:

```bash
curl -s $ML_URL/health -H 'ngrok-skip-browser-warning: true'
```

If you skip the restart, the app silently uses the bundled table. That is
visible in the UI as "offline model" and in the response as
`source: "bundled"`.

### Answer a case that is not in the database

```bash
curl -X POST http://localhost:3000/api/run \
  -H 'content-type: application/json' -d @some-case.json
# or, with no server at all:
npm run cases -- some-case.json --out answers.json
```

### Schema change

```bash
# edit prisma/schema.prisma
npm run db:generate && npm run db:push
npx tsx src/lib/engine-check.ts    # block 3 re-asserts PUB-01 from the database
```

## Deployment

Live at **<https://lsh26-t027-p09.vercel.app/>** (Vercel).

Verified against that deployment: `POST /api/run` with `src/data/case-pub-01.json`
returns the pinned answers — 42 vehicles, 41 call-list rows, V28 top at 117,690,
backlog 45 jobs / ৳387,700 — identical to what `engine-check.ts` asserts
offline. `/dashboard` redirects to `/login` without a session.

The app deploys as a normal Next.js application. Two things to get right:

1. **Leave `ML_URL` unset in production.** The prediction service runs on a
   developer machine behind a free-tier ngrok tunnel; a deployed instance should
   answer from the committed lookup table.
2. **`AUTH_SECRET` must differ from the development one,** and the session
   cookie is only marked `secure` when `NODE_ENV === "production"`.

Python is not needed at runtime. Nothing in `src/` imports it.

## Known limitations

Carried from `evaluation-manifest.json`, and honest:

- **The database cannot be rebuilt from a clone.** The 25-case public drop is
  not committed and there is no seed script, so a fresh environment can run
  `/api/run` and the offline self-check, but not the signed-in app, without
  re-seeding by hand.
- **PUB-01 is pinned.** Writing to it through the UI invalidates
  `engine-check.ts`.
- **No edit or delete** for customers, vehicles or service items. A manager can
  add a colleague but not remove one, change their role, or reset their password
  — that still needs a database statement, and doing it properly needs a
  last-manager guard.
- **No bootstrap for a brand-new workshop.** The first manager is assigned by
  hand; public registration is still open and grants nothing.
- **Verification is manual self-checks,** not a framework suite in CI.
- **The ngrok URL changes on every restart,** and a stale one degrades silently
  (visibly, in the UI) to the bundled model.
- **`evaluation-manifest.json` is partly stale**: it still quotes the visit
  model as trained on 56 gaps with 46.2 d MAE. The current model is 1,549 gaps
  across 25 cases at 41.5 d, and it claims `ml/` is uncommitted, which it no
  longer is. `live_url` is still `TODO`, which blocks every scored item.
