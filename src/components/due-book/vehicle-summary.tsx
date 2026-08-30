"use client";

import type { VehicleView } from "@/lib/due-book-view";
import type { VisitPrediction } from "@/lib/visit";
import { Chip, km, Plate, tkS, WhatsAppButton } from "./format";
import { ItemCards } from "./item-table";

/**
 * A car's whole story, for the drawer: who owns it, what it is due for and why,
 * when the model expects them back, and what has been done to it. Same stacked
 * item cards the call-list drawer uses — a search hit and a call-list row are
 * the same question asked from two directions.
 */
export function VehicleSummary({
  v,
  prediction,
}: {
  v: VehicleView;
  prediction?: VisitPrediction | null;
}) {
  const history = [...v.vehicle.service_history].sort((a, b) =>
    b.date.localeCompare(a.date),
  );

  return (
    <>
      <div className="tiles" style={{ marginBottom: 16 }}>
        <div className="tile">
          <div className="k">Odometer</div>
          <div className="v">{km(v.currentKm)}</div>
          <div className="n">km, read {v.currentKmDate}</div>
        </div>
        <div className="tile">
          <div className="k">Daily running</div>
          <div className="v">{v.rate.toFixed(1)}</div>
          <div className="n">
            {v.rateSpan
              ? `km/day over ${v.rateSpan.days} days`
              : "km/day — fleet median, one reading only"}
          </div>
        </div>
        <div className={`tile ${v.counts.overdue ? "crit" : "warn"}`}>
          <div className="k">Value due</div>
          <div className="v">{v.dueValue ? tkS(v.dueValue) : "—"}</div>
          <div className="n">
            {v.counts.overdue} overdue, {v.counts.due_soon} due soon
          </div>
        </div>
      </div>

      {prediction && (
        <div className="flash" style={{ marginBottom: 16 }}>
          <b>Expected back {prediction.predictedVisit}</b>
          {prediction.pReturn30 != null && (
            <>
              {" — "}
              {Math.round((1 - prediction.pReturn30) * 100)}% chance they do not
              come on their own within 30 days
            </>
          )}
          <div style={{ marginTop: 5, fontSize: 12, opacity: 0.85 }}>
            {prediction.reason}
          </div>
        </div>
      )}

      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Every item on this car
      </div>
      <ItemCards statuses={v.statuses} />

      <div className="eyebrow" style={{ margin: "18px 0 8px" }}>
        Service history · {history.length} record
        {history.length === 1 ? "" : "s"}
      </div>
      <ul className="hist">
        {history.length === 0 && (
          <li style={{ color: "var(--ink-3)" }}>Nothing recorded yet.</li>
        )}
        {history.map((h, i) => (
          <li key={`${h.item}-${h.date}-${i}`}>
            <span className="d">{h.date}</span>
            <span>{h.item}</span>
            {h.km != null && (
              <span
                className="num"
                style={{ color: "var(--ink-3)", fontSize: 12 }}
              >
                {km(h.km)} km
              </span>
            )}
            <span className="money" style={{ marginLeft: "auto" }}>
              {tkS(Number(h.cost_bdt))}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export function VehicleSummarySubtitle({ v }: { v: VehicleView }) {
  return (
    <>
      <span>{v.owner.name}</span>
      <span className="num">{v.owner.phone}</span>
      <span>·</span>
      <Plate>{v.vehicle.plate}</Plate>
      {v.counts.overdue > 0 && (
        <Chip status="overdue">{v.counts.overdue} overdue</Chip>
      )}
      {v.counts.due_soon > 0 && (
        <Chip status="due_soon">{v.counts.due_soon} due soon</Chip>
      )}
      {v.worst === "fine" && <Chip status="fine">All fine</Chip>}
    </>
  );
}

export function VehicleSummaryActions({
  v,
  reminderText,
  onOpenVehicle,
  onCheckVisit,
  hasPrediction,
  predicting,
}: {
  v: VehicleView;
  reminderText: (ownerId: string) => string;
  onOpenVehicle: (vehicleId: string) => void;
  onCheckVisit?: () => void;
  hasPrediction?: boolean;
  predicting?: boolean;
}) {
  return (
    <>
      {onCheckVisit && !hasPrediction && (
        <button
          type="button"
          className="btn sm primary"
          onClick={onCheckVisit}
          disabled={predicting}
        >
          {predicting ? "Checking…" : "When will they be back?"}
        </button>
      )}
      <button
        type="button"
        className="btn sm"
        onClick={() => onOpenVehicle(v.vehicle.id)}
      >
        Open full vehicle page
      </button>
      {v.dueValue > 0 && (
        <WhatsAppButton
          small
          phone={v.owner.phone}
          text={reminderText(v.owner.id)}
        />
      )}
      <a
        className="btn sm"
        href={`tel:${v.owner.phone}`}
        style={{ textDecoration: "none" }}
      >
        Call {v.owner.phone}
      </a>
    </>
  );
}
