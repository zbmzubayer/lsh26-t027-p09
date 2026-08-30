# User interface

## Pages

| Route                 | File                                | Notes                                                                                                                                                               |
| --------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                   | `src/app/page.tsx`                  | Landing page. Every number quoted on it comes from PUB-01 and is asserted by `engine-check.ts`, so the copy cannot drift from the product without the check failing |
| `/login`, `/register` | `src/app/{login,register}/page.tsx` | react-hook-form + Zod resolver over the auth Server Actions                                                                                                         |
| `/dashboard`          | `src/app/dashboard/page.tsx`        | Server Component: resolves the user, redirects if absent, renders "No workshop assigned" if the account has no `caseId`, otherwise mounts `<DueBook>`               |

`src/app/layout.tsx` loads four fonts (Geist, Geist Mono, Archivo with the width
axis, IBM Plex Mono), the theme provider (next-themes, `suppressHydrationWarning`
because the inline theme script runs before hydration) and the TanStack Query
provider.

## Styling

Two systems, deliberately:

- **Tailwind 4 + shadcn/ui** (`src/components/ui/`, over Base UI) for the auth
  pages and primitives — dialogs, sheets, inputs. Standard shadcn conventions.
- **The Workshop Due Book design system** in `src/app/due-book.css`, scoped to
  `.duebook`. It is loaded in the root layout but inert until a page opts in, so
  the landing, login and register pages can look like the product instead of
  three different applications.

`DetailDrawer` bridges the two: it wraps the Base UI sheet (focus trap, Escape,
scroll lock, backdrop — none worth hand-rolling) but repaints it from the
`.duebook` tokens, and carries the `duebook` class itself because the sheet
portals to `<body>` and would otherwise sit outside the element the tokens are
defined on.

Verified responsive at 1360 / 820 / 420 px, in both themes.

## The view model — `src/lib/due-book-view.ts`

```ts
analyse(data: CaseData, opts: EngineOpts, sort: CallSort): Analysis
```

One function, called once per render, deriving everything the screens need
**from the engine's own output**. It only counts, groups and totals what
`vehicleStatuses()` and `buildCallList()` already returned — so no screen can
quietly rank on a number the fixtures never saw.

It returns:

| Field      | Contents                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `vehicles` | Per vehicle: statuses, counts by status, worst status, current km and its date, km/day and the span it was measured over, value due, score |
| `callList` | The engine's ranked rows, unmodified                                                                                                       |
| `totals`   | Items, owners, vehicles, overdue/due-soon/fine counts, overdue and total value, owners to call                                             |
| `workload` | Eight buckets that **keep their jobs**, so a week can be opened and read, plus the backlog, totals and the peak                            |

`rateSpan` is `null` when a vehicle has a single reading and is therefore on the
fleet median — the vehicle page uses that to show the arithmetic honestly
instead of inventing a span.

## `DueBook` — the container

`src/components/due-book/due-book.tsx` (515 lines) owns all state. Everything
below it is presentational.

**State:** current view, selected vehicle, `EngineOpts`, call-list sort, flash
message, copy confirmation, intake open/error.

**Data:** one query, `["case", caseId]` → `GET /api/case`.

**Mutations:** all four return the freshly re-assembled case, and the cache is
**replaced** (`qc.setQueryData`) rather than invalidated — one read path, no
refetch round trip.

The `write` mutation is worth reading in full: before posting, it snapshots
every item's current next-due date; on success it diffs and flashes

> _Air filter now due 2027-02-28 (was 2026-08-26). The other 4 items on this
> vehicle did not move._

That is the one-item-reset guarantee, checked on screen rather than eyeballed.
When nothing moves it says so too, including why ("this vehicle has no
distance-based item close enough to shift").

## Tabs

| Tab           | Component                           | What it does                                                                                                                                                                                 |
| ------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Call list** | `call-list.tsx` → `call-detail.tsx` | The ranked daily list: owner, phone, vehicle, items due, reason, and the score arithmetic. Filter by text, "overdue only" toggle, three sort modes. A row opens the detail drawer            |
| **Vehicles**  | `vehicles.tsx`                      | Every vehicle as a card, worst first, with an odometer sparkline                                                                                                                             |
| **Search**    | `search.tsx`                        | Look a customer up by name, phone, plate, model or vehicle id; everything they own in one place, with a per-owner "when will they be back" call                                              |
| **Workload**  | `workload.tsx`                      | The 8-week preview. Backlog tile is separate from the weekly bars; click a week to read its jobs                                                                                             |
| **Reminders** | `workload.tsx` (`Reminders`)        | One copy-ready message per owner in call-list order, with a copy button and a `wa.me` deep link                                                                                              |
| **Method**    | `method.tsx`                        | How every number is derived, the ranking formula, a worked example of the top-ranked vehicle, and the answers JSON. Opens in the detail drawer rather than as a tab                          |
| **Account**   | `components/account/account.tsx`    | Who you are, change your password, and — for a manager — the workshop's accounts and a form to add one. The only view that needs no case data, so it renders while the book is still loading |
| **Vehicle**   | `vehicle-detail.tsx`                | Not a tab — reached by clicking a row                                                                                                                                                        |

## The vehicle page

`vehicle-detail.tsx` is presentational: it takes `onRecord`, `onOdometer`,
`onAddItem` and `onCheckVisit` as callbacks and holds no mutation of its own.

It shows a job-card header (odometer, km/day **with its basis written out in
words**, total value due), the full item table (`item-table.tsx` — rule, next
due, days, cost, status, and "why that date"), the odometer sparkline, the
service history, and four controls: record a service, enter a new odometer
reading, fit a service from the catalogue, and check the next visit.

## Controls that make the method auditable

Engine options are exposed live, so a judge can interrogate the ranking rather
than take it on trust:

- **Due-soon window** — 14 / 30 / 45 days
- **km/day basis** — all readings, or the last two
- **Safety weighting** — on or off

A fourth knob, `returnWeighting`, exists in `EngineOpts` and defaults **off**.
When on, each row is weighted by how unlikely the owner is to arrive unprompted,
and the row renders a "won't come" chip from `returnFactor`. The chip and the
detail tile are wired; the toggle that turns the knob on is not, so the chip
does not appear under `DEFAULT_OPTS`.

Changing any of them re-runs `analyse()` client-side. Nothing is refetched,
because the engine is pure.

## Intake

`intake-form.tsx` — a walk-in is one event, so it is one form: who they are
(existing customer or new name + 11-digit phone), what they drive (model with a
datalist, plate, current odometer), and what it is due for.

Services are **ticked from the catalogue, never typed** — the engine weights
safety items by name, and a typo would silently rank the car too low. Price is
editable; the rule and interval are not. `fixed_date` items ask for the expiry
printed on the paper.

On success the app jumps straight to the new vehicle and flashes what was
created and what is due first.
