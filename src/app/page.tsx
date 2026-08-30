import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import "./landing.css";

export const metadata: Metadata = {
  title: "Workshop Due Book — the cars that are due, in the order to ring them",
  description:
    "Every service on every car worked out from its own paperwork and its own odometer, ranked by the money at risk. Built for a car servicing workshop in Dhaka.",
  openGraph: {
    title: "Workshop Due Book",
    description:
      "The cars that are due, in the order to ring them. Insurance, oil, brake pads and tyres, worked out per vehicle from its own odometer.",
    type: "website",
  },
};

/** Numbers quoted on this page come from the published PUB-01 case and are the
 *  same ones src/lib/engine-check.ts asserts, so the copy cannot drift from the
 *  product without the check failing. */
const SAMPLE = {
  owners: 27,
  vehicles: 42,
  overdue: 45,
  backlog: "৳387,700",
  today: "30 August 2026",
  slowest: 18,
  fastest: 80,
};

const RULES = [
  {
    kind: "Fixed date",
    blurb: "Insurance, fitness, tax token, battery warranty.",
    item: "Insurance",
    says: "fixed date on the paper: 2026-09-04",
    tail: "The next due date is the printed expiry. Nothing in the service history can move it.",
  },
  {
    kind: "Time interval",
    blurb: "Engine oil, air filter, coolant, AC service.",
    item: "Engine oil · every 3 months",
    says: "last done 2026-01-17, every 3 months",
    tail: "Calendar months from the last service, clamped to the month end — 31 Jan plus one month is 28 Feb, never 3 March.",
  },
  {
    kind: "Distance",
    blurb: "Brake pads, tyres, spark plugs, timing belt.",
    item: "Tyres · every 40,000 km",
    says: "last done at 98,632 km, every 40,000 km → due at 138,632 km, now 139,157 — 525 km past, at 18.0 km/day",
    tail: "The date comes from this car's own running, not a shared guess.",
  },
];

