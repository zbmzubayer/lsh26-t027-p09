"use client";

import { useMemo, useState } from "react";
import type { Analysis } from "@/lib/due-book-view";
import type { CaseData, EngineOpts } from "@/lib/engine";
import { simulateWorkload } from "@/lib/workload-sim";
import { Plate, tk, tkS, WhatsAppButton } from "./format";

export function Workload({
  a,
  data,
  opts,
}: {
  a: Analysis;
  data: CaseData;
  opts: EngineOpts;
}) {
  const [week, setWeek] = useState<number | null>(null);
  const w = a.workload;
  const max = Math.max(w.peak, 1);
  // 200 draws over ~1,000 vehicles: cheap, but not on every render
  const sim = useMemo(() => simulateWorkload(data, opts), [data, opts]);
  const busiest =
    w.buckets.reduce(
      (best, b) => (b.value > best.value ? b : best),
      w.buckets[0],
    )?.week ?? 1;
  const sel = week ? w.buckets[week - 1] : null;

  return (
    <>
      <div className="tiles">
        <div className="tile crit">
          <div className="k">Backlog already late</div>
          <div className="v">{w.backlog.jobs}</div>
          <div className="n">
            jobs · {tk(w.backlog.value)}, on top of the weeks below
          </div>
        </div>
        <div className="tile">
          <div className="k">Jobs falling due</div>
          <div className="v">{w.totalJobs}</div>
          <div className="n">in the next 8 weeks</div>
        </div>
        <div className="tile">
          <div className="k">Expected to arrive</div>
          <div className="v">{sim.totals.expJobs.toFixed(0)}</div>
          <div className="n">
            of {w.totalJobs} due — the rest will not turn up unprompted
          </div>
        </div>
        <div className="tile">
          <div className="k">Value coming</div>
          <div className="v">{tkS(w.totalValue)}</div>
          <div className="n">taka, if every item is done on time</div>
        </div>
        <div className="tile">
          <div className="k">Busiest week</div>
          <div className="v">wk {busiest}</div>
          <div className="n">{tk(w.peak)} of work</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <h2>Work falling due, next 8 weeks</h2>
          <span className="note">
            bar height is taka of work · number above each week is the value,
            below it the job count · click a week
          </span>
        </div>
        <div className="panel-bd">
          <div className="chartwrap">
            <div className="chart">
              {w.buckets.map((b) => (
                <button
                  type="button"
                  key={b.week}
                  className="bar"
                  aria-pressed={week === b.week}
                  title={`Week ${b.week}, ${b.start} to ${b.end}: ${b.jobs} jobs, ${tk(b.value)}`}
                  onClick={() => setWeek(week === b.week ? null : b.week)}
                >
                  <span className="lab">{tkS(b.value)}</span>
                  <span
                    className="fill due"
                    style={{ height: `${((b.value / max) * 100).toFixed(1)}%` }}
                  />
                  {/* scaled against the same max, not nested inside the due bar:
                      a week with nothing due can still have arrivals clearing
                      the backlog, and nesting hid exactly those */}
                  <span
                    className="fill exp"
                    style={{
                      height: `${(((sim.weeks[b.week - 1]?.expValue ?? 0) / max) * 100).toFixed(1)}%`,
                    }}
                  />
                </button>
              ))}
            </div>
            <div className="xaxis">
              {w.buckets.map((b) => (
                <div key={b.week}>
                  <b>{b.jobs}</b>
                  <span style={{ color: "var(--accent-ink)" }}>
                    ~{(sim.weeks[b.week - 1]?.expJobs ?? 0).toFixed(0)} come
                  </span>
                  <br />
                  {b.start.slice(5).replace("-", "/")}
                </div>
              ))}
            </div>
          </div>
          <p style={{ marginTop: 12, fontSize: 12, color: "var(--ink-3)" }}>
            The pale bar is work <b>due</b>. The solid bar is what is expected
            to actually <b>arrive</b>: {sim.draws} simulated draws of who turns
            up, using the same return model the call list ranks on, and the rule
            engine for what gets done once they do. Backtested by rewinding
            every case eight weeks — mean error 4.8 jobs against 6.7 for
            assuming everyone arrives on their due date, with the 80% band
            covering the truth in 20 of 25 cases.
          </p>
          <p style={{ marginTop: 6, fontSize: 12, color: "var(--ink-3)" }}>
            Weeks run from the case date, {a.today}. Overdue items are{" "}
            <b>not</b> in these bars — they are the {w.backlog.jobs}-job backlog
            above, which has to be squeezed in on top of this.
            {sim.skipped > 0 &&
              ` ${sim.skipped} vehicle${sim.skipped === 1 ? "" : "s"} with no service history could not be simulated.`}
          </p>
        </div>
      </div>

      {sel && (
        <div className="panel">
          <div className="panel-hd">
            <h2>
              Week {sel.week} · {sel.start} → {sel.end}
            </h2>
            <span className="note">
              {sel.jobs} jobs · {tk(sel.value)}
            </span>
            <button
              type="button"
              className="btn sm"
              onClick={() => setWeek(null)}
            >
              Close
            </button>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>Due</th>
                  <th>Item</th>
                  <th>Vehicle</th>
                  <th>Owner</th>
                  <th className="r">Cost</th>
                </tr>
              </thead>
              <tbody>
                {sel.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      style={{ padding: 20, color: "var(--ink-3)" }}
                    >
                      Nothing due this week.
                    </td>
                  </tr>
                )}
                {sel.items.map((j) => (
                  <tr
                    className={`stripe ${j.status}`}
                    key={`${j.vehicleId}-${j.item}`}
                  >
                    <td className="num">{j.dueDate}</td>
                    <td>
                      <b>{j.item}</b>
                    </td>
                    <td>
                      {j.model} <Plate>{j.plate}</Plate>
                    </td>
                    <td>{j.owner}</td>
                    <td className="r money">{tkS(j.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

export function Reminders({
  a,
  message,
  onCopy,
}: {
  a: Analysis;
  message: (ownerId: string) => string;
  onCopy: (ownerId: string, label: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();

  const ownerIds: string[] = [];
  for (const r of a.callList)
    if (!ownerIds.includes(r.owner.id)) ownerIds.push(r.owner.id);

  const shown = ownerIds.filter((id) => {
    if (!q) return true;
    const o = a.callList.find((r) => r.owner.id === id)?.owner;
    return `${o?.name} ${o?.phone}`.toLowerCase().includes(q);
  });

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Copy-ready reminders</h2>
        <input
          type="text"
          placeholder="Owner or phone…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 210 }}
        />
        <span className="note">
          {ownerIds.length} owner{ownerIds.length === 1 ? "" : "s"} · one
          message each, in call-list order
        </span>
      </div>
      <div className="panel-bd">
        {shown.length === 0 && (
          <p style={{ color: "var(--ink-3)" }}>Nothing matches that filter.</p>
        )}
        {shown.map((id) => {
          const rows = a.callList.filter((r) => r.owner.id === id);
          const o = rows[0].owner;
          const total = rows.reduce((s, r) => s + r.totalCost, 0);
          return (
            <div className="remcard" key={id}>
              <div className="hd">
                <b>{o.name}</b>
                <span
                  className="num"
                  style={{ color: "var(--ink-3)", fontSize: 12 }}
                >
                  {o.phone}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {rows.length} vehicle{rows.length === 1 ? "" : "s"} ·{" "}
                  {tk(total)}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <WhatsAppButton small phone={o.phone} text={message(id)} />
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => onCopy(id, "Copy message")}
                  >
                    Copy message
                  </button>
                </span>
              </div>
              <pre>{message(id)}</pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
