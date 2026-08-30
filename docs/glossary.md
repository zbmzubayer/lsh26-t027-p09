# Glossary

**Case** — one workshop's whole book: its owners, vehicles, and its own `today`.
25 of them exist (`PUB-01` … `PUB-25`). A signed-in account works out of exactly
one. Ids inside a case (`V01`, `O01`) are unique **only within it**.

**`today`** — a field on the case, never the system clock. Every due date,
status and ranking is computed against it, which is what makes results
reproducible.

**Owner** — the customer. Not a `User`; a `User` is workshop staff who signs in.

**Service item** — one thing that comes due on one vehicle, with one of three
rules. Names are unique per vehicle and come from a closed catalogue of twelve.

**Rule** — how an item's next due date is worked out:

- `fixed_date` — the expiry printed on the paper (insurance, fitness, tax token,
  battery warranty)
- `period_months` — last service + N calendar months (engine oil, air filter)
- `distance_km` — last service km + N km, dated using the vehicle's own km/day
  (brake pads, tyres, timing belt)

**km/day** — the vehicle's daily running distance, from its own odometer span.
The number the whole distance-based estimate rests on; 18–80 km/day on PUB-01.

**Status** — `overdue` (due date today or earlier), `due_soon` (within the
window, 30 days by default), `fine`.

**Urgency** — a multiplier derived from status and days late: 1.00–7.00 when
overdue (saturating at 180 days), 0.00–0.50 when due soon, 0 when fine. The
bands never overlap.

**Safety weight** — 1.5× for brake pads, tyres, fitness certificate and
insurance, where overdue means a car that should not be on the road.

**Score** — `cost × urgency × safety` per item; summed over a vehicle's non-fine
items to rank the call list. Printed as arithmetic on every row.

**Call list** — the daily ranked list of who to ring: owner, phone, vehicle,
items due, and why.

**Backlog** — items already overdue. Counted separately from the eight weekly
buckets, so a week is not misread.

**Visit** — a distinct service **date**. Several items done on one day is one
visit, not several.

**Gap** — days between two consecutive visits. 1,549 observed across the 25
cases; the training label for the visit model.

**Drift** — `predictedVisit − earliestDue`. Positive means the customer will
turn up **after** something is already due, so a phone call changes something.
`driftList()` is the list ranked by it.

**Censored / right-censored** — a vehicle's current absence has not ended yet,
so its true gap is unknown; we only know it is _at least_ this long. The gap
model must discard these; the hazard model uses them.

**Hazard** — P(returns within the next bucket | still away). Rises with absence,
from 0.110 in the first 30 days to 0.548 at 240–270 days.

**Bundled vs live** — `bundled` means `/api/visit` answered from the lookup
table committed in `src/data/visit-predictions.json`; `live` means the FastAPI
service behind `ML_URL` answered. Reported in every response.
