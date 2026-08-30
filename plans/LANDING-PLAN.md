# Plan — the landing page

`/` is currently a centred hero with two buttons, drawn with shadcn defaults and
the Geist font. The product behind it is a paper-ledger design in Archivo and
IBM Plex Mono on a teal-and-bone palette. They look like two different
applications, which is the actual reason the front door feels unprofessional —
not the amount of copy on it.

So the whole job is: make the front door look like the room behind it, and give
it something to say.

---

## Who it is for

Two audiences arrive at the same URL:

- **A judge**, who wants to know what problem this solves, how it decides, and
  whether the numbers hold up — in about ninety seconds.
- **A workshop owner**, the fictional customer, who wants to know why they would
  bother.

One page serves both if it is written as a product page and lets the evidence do
the persuading. No "innovative AI-powered solution" copy: the credibility here
comes from printing the arithmetic, which is the same thing the app itself does.

---

## Structure

Eight blocks, top to bottom. Roughly one screen each on a laptop.

**1 — Bar.** The Workshop Due Book mark, an anchor to _How it works_, theme
toggle, and the primary action. Signed out: _Workshop login_. Signed in: _Open
your book_ straight to `/dashboard` — the page already reads the session.

**2 — Hero.** One claim, one sentence under it, two buttons.

> ### The cars that are due, in the order to ring them.
>
> Insurance, oil, brake pads, tyres — every service on every car, worked out
> from that car's own paperwork and its own odometer. The workshop opens the
> book and starts at row one.

Buttons: _Open the demo workshop_ → `/login`, and _See how it decides_ → the
Method section. Under them, one honest line: _demo data — 42 cars, 27 customers,
a fixed case date of 30 August 2026._

**3 — The problem, in numbers.** Three tiles reusing the dashboard's own `.tile`
component, taken from the sample workshop rather than invented:

| 45                    | ৳387,700             | 8                 |
| --------------------- | -------------------- | ----------------- |
| items already overdue | of work sitting late | weeks of forecast |

Labelled _in the sample workshop_ so nothing reads as a real customer result.

**4 — Three rules, one per kind of item.** The heart of it. Three cards, each
showing a real item and the sentence the engine actually prints:

- **Fixed date** — Insurance · _"fixed date on the paper: 2026-09-04"_
- **Time interval** — Engine oil · _"last done 2026-01-17, every 3 months"_
- **Distance** — Tyres · _"last done at 98,632 km, every 40,000 km → due at
  138,632 km, now 139,157 — 525 km past, at 18.0 km/day"_

The third one is the whole pitch: the date comes from **that vehicle's own
running**, not a shared guess. Worth saying that the fleet ranges from ~4 to
~90 km/day, so a 40,000 km tyre interval lands years apart on two identical
models.

**5 — The call list, with a screenshot.** A real capture of the dashboard, and
beside it the arithmetic for row one:

```
Tyres        32,000 × 1.97 × 1.5 ≈  94,400
Engine oil    3,500 × 5.50       ≈  19,250
Air filter    1,200 × 3.37       ≈   4,040
                                   ───────
vehicle score                       117,690
```

Caption: _every row prints its own reasoning; nothing is ranked by a number you
cannot check._

**6 — And when they will actually turn up.** The visit model, with its real
measured numbers, stated plainly:

> Knowing a car is due is not the same as knowing the owner will come in. A
> model trained on 1,549 visit gaps across 25 workshops predicts when each owner
> next appears — and flags the ones who will not arrive before something is
> already due. **41.5 days** mean error against **62.5** for guessing the fleet
> median, validated by holding out an entire workshop.

**7 — What it does not do.** A short, plain list. This is the block that earns
trust, and almost no submission includes one:

- It does not read the clock. Every date is measured against the case's own
  date, so the same data gives the same answers next month.
- It does not message anyone. Reminders open WhatsApp with the text ready; a
  person presses send.
- The visit prediction has an 80% window of roughly ±65 days. Useful for
  ordering the call list, not for booking a slot.
- If the model is unreachable the rule engine carries on alone, and the screen
  says which one answered.

**8 — Close.** Repeat the primary action, one line of footer: team, problem id,
repository.

---

## Design

**Reuse the product's design system — do not invent a second one.** The tokens,
`.panel`, `.tile`, `.chip`, `.btn` and the type scale all exist in
`src/app/dashboard/due-book.css`, scoped to `.duebook`.

- Move that import from `src/app/dashboard/layout.tsx` up to a shared place (or
  import it in both), and wrap the landing page in `<div className="duebook">`.
- Load Archivo and IBM Plex Mono the same way the dashboard does. Cleanest is to
  lift the two `next/font` declarations into the root layout so `/`, `/login`
  and `/register` all get them — which fixes those two pages looking like a
  different product too.
- Landing-only pieces (hero scale, the two-column feature rows) go in a small
  `landing.css` beside it, using the same tokens. No Tailwind utilities mixed in
  — the dashboard does not use them and the mixture is what looks amateur.
- Dark mode comes free: the tokens already flip on `.dark`.

**Screenshot.** One capture of the call list at 1280px, light and dark, into
`public/`. Committed as PNGs, referenced with `next/image` at a fixed size so
there is no layout shift. This is the single biggest professionalism win on the
page and costs almost nothing.

---

## Technical shape

- Stays a **server component**. It already calls `getCurrentUser()`; that is the
  only dynamic thing on the page, and it is what swaps the button between _Log
  in_ and _Open your book_.
- No client JavaScript beyond the existing theme toggle. No animation library,
  no scroll effects, no carousel.
- Section anchors (`#how-it-works`) with `scroll-behavior: smooth` in CSS, not JS.
- `metadata` in `src/app/page.tsx`: title, description, and an `openGraph` block
  so the link preview is not blank when it is pasted into the submission form or
  a chat.
- Responsive: the feature rows stack under 720px, the screenshot scales, the
  tiles reflow. The dashboard CSS already has the breakpoints.

---

## Verification

1. `npx next build` clean; `/` still statically analysable.
2. Load `/` signed out → _Workshop login_; signed in → _Open your book_.
3. Toggle dark mode; check every section, since the landing is the first place
   the tokens get used outside `.duebook`'s usual container.
4. Check at 375px, 768px and 1280px — no horizontal scroll.
5. Confirm the numbers quoted match `engine-check` output rather than being
   typed from memory.

---

## Out of scope

Pricing, testimonials, a contact form, a blog, analytics, a cookie banner. None
of them are true, and inventing them is worse than not having them.

## Open question

**How hard should it lean product versus project?** The plan above is written as
a product page that a judge can read as evidence. The alternative is an explicit
submission page — problem statement, requirements checklist, architecture
diagram, links to the repo and the manifest. Say if you would rather have that;
it is a different page, not a variation of this one.