export default async function Home() {
  const user = await getCurrentUser();

  return (
    <div className="duebook" style={{ background: "var(--ground)" }}>
      <header className="lp-bar">
        <div className="lp-bar-in">
          <div className="mark">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="29"
                height="29"
                rx="5"
                fill="var(--accent)"
              />
              <path
                d="M15 6.5a8.5 8.5 0 0 0-8.5 8.5"
                stroke="#fff"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                opacity=".55"
              />
              <path
                d="M23.5 15A8.5 8.5 0 0 0 15 6.5"
                stroke="#fff"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M15 15l5.2-3.4"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="15" cy="15" r="1.9" fill="#fff" />
              <path
                d="M8.5 21.5h13"
                stroke="#fff"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity=".45"
              />
            </svg>
            <div>
              <h1 style={{ fontSize: 17 }}>Workshop Due Book</h1>
              <div className="sub" style={{ fontSize: 11 }}>
                Service register &amp; daily call list · Dhaka
              </div>
            </div>
          </div>

          <a href="#how" className="btn sm" style={{ textDecoration: "none" }}>
            How it decides
          </a>
          <ThemeToggle />
          {user ? (
            <Link
              href="/dashboard"
              className="btn sm primary"
              style={{ textDecoration: "none" }}
            >
              Open your book
            </Link>
          ) : (
            <Link
              href="/login"
              className="btn sm primary"
              style={{ textDecoration: "none" }}
            >
              Workshop login
            </Link>
          )}
        </div>
      </header>

      <main className="lp">
        {/* 1 — hero */}
        <section className="lp-hero">
          <h1>The cars that are due, in the order to ring them.</h1>
          <p className="lede">
            Insurance, oil, brake pads, tyres — every service on every car,
            worked out from that car&apos;s own paperwork and its own odometer.
            The workshop opens the book at row one and starts dialling.
          </p>
          <div className="lp-cta">
            {user ? (
              <Link
                href="/dashboard"
                className="btn primary"
                style={{ textDecoration: "none" }}
              >
                Open your book
              </Link>
            ) : (
              <Link
                href="/login"
                className="btn primary"
                style={{ textDecoration: "none" }}
              >
                Open the demo workshop
              </Link>
            )}
            <a href="#how" className="btn" style={{ textDecoration: "none" }}>
              See how it decides
            </a>
          </div>
          <p className="lp-note">
            Demo data — {SAMPLE.vehicles} cars, {SAMPLE.owners} customers, and a
            fixed case date of {SAMPLE.today}. Nothing here reads the clock.
          </p>
        </section>

        {/* 2 — the problem, in numbers */}
        <section>
          <h2>What a workshop cannot see from a shelf of job cards</h2>
          <p className="sub">
            The paperwork exists. What is missing is the one question that
            matters on a Sunday morning: who do I ring first, and what do I say?
          </p>
          <div className="tiles" style={{ marginTop: 26 }}>
            <div className="tile crit">
              <div className="k">Already overdue</div>
              <div className="v">{SAMPLE.overdue}</div>
              <div className="n">service items past their date</div>
            </div>
            <div className="tile">
              <div className="k">Work sitting late</div>
              <div className="v">{SAMPLE.backlog}</div>
              <div className="n">billable, and nobody has called</div>
            </div>
            <div className="tile">
              <div className="k">Forecast</div>
              <div className="v">8 wks</div>
              <div className="n">of work, week by week</div>
            </div>
          </div>
          <p className="lp-caption">
            In the sample workshop, on the demo data.
          </p>
        </section>

        {/* 3 — three rules */}
        <section id="how">
          <h2>Three rules, one for each kind of item</h2>
          <p className="sub">
            A tyre is not due on a date and insurance is not due at a mileage.
            Each item is worked out by its own rule, and every screen prints the
            sentence it used — so any date on the page can be checked rather
            than trusted.
          </p>
          <div className="lp-rules">
            {RULES.map((r) => (
              <div className="lp-rule" key={r.kind}>
                <h3>{r.kind}</h3>
                <p style={{ fontSize: 13, color: "var(--ink-2)" }}>{r.blurb}</p>
                <div className="says">
                  <div className="item">{r.item}</div>
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: "var(--mono)",
                      fontSize: 11.5,
                    }}
                  >
                    “{r.says}”
                  </div>
                </div>
                <p
                  style={{
                    marginTop: 11,
                    fontSize: 12.5,
                    color: "var(--ink-3)",
                    lineHeight: 1.55,
                  }}
                >
                  {r.tail}
                </p>
              </div>
            ))}
          </div>
          <p className="sub" style={{ marginTop: 22 }}>
            The distance rule is the one that earns its keep. Across the sample
            workshop the fleet runs between{" "}
            <b>
              {SAMPLE.slowest} and {SAMPLE.fastest} km a day
            </b>
            , so the same 40,000 km tyre interval falls years apart on two
            identical models. A shared guess would be wrong for nearly every car
            on the list.
          </p>
        </section>

        {/* 4 — the call list */}
        <section>
          <h2>A call list that shows its working</h2>
          <p className="sub">
            Every vehicle with something overdue or due soon gets one row,
            ranked by the money at risk: cost, weighted by how late it is, with
            a 1.5× bump for the items where late means unsafe or illegal.
          </p>
          <div className="lp-split">
            <div>
              {/* two captures, swapped by CSS, so the shot matches the theme
                  the visitor is actually reading the page in */}
              <div className="lp-shot">
                <Image
                  className="shot-light"
                  src="/call-list.png"
                  alt="The daily call list: ranked rows showing owner, phone, vehicle, plate, what is overdue and the value due."
                  width={1280}
                  height={633}
                  priority
                />
                <Image
                  className="shot-dark"
                  src="/call-list-dark.png"
                  alt=""
                  aria-hidden="true"
                  width={1280}
                  height={633}
                />
              </div>
              <p className="lp-caption">
                The daily call list. Tap any row and it opens the arithmetic
                behind its position.
              </p>
            </div>
            <div>
              <div className="formula" style={{ marginTop: 0 }}>
                {`Tyres        32,000 × 1.97 × 1.5 ≈  94,400
Engine oil    3,500 × 5.50       ≈  19,250
Air filter    1,200 × 3.37       ≈   4,040
                                  ────────
vehicle score                      117,690`}
              </div>
              <p
                style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}
              >
                That is why this car is first — not a hidden score. Overdue and
                due-soon items sit in ranges that never overlap, so an overdue
                item always outranks a due-soon one of the same cost. Lateness
                stops counting after 180 days, so a paper that expired three
                years ago cannot bury a brake job that went late last week.
              </p>
              <p
                style={{
                  fontSize: 13,
                  color: "var(--ink-2)",
                  lineHeight: 1.6,
                  marginTop: 10,
                }}
              >
                Mark a service done and exactly one item resets. The page names
                the date that moved and counts the ones that did not.
              </p>
            </div>
          </div>
        </section>

        {/* 5 — the visit model */}
        <section>
          <h2>And whether they will actually turn up</h2>
          <p className="sub">
            Knowing a car is due is not the same as knowing the owner will come
            in. A model trained on <b>1,549 visit gaps across 25 workshops</b>{" "}
            predicts when each owner next appears, and flags the ones who will
            not arrive before something is already due — the calls that change
            an outcome, rather than reaching people who were coming anyway.
          </p>
          <div className="tiles" style={{ marginTop: 24 }}>
            <div className="tile">
              <div className="k">Mean error</div>
              <div className="v">41.5 d</div>
              <div className="n">on a workshop it has never seen</div>
            </div>
            <div className="tile">
              <div className="k">Baseline</div>
              <div className="v">62.5 d</div>
              <div className="n">guessing the fleet median gap</div>
            </div>
            <div className="tile">
              <div className="k">Validation</div>
              <div className="v">25</div>
              <div className="n">workshops, each held out in turn</div>
            </div>
          </div>
          <p className="lp-caption">
            Twelve refits on shuffled labels scored 64.3 days at best — none
            beat the model, so the signal is not noise.
          </p>
        </section>

        {/* 6 — what it does not do */}
        <section>
          <h2>What it does not do</h2>
          <p className="sub">The parts worth knowing before you rely on it.</p>
          <ul className="lp-nots">
            <li>
              <b>It does not read the clock.</b> Every date is measured against
              the case&apos;s own date, so the same data gives the same answers
              next month, and a judge can reproduce any number on the screen.
            </li>
            <li>
              <b>It does not message anyone.</b> Reminders open WhatsApp with
              the text already typed. A person reads it and presses send.
            </li>
            <li>
              <b>The visit prediction is a window, not an appointment.</b>{" "}
              Roughly ±65 days at 80% confidence. Good for ordering the call
              list; not for booking a slot.
            </li>
            <li>
              <b>The model is optional.</b> If it is unreachable the rule engine
              carries on alone and the screen says which one answered, rather
              than quietly showing a worse number.
            </li>
          </ul>
        </section>

        {/* 7 — close */}
        <section style={{ borderBottom: 0 }}>
          <h2>Open the book</h2>
          <p className="sub">
            {SAMPLE.vehicles} cars and {SAMPLE.owners} customers are already
            loaded. Sign in and the call list is the first thing you see.
          </p>
          <div className="lp-cta">
            {user ? (
              <Link
                href="/dashboard"
                className="btn primary"
                style={{ textDecoration: "none" }}
              >
                Open your book
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="btn primary"
                  style={{ textDecoration: "none" }}
                >
                  Workshop login
                </Link>
                <Link
                  href="/register"
                  className="btn"
                  style={{ textDecoration: "none" }}
                >
                  Register a workshop
                </Link>
              </>
            )}
          </div>
        </section>

        <footer className="lp-foot">
          <span>Team LSH26-T027</span>
          <span>Problem P09 — Vehicle Service Due Predictor</span>
          <span>Dhaka, Bangladesh</span>
        </footer>
      </main>
    </div>
  );
}
