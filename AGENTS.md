<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Vehicle Service Due Predictor

This is a Next.js application for a car servicing workshop. When working on this project, keep the following domain rules and architecture in mind.

## Domain rules

- A **Vehicle** belongs to an **Owner**.
- Each vehicle has a set of **ServiceItems**. Every item has a due rule:
  - **Fixed date** — due on a calendar date (e.g. insurance, fitness, battery warranty).
  - **Time based** — due after a period of time from the last service (e.g. engine oil).
  - **Distance based** — due after a number of kilometers from the last service (e.g. brake pads, tyres).
- Distance based estimates must use the vehicle's **daily running distance**, not a fixed calendar interval.
- Recording a completed service must reset **only that item** and append to the service history.

## Required functionality

1. Seed at least 40 vehicles across at least 25 owners with realistic service items, odometer readings, and past service records.
2. Compute next due dates for every item:
   - Fixed date items use their fixed date.
   - Time based items use last service date + interval.
   - Distance based items use last service odometer + interval, projected forward with daily running distance.
3. Classify each item as:
   - `overdue` — due date is today or earlier.
   - `due soon` — due within a short window (e.g. 14 days or 500 km equivalent).
   - `fine` — everything else.
4. Produce a daily **call list** sorted by priority:
   - Most overdue first.
   - Higher total item cost first as a tie-breaker.
   - Include owner, vehicle, items due, and reason.
5. Provide an owner vehicle page where the workshop can:
   - View all items, next due dates, and costs.
   - Record a completed service to reset one item and add a history entry.

## Bonus features (only after required features work)

- 8-week workload preview grouped by week.
- Enter a new odometer reading and recalculate all distance based estimates.
- Copy-ready reminder message per owner listing due items and total cost.

## Architecture notes

- Use Server Actions for mutations (create services, update odometer, etc.).
- Use Prisma for all database access; keep queries in `src/lib/` or colocated Server Actions.
- Keep calculation logic pure and testable (e.g. in `src/lib/due-dates.ts`).
- The auth system uses jose + argon2 with an HTTP-only session cookie. Protect workshop-only routes with `src/proxy.ts`.
- Match the existing shadcn/ui component conventions and Tailwind style already in the repo.

## Environment

- `DATABASE_URL` — PostgreSQL connection string.
- `AUTH_SECRET` — used to sign JWT sessions; must be at least 32 characters.

## Useful commands

- `npm run dev` — start the dev server.
- `npm run build` — verify the build passes before committing.
- `npm run lint` / `npm run format` — run Biome.
- `npm run db:generate` / `npm run db:push` — keep the Prisma client and schema in sync.
