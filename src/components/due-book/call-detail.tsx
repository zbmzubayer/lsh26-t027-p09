"use client";

import type { CallRow } from "@/lib/due-book-view";
import { Chip, daysText, Plate, tk, tkS, WhatsAppButton } from "./format";
import { ItemCards } from "./item-table";

/**
 * Everything worth knowing about one row of the call list: what is due, when,
 * why that date, and the arithmetic behind its position. Kept separate from the
 * drawer that presents it so the same block can be dropped anywhere.
 */
export function CallDetail({
  row,
  reminderText,
  onOpenVehicle,
  onCopy,
}: {
  row: CallRow;
  reminderText: (ownerId: string) => string;
  onOpenVehicle: (vehicleId: string) => void;
  onCopy: (ownerId: string, label: string) => void;
}) {
  const overdue = row.items.filter((i) => i.status === "overdue").length;
  const soon = row.items.filter((i) => i.status === "due_soon").length;

  return (
    <>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="k">Score</div>
          <div className="v">{tkS(row.score)}</div>
          <div className="n">cost × urgency × safety</div>
        </div>
        <div className="tile">
          <div className="k">Value due</div>
          <div className="v">{tkS(row.totalCost)}</div>
          <div className="n">across {row.items.length} items</div>
        </div>
        <div className={`tile ${row.worstDaysLeft < 0 ? "crit" : "warn"}`}>
          <div className="k">Worst item</div>
          <div className="v" style={{ fontSize: 17 }}>
            {daysText(
              row.worstDaysLeft < 0 ? "overdue" : "due_soon",
              row.worstDaysLeft,
            )}
          </div>
          <div className="n">
            {overdue > 0 && `${overdue} overdue`}
            {overdue > 0 && soon > 0 && " · "}
            {soon > 0 && `${soon} due soon`}
          </div>
        </div>
      </div>

      <ItemCards statuses={row.items} />

      <p
        style={{
          marginTop: 14,
          fontSize: 12.5,
          color: "var(--ink-3)",
          lineHeight: 1.6,
        }}
      >
        This vehicle sits where it does because of the sum in the score column —
        every flagged item contributes{" "}
        <span className="num">cost × urgency × safety weight</span>. Multipliers
        print to two decimals; the ranking carries full precision, so a printed
        line can land a few taka off the total.
      </p>

      <div className="rowacts">
        <button
          type="button"
          className="btn sm primary"
          onClick={() => onOpenVehicle(row.vehicle.id)}
        >
          Open vehicle page
        </button>
        <WhatsAppButton
          small
          phone={row.owner.phone}
          text={reminderText(row.owner.id)}
          label={`WhatsApp ${row.owner.name}`}
        />
        <a
          className="btn sm"
          href={`tel:${row.owner.phone}`}
          style={{ textDecoration: "none" }}
        >
          Call {row.owner.phone}
        </a>
        <button
          type="button"
          className="btn sm"
          onClick={() => onCopy(row.owner.id, "Copy reminder")}
        >
          Copy text
        </button>
      </div>
    </>
  );
}

/** The line under the drawer title: who to ring, about which car. */
export function CallDetailSubtitle({ row }: { row: CallRow }) {
  return (
    <>
      <span className="num">{row.owner.phone}</span>
      <span>·</span>
      <span>{row.vehicle.model}</span>
      <Plate>{row.vehicle.plate}</Plate>
      <span>·</span>
      <span>{tk(row.totalCost)} due</span>
      {row.items.some((i) => i.status === "overdue") && (
        <Chip status="overdue">
          {row.items.filter((i) => i.status === "overdue").length} overdue
        </Chip>
      )}
    </>
  );
}
