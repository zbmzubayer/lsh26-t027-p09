"use client";

import type { Analysis } from "@/lib/due-book-view";
import type { EngineOpts } from "@/lib/engine";
import { Chip, km, tkS } from "./format";

const pad = (s: string, n: number) => s.padEnd(n, " ");
const padS = (s: string, n: number) => s.padStart(n, " ");

export function Method({
  a,
  opts,
  onCopy,
}: {
  a: Analysis;
  opts: EngineOpts;
  onCopy: (text: string, label: string) => void;
}) {
  const top = a.callList[0];
  const topView = top
    ? a.vehicles.find((v) => v.vehicle.id === top.vehicle.id)
    : undefined;
  const rates = a.vehicles.map((v) => v.rate);

  const worked =
    top && topView
      ? [
          ...top.items
            .filter((i) => i.score > 0)
            .map(
              (i) =>
                `${pad(i.item.name, 20)} ${padS(tkS(i.cost), 7)} × ${i.urgency.toFixed(2)}${
                  i.risk !== 1 ? " × 1.5" : "      "
                } ≈ ${padS(tkS(i.score), 8)}`,
            ),
          `${pad("", 20)} ${padS("", 7)}   ${pad("", 4)}       ${"─".repeat(8)}`,
          `${pad("vehicle score", 20)} ${padS("", 7)}   ${pad("", 4)}       ${padS(tkS(top.score), 8)}`,
        ].join("\n")
      : "";

  const answers = JSON.stringify(
    {
      case_id: a.caseId,
      today: a.today,
      totals: a.totals,
      call_list: a.callList.map((r, i) => ({
        rank: i + 1,
        owner: r.owner.name,
        phone: r.owner.phone,
        vehicle_id: r.vehicle.id,
        plate: r.vehicle.plate,
        score: Math.round(r.score * 100) / 100,
        value_due: r.totalCost,
        items: r.items.map((s) => ({
          item: s.item.name,
          rule: s.item.rule,
          next_due: s.dueDate,
          status: s.status,
          days: Number.isFinite(s.daysLeft) ? s.daysLeft : null,
          cost_bdt: s.cost,
          why: s.reason,
        })),
      })),
      workload_8w: a.workload.buckets.map((b) => ({
        week: b.week,
        start: b.start,
        end: b.end,
        jobs: b.jobs,
        value: b.value,
      })),
    },
    null,
    1,
  );

  return (
    <div className="panel" style={{ maxWidth: 900 }}>
      <div className="panel-hd">
        <h2>How every number on this page is worked out</h2>
      </div>
      <div className="panel-bd">
        <div className="prose">
          <h3>The case date, never the clock</h3>
          <p>
            Everything is measured against <code>{a.today}</code>, the{" "}
            <code>today</code> field of the case record. Nothing on this page
            calls the browser clock, so the same case gives the same answers
            next month.
          </p>

          <h3>Three rules, one per kind of item</h3>
          <ul>
            <li>
              <b>Fixed date</b> — insurance, fitness, tax token, battery
              warranty. The next due date <i>is</i> the printed expiry. Nothing
              in the service history can move it; renewing one sets a new expiry
              twelve months on.
            </li>
            <li>
              <b>Time interval</b> — engine oil, air filter, coolant, AC
              service. Counted in calendar months from the date that item was
              last done, clamped to the end of the month, so{" "}
              <code>31 Jan + 1 month = 28 Feb</code>, never 3 March. With no
              record of it ever being done, it counts from the vehicle&apos;s
              first odometer reading.
            </li>
            <li>
              <b>Distance</b> — brake pads, tyres, spark plugs, timing belt. Due
              at <code>km at last service + interval</code>. The date comes from{" "}
              <i>this</i> vehicle&apos;s own running, not a shared guess.
            </li>
          </ul>

          <h3>Daily running is per vehicle</h3>
          <div className="formula">
            {`km/day  = (last reading − first reading) ÷ days between them
next due = today + round((due km − current km) ÷ km/day)`}
          </div>
          <p>
            Across this case the fleet ranges from{" "}
            <span className="num">{Math.min(...rates).toFixed(0)}</span> to{" "}
            <span className="num">{Math.max(...rates).toFixed(0)}</span> km/day,
            so a {km(40000)} km tyre interval lands years apart between two
            vehicles of the same model. A vehicle with only one reading on file
            falls back to the fleet median of 51 km/day, and the vehicle page
            says so in words. The <b>Last two</b> toggle in the strip at the top
            re-measures running from the most recent pair of readings instead.
          </p>

          <h3>Three states</h3>
          <p>
            <Chip status="overdue">Overdue</Chip> next due is before the case
            date &nbsp;
            <Chip status="due_soon">Due soon</Chip> within the next{" "}
            {opts.dueSoonDays} days &nbsp;
            <Chip status="fine">Fine</Chip> beyond that. Right now:{" "}
            <span className="num">{a.totals.overdue}</span> /{" "}
            <span className="num">{a.totals.due_soon}</span> /{" "}
            <span className="num">{a.totals.fine}</span> of{" "}
            <span className="num">{a.totals.items}</span> items.
          </p>

          <h3>The call-list rule</h3>
          <p>
            Listing everything that is not fine would put{" "}
            <span className="num">{a.totals.overdue + a.totals.due_soon}</span>{" "}
            items in front of the manager. The list ranks by the money at risk
            on each vehicle:
          </p>
          <div className="formula">
            {`urgency = 1 + min(days late, 180) ÷ 30      when overdue   → 1.00 … 7.00
        = 0.5 × (1 − days to go ÷ ${pad(String(opts.dueSoonDays), 2)})           when due soon  → 0.00 … 0.50
        = 0                                  when fine

safety weight = ${opts.riskWeights ? "1.5" : "1.0 (turned off)"} for brake pads, tyres, fitness certificate, insurance
              = 1.0 otherwise

item score    = cost × urgency × safety weight
vehicle score = sum of its item scores`}
          </div>
          <p>
            Multipliers are printed to two decimals throughout; the ranking
            itself carries full precision, which is why a printed line can land
            a few taka off the score beside it.
          </p>
          <p>
            Three properties make it defensible. The two urgency ranges do not
            overlap, so an overdue item always outranks a due-soon item of the
            same cost. Lateness saturates at 180 days, so a paper that expired
            three years ago cannot bury a brake job that went late last week.
            And the 1.5 bump is scoped to the items where being late is a safety
            or legal problem rather than a bigger bill later — turn it off in
            the strip at the top and watch the order change.
          </p>

          {top && (
            <>
              <h3>Worked example — the top of today&apos;s list</h3>
              <p>
                <b>{top.owner.name}</b>, {top.vehicle.model}{" "}
                <span className="plate">{top.vehicle.plate}</span>, running{" "}
                <span className="num">{topView?.rate.toFixed(2)}</span> km/day,
                now on{" "}
                <span className="num">{km(topView?.currentKm ?? 0)}</span> km.
              </p>
              <div className="formula">{worked}</div>
            </>
          )}

          <h3>Recording a service resets one item</h3>
          <p>
            A completed service appends a history row and nothing else; every
            next-due date is then recomputed from scratch. Because each rule
            reads only its own item&apos;s history, exactly one date can move —
            the vehicle page names the item that moved and counts the ones that
            did not, after every save.
          </p>

          <h3>Answers for this case, as JSON</h3>
          <p>The same numbers the screens above are drawing.</p>
          <button
            type="button"
            className="btn sm"
            onClick={() => onCopy(answers, "Copy answers JSON")}
          >
            Copy answers JSON
          </button>
          <textarea
            rows={9}
            readOnly
            value={answers}
            style={{ marginTop: 9 }}
          />
        </div>
      </div>
    </div>
  );
}
