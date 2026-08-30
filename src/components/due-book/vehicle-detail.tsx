"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/due-book-view";
import { SERVICE_CATALOGUE } from "@/lib/service-catalogue";
import type { VisitPrediction } from "@/lib/visit";
import { km, Plate, ruleLabel, tkS } from "./format";
import { ItemTable } from "./item-table";
import { Sparkline } from "./vehicles";

export interface Flash {
  bad?: boolean;
  text: string;
}

export function VehicleDetail({
  a,
  vehicleId,
  flash,
  pending,
  onBack,
  onRecord,
  onOdometer,
  onAddItem,
  onCheckVisit,
  visit,
  visitSource,
  visitPending,
  visitError,
}: {
  a: Analysis;
  vehicleId: string;
  flash: Flash | null;
  pending: boolean;
  onBack: () => void;
  onRecord: (itemName: string, date: string, kmValue?: number) => void;
  onOdometer: (kmValue: number) => void;
  onAddItem: (name: string, dueDate?: string) => void;
  onCheckVisit: () => void;
  visit: VisitPrediction | null;
  visitSource: "live" | "bundled" | null;
  visitPending: boolean;
  visitError: string | null;
}) {
  const v = a.vehicles.find((x) => x.vehicle.id === vehicleId);
  const [itemName, setItemName] = useState(
    v?.vehicle.service_items[0]?.name ?? "",
  );
  const [date, setDate] = useState(a.today);
  const [serviceKm, setServiceKm] = useState(String(v?.currentKm ?? 0));
  const [odoKm, setOdoKm] = useState(
    String(Math.round((v?.currentKm ?? 0) + (v?.rate ?? 0) * 7)),
  );
  const [newItem, setNewItem] = useState("");
  const [newItemDate, setNewItemDate] = useState("");

  if (!v) return null;
  const item = v.vehicle.service_items.find((i) => i.name === itemName);
  const needsKm = item?.rule === "distance_km";
  const distItems = v.vehicle.service_items.filter(
    (i) => i.rule === "distance_km",
  );
  const fitted = new Set(v.vehicle.service_items.map((i) => i.name));
  const fittable = SERVICE_CATALOGUE.filter((e) => !fitted.has(e.name));
  const newItemNeedsDate =
    SERVICE_CATALOGUE.find((e) => e.name === newItem)?.rule === "fixed_date";

  const basisNote = v.rateSpan
    ? `${km(v.rateSpan.km)} km over ${v.rateSpan.days} days`
    : "only one odometer reading on file — using the fleet median of 51 km/day";

  return (
    <>
      <div className="crumb">
        <button type="button" onClick={onBack}>
          ← All vehicles
        </button>
        <span>/</span>
        <span>{v.vehicle.plate}</span>
      </div>

      {flash && (
        <output className={`flash ${flash.bad ? "bad" : ""}`}>
          {flash.text}
        </output>
      )}

      <div className="panel">
        <div className="vhead">
          <div className="who">
            <h2>{v.vehicle.model}</h2>
            <Plate>{v.vehicle.plate}</Plate>
            <div style={{ marginTop: 9, fontSize: 13 }}>
              {v.owner.name} · <span className="num">{v.owner.phone}</span>
            </div>
          </div>
          <div className="stat">
            <div className="eyebrow">Odometer</div>
            <div className="v">{km(v.currentKm)} km</div>
            <div className="n">read {v.currentKmDate}</div>
          </div>
          <div className="stat">
            <div className="eyebrow">Daily running</div>
            <div className="v">{v.rate.toFixed(1)} km</div>
            <div className="n">{basisNote}</div>
          </div>
          <div className="stat">
            <div className="eyebrow">Value due</div>
            <div className="v">{tkS(v.dueValue)}</div>
            <div className="n">
              {v.counts.overdue} overdue, {v.counts.due_soon} due soon
            </div>
          </div>
          <div className="sparkwrap">
            <div className="eyebrow" style={{ marginBottom: 4 }}>
              Odometer trend
            </div>
            <Sparkline readings={v.vehicle.odometer_readings} />
          </div>
        </div>
        <ItemTable statuses={v.statuses} />
      </div>

      <div className="grid2">
        <div className="panel">
          <div className="panel-hd">
            <h2>Record a completed service</h2>
          </div>
          <div className="panel-bd">
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                onRecord(
                  itemName,
                  date,
                  needsKm ? Number(serviceKm) : undefined,
                );
              }}
            >
              <div className="field">
                <label htmlFor="ritem">Item</label>
                <select
                  id="ritem"
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                >
                  {v.vehicle.service_items.map((i) => (
                    <option key={i.name} value={i.name}>
                      {i.name} — {ruleLabel(i)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="rdate">Date done</label>
                <input
                  id="rdate"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              {needsKm && (
                <div className="field">
                  <label htmlFor="rkm">Odometer at service (km)</label>
                  <input
                    id="rkm"
                    type="number"
                    min={0}
                    step={1}
                    value={serviceKm}
                    onChange={(e) => setServiceKm(e.target.value)}
                  />
                  <span className="hint">
                    Required for distance-based items — the reset counts from
                    this reading.
                  </span>
                </div>
              )}
              <button className="btn primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Record service"}
              </button>
            </form>
            <p style={{ marginTop: 11, fontSize: 12, color: "var(--ink-3)" }}>
              Resets that one item only. Every other next-due date on this
              vehicle is left where it was — the page tells you so after each
              save.
            </p>
          </div>
        </div>

        <div className="panel">
          <div className="panel-hd">
            <h2>New odometer reading</h2>
          </div>
          <div className="panel-bd">
            <form
              className="form"
              onSubmit={(e) => {
                e.preventDefault();
                onOdometer(Number(odoKm));
              }}
            >
              <div className="field">
                <label htmlFor="okm">Reading (km)</label>
                <input
                  id="okm"
                  type="number"
                  min={0}
                  step={1}
                  value={odoKm}
                  onChange={(e) => setOdoKm(e.target.value)}
                />
                <span className="hint">
                  Recorded against the case date, {a.today} — it replaces
                  today&apos;s reading rather than adding a second one.
                </span>
              </div>
              <button className="btn primary" type="submit" disabled={pending}>
                {pending ? "Saving…" : "Add reading"}
              </button>
            </form>
            <p style={{ marginTop: 11, fontSize: 12, color: "var(--ink-3)" }}>
              Recomputes daily running, then every distance-based estimate on
              this vehicle (
              {distItems.length
                ? distItems.map((i) => i.name).join(", ")
                : "none on this vehicle"}
              ). Fixed dates and time-based intervals do not move.
            </p>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <h2>When will they be back?</h2>
          <span className="note">
            the engine says when the work is due; this says when the owner
            actually turns up
          </span>
        </div>
        <div className="panel-bd">
          <button
            type="button"
            className="btn primary"
            onClick={onCheckVisit}
            disabled={visitPending}
          >
            {visitPending ? "Checking…" : "Check next visit"}
          </button>

          {visitError && (
            <output className="flash bad" style={{ marginTop: 10 }}>
              {visitError}
            </output>
          )}

          {visit && !visitError && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                }}
              >
                <span className="eyebrow">Expected back</span>
                <b className="num" style={{ fontSize: 19 }}>
                  {visit.predictedVisit}
                </b>
                {visit.willDrift ? (
                  <span className="chip overdue">
                    <span className="dot" />
                    {visit.driftDays} days after {visit.earliestDue} is due
                  </span>
                ) : (
                  <span className="chip fine">
                    <span className="dot" />
                    arrives before anything is due
                  </span>
                )}
              </div>
              {visit.pReturn30 != null && (
                <p style={{ marginTop: 8, fontSize: 13 }}>
                  <b className="num">
                    {Math.round((1 - visit.pReturn30) * 100)}%
                  </b>{" "}
                  chance they do <b>not</b> come on their own in the next 30
                  days
                  {visit.daysAway != null && (
                    <span style={{ color: "var(--ink-3)" }}>
                      {" "}
                      · last seen {visit.daysAway} days ago
                    </span>
                  )}
                </p>
              )}
              <p className="why" style={{ marginTop: 6 }}>
                {visit.reason}
              </p>
              <p
                style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-3)" }}
              >
                80% window {visit.windowFrom} → {visit.windowTo} · {visit.basis}{" "}
                · {visitSource === "bundled" ? "offline model" : "live model"}
              </p>
              {visit.willDrift && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: 12.5,
                    color: "var(--crit-ink)",
                  }}
                >
                  They will not come back on their own before this is due — this
                  is a car the phone call actually changes.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <h2>Fit another service to this car</h2>
          <span className="note">
            {fittable.length} of {SERVICE_CATALOGUE.length} not yet on it
          </span>
        </div>
        <div className="panel-bd">
          {fittable.length === 0 ? (
            <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
              Every service we fit is already on this car.
            </p>
          ) : (
            <form
              className="form"
              style={{
                flexDirection: "row",
                alignItems: "flex-end",
                gap: 10,
                flexWrap: "wrap",
              }}
              onSubmit={(e) => {
                e.preventDefault();
                onAddItem(newItem, newItemNeedsDate ? newItemDate : undefined);
                setNewItem("");
                setNewItemDate("");
              }}
            >
              <div className="field" style={{ flex: "1 1 240px" }}>
                <label htmlFor="newitem">Service</label>
                <select
                  id="newitem"
                  value={newItem}
                  onChange={(e) => setNewItem(e.target.value)}
                >
                  <option value="">Choose a service…</option>
                  {fittable.map((e) => (
                    <option key={e.name} value={e.name}>
                      {e.name} —{" "}
                      {ruleLabel({
                        name: e.name,
                        rule: e.rule,
                        every_months: e.everyMonths,
                        every_km: e.everyKm,
                        cost_bdt: String(e.cost),
                      })}{" "}
                      — {tkS(e.cost)}
                    </option>
                  ))}
                </select>
              </div>
              {newItemNeedsDate && (
                <div className="field" style={{ flex: "0 1 190px" }}>
                  <label htmlFor="newitemdate">Expiry on the paper</label>
                  <input
                    id="newitemdate"
                    type="date"
                    value={newItemDate}
                    required
                    onChange={(e) => setNewItemDate(e.target.value)}
                  />
                </div>
              )}
              <button
                className="btn primary"
                type="submit"
                disabled={
                  !newItem || (newItemNeedsDate && !newItemDate) || pending
                }
              >
                {pending ? "Saving…" : "Fit service"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <h2>Service history</h2>
          <span className="note">
            {v.vehicle.service_history.length} record
            {v.vehicle.service_history.length === 1 ? "" : "s"} · newest first
          </span>
        </div>
        <div className="panel-bd">
          <ul className="hist">
            {v.vehicle.service_history.length === 0 && (
              <li style={{ color: "var(--ink-3)" }}>Nothing recorded yet.</li>
            )}
            {[...v.vehicle.service_history]
              .sort((x, y) => y.date.localeCompare(x.date))
              .map((h, i) => (
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
        </div>
      </div>
    </>
  );
}
