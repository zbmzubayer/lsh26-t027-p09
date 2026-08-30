"use client";

import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { Analysis, VehicleView } from "@/lib/due-book-view";
import type { VisitPrediction } from "@/lib/visit";
import { Chip, km, Plate, tk, tkS, WhatsAppButton } from "./format";

interface VisitResponse {
  source: "live" | "bundled";
  note?: string;
  predictions: VisitPrediction[];
}

async function askVisit(body: { ownerId: string }): Promise<VisitResponse> {
  const res = await fetch("/api/visit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `${res.status}`);
  return json as VisitResponse;
}

/**
 * Look a customer up by anything printed on the paperwork — name, phone, plate,
 * model or vehicle id — and see everything they own in one place, including
 * when the model expects them back.
 */
export function Search({
  a,
  onOpenVehicle,
  reminderText,
}: {
  a: Analysis;
  onOpenVehicle: (id: string) => void;
  reminderText: (ownerId: string) => string;
}) {
  const [q, setQ] = useState("");
  const [visits, setVisits] = useState<
    Record<string, { source: string; note?: string; rows: VisitPrediction[] }>
  >({});

  const visit = useMutation({
    mutationFn: askVisit,
    onSuccess: (data, vars) =>
      setVisits((prev) => ({
        ...prev,
        [vars.ownerId]: {
          source: data.source,
          note: data.note,
          rows: data.predictions,
        },
      })),
  });

  const term = q.trim().toLowerCase();

  // group the workshop's vehicles under their customer, then keep the customers
  // that match — searching by plate should still show the owner's other cars
  const byOwner = new Map<string, VehicleView[]>();
  for (const v of a.vehicles) {
    const list = byOwner.get(v.owner.id) ?? [];
    list.push(v);
    byOwner.set(v.owner.id, list);
  }

  const results = [...byOwner.entries()]
    .map(([id, vehicles]) => ({ owner: vehicles[0].owner, id, vehicles }))
    .filter(({ owner, vehicles }) => {
      if (!term) return false;
      const hay = [
        owner.name,
        owner.phone,
        ...vehicles.flatMap((v) => [
          v.vehicle.plate,
          v.vehicle.model,
          v.vehicle.id,
        ]),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(term);
    })
    .sort((x, y) => x.owner.name.localeCompare(y.owner.name));

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Find a customer or a car</h2>
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, phone, plate, model or vehicle id…"
          style={{ width: 300 }}
          // biome-ignore lint/a11y/noAutofocus: this tab exists only to be typed into
          autoFocus
        />
        <span className="note">
          {term
            ? `${results.length} customer${results.length === 1 ? "" : "s"}`
            : `${a.totals.owners} customers · ${a.totals.vehicles} cars on the books`}
        </span>
      </div>
      <div className="panel-bd">
        {!term && (
          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            Type a plate off the windscreen, a phone number off the job card, or
            part of a name.
          </p>
        )}
        {term && results.length === 0 && (
          <p style={{ color: "var(--ink-3)", fontSize: 13 }}>
            Nothing on the books matches “{q.trim()}”.
          </p>
        )}

        {results.map(({ owner, id, vehicles }) => {
          const pred = visits[id];
          const due = vehicles.reduce((s, v) => s + v.dueValue, 0);
          const overdue = vehicles.reduce((s, v) => s + v.counts.overdue, 0);
          const soon = vehicles.reduce((s, v) => s + v.counts.due_soon, 0);
          const pending = visit.isPending && visit.variables?.ownerId === id;

          return (
            <div className="remcard" key={id} style={{ marginBottom: 12 }}>
              <div className="hd">
                <b>{owner.name}</b>
                <span
                  className="num"
                  style={{ color: "var(--ink-3)", fontSize: 12 }}
                >
                  {owner.phone}
                </span>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
                  {vehicles.length} car{vehicles.length === 1 ? "" : "s"}
                  {due > 0 ? ` · ${tk(due)} due` : " · nothing due"}
                </span>
                {overdue > 0 && <Chip status="overdue">{overdue} overdue</Chip>}
                {soon > 0 && <Chip status="due_soon">{soon} due soon</Chip>}
                <span
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {due > 0 && (
                    <WhatsAppButton
                      small
                      phone={owner.phone}
                      text={reminderText(id)}
                    />
                  )}
                  <button
                    type="button"
                    className="btn sm primary"
                    disabled={pending}
                    onClick={() => visit.mutate({ ownerId: id })}
                  >
                    {pending ? "Checking…" : "When will they be back?"}
                  </button>
                </span>
              </div>

              <div className="scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Car</th>
                      <th>Odometer</th>
                      <th>State</th>
                      <th className="r">Value due</th>
                      {pred && <th>Expected back</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => {
                      const p = pred?.rows.find(
                        (r) => r.vehicleId === v.vehicle.id,
                      );
                      return (
                        <tr
                          key={v.vehicle.id}
                          className={`callrow stripe ${v.worst}`}
                          onClick={() => onOpenVehicle(v.vehicle.id)}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") onOpenVehicle(v.vehicle.id);
                          }}
                        >
                          <td>
                            <div className="model">{v.vehicle.model}</div>
                            <div style={{ marginTop: 3 }}>
                              <Plate>{v.vehicle.plate}</Plate>
                            </div>
                          </td>
                          <td className="num" style={{ whiteSpace: "nowrap" }}>
                            {km(v.currentKm)} km
                            <div
                              style={{ color: "var(--ink-3)", fontSize: 11 }}
                            >
                              {v.rate.toFixed(1)} km/day
                            </div>
                          </td>
                          <td>
                            {v.counts.overdue > 0 && (
                              <Chip status="overdue">
                                {v.counts.overdue} overdue
                              </Chip>
                            )}{" "}
                            {v.counts.due_soon > 0 && (
                              <Chip status="due_soon">
                                {v.counts.due_soon} due soon
                              </Chip>
                            )}
                            {v.worst === "fine" && (
                              <Chip status="fine">All fine</Chip>
                            )}
                          </td>
                          <td className="r money">
                            {v.dueValue ? tkS(v.dueValue) : "—"}
                          </td>
                          {pred && (
                            <td style={{ maxWidth: "42ch" }}>
                              {p ? (
                                <>
                                  <span className="num">
                                    <b>{p.predictedVisit}</b>
                                  </span>
                                  {p.willDrift ? (
                                    <span
                                      className="chip overdue"
                                      style={{ marginLeft: 6 }}
                                    >
                                      <span className="dot" />
                                      {p.driftDays}d late — call them
                                    </span>
                                  ) : (
                                    <span
                                      className="chip fine"
                                      style={{ marginLeft: 6 }}
                                    >
                                      <span className="dot" />
                                      comes in on their own
                                    </span>
                                  )}
                                  <div className="why" style={{ marginTop: 3 }}>
                                    {p.reason}
                                  </div>
                                  <div
                                    style={{
                                      color: "var(--ink-3)",
                                      fontSize: 11,
                                      marginTop: 2,
                                    }}
                                  >
                                    80% window {p.windowFrom} → {p.windowTo} ·{" "}
                                    {p.basis}
                                  </div>
                                </>
                              ) : (
                                "—"
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {pred?.note && (
                <p
                  style={{
                    padding: "8px 12px",
                    margin: 0,
                    fontSize: 11.5,
                    color: "var(--ink-3)",
                    borderTop: "1px solid var(--line)",
                  }}
                >
                  {pred.note}
                </p>
              )}
            </div>
          );
        })}

        {visit.isError && (
          <output className="flash bad">
            {(visit.error as Error).message}
          </output>
        )}
      </div>
    </div>
  );
}
