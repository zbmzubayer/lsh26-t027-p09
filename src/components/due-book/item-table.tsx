import type { ItemStatus } from "@/lib/engine";
import { Chip, ruleLabel, tkS } from "./format";

/**
 * The one table that explains a vehicle's items. `compact` adds the score
 * arithmetic column — the same sentence the call list ranks on, printed so a
 * row's position is defensible without trusting the sort.
 */
export function ItemTable({
  statuses,
  compact,
}: {
  statuses: ItemStatus[];
  compact?: boolean;
}) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Next due</th>
            <th>State</th>
            <th className="r">Cost</th>
            {compact && (
              <th
                className="r"
                title="cost × urgency × safety weight. Multipliers are shown to two decimals; the ranking uses full precision."
              >
                Score
              </th>
            )}
            <th>Why that date</th>
          </tr>
        </thead>
        <tbody>
          {statuses.map((it) => (
            <tr className={`stripe ${it.status}`} key={it.item.name}>
              <td>
                <b>{it.item.name}</b>
                <div style={{ marginTop: 3 }}>
                  <span className="rulepill">{ruleLabel(it.item)}</span>
                </div>
              </td>
              <td className="num" style={{ whiteSpace: "nowrap" }}>
                {it.dueDate}
              </td>
              <td>
                <Chip
                  status={it.status}
                  days={Number.isFinite(it.daysLeft) ? it.daysLeft : null}
                />
              </td>
              <td className="r money">{tkS(it.cost)}</td>
              {compact && (
                <td className="r mathline">
                  {it.score > 0
                    ? `${tkS(it.cost)} × ${it.urgency.toFixed(2)}${
                        it.risk !== 1 ? " × 1.5" : ""
                      } ≈ ${tkS(it.score)}`
                    : "—"}
                </td>
              )}
              <td className="why">{it.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The same information as ItemTable, stacked instead of columned. A six-column
 * table clips its "why that date" sentence to a sliver inside a side drawer;
 * here the reason gets the full width, which is the column that matters most.
 */
export function ItemCards({ statuses }: { statuses: ItemStatus[] }) {
  return (
    <div className="itemcards">
      {statuses.map((it) => (
        <article className={`itemcard stripe ${it.status}`} key={it.item.name}>
          <div className="ic-top">
            <b>{it.item.name}</b>
            <span className="rulepill">{ruleLabel(it.item)}</span>
            <span style={{ marginLeft: "auto" }}>
              <Chip
                status={it.status}
                days={Number.isFinite(it.daysLeft) ? it.daysLeft : null}
              />
            </span>
          </div>
          <dl className="ic-facts">
            <div>
              <dt>Next due</dt>
              <dd className="num">{it.dueDate}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd className="money">{tkS(it.cost)}</dd>
            </div>
            <div>
              <dt>Score</dt>
              <dd className="money">{it.score > 0 ? tkS(it.score) : "—"}</dd>
            </div>
            {it.score > 0 && (
              <div className="ic-math">
                <dt>How</dt>
                <dd className="mathline">
                  {`${tkS(it.cost)} × ${it.urgency.toFixed(2)}${
                    it.risk !== 1 ? " × 1.5" : ""
                  } ≈ ${tkS(it.score)}`}
                </dd>
              </div>
            )}
          </dl>
          <p className="ic-why">
            <span className="eyebrow">Why that date</span>
            {it.reason}
          </p>
        </article>
      ))}
    </div>
  );
}
