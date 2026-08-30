"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/due-book-view";
import {
  type CatalogueEntry,
  KNOWN_MODELS,
  SERVICE_CATALOGUE,
} from "@/lib/service-catalogue";
import { km as fmtKm, tkS } from "./format";

export interface IntakePayload {
  customer: { existingId: string } | { name: string; phone: string };
  model: string;
  plate: string;
  km: number;
  items: { name: string; dueDate?: string; cost?: number }[];
}

const intervalOf = (e: CatalogueEntry) =>
  e.rule === "period_months"
    ? `every ${e.everyMonths} mo`
    : e.rule === "distance_km"
      ? `every ${fmtKm(e.everyKm ?? 0)} km`
      : "expires on a date";

/**
 * A walk-in is one event, so it is one form: who they are, what they drive,
 * what it is due for. Services are ticked from the catalogue rather than typed
 * — the engine weights safety items by name, and a typo would silently rank the
 * car too low.
 */
export function IntakeForm({
  a,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  a: Analysis;
  pending: boolean;
  error: string | null;
  onSubmit: (payload: IntakePayload) => void;
  onCancel: () => void;
}) {
  const [isNew, setIsNew] = useState(true);
  const [existingId, setExistingId] = useState(a.vehicles[0]?.owner.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [model, setModel] = useState("");
  const [plate, setPlate] = useState("");
  const [odo, setOdo] = useState("");
  const [picked, setPicked] = useState<
    Record<string, { dueDate: string; cost: string }>
  >({});

  const owners = [...a.vehicles.map((v) => v.owner)]
    .filter((o, i, all) => all.findIndex((x) => x.id === o.id) === i)
    .sort((x, y) => x.name.localeCompare(y.name));

  const toggle = (e: CatalogueEntry) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (next[e.name]) delete next[e.name];
      else next[e.name] = { dueDate: "", cost: String(e.cost) };
      return next;
    });

  const chosen = Object.keys(picked);
  const missingDate = chosen.some(
    (n) =>
      SERVICE_CATALOGUE.find((e) => e.name === n)?.rule === "fixed_date" &&
      !picked[n].dueDate,
  );
  const ready =
    model.trim() &&
    plate.trim() &&
    odo !== "" &&
    chosen.length > 0 &&
    !missingDate &&
    (isNew ? name.trim() && /^\d{11}$/.test(phone) : existingId);

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Add a car to the books</h2>
        <span className="note">
          the reading is filed against the case date, {a.today}
        </span>
      </div>
      <div className="panel-bd">
        {error && (
          <output className="flash bad" style={{ marginBottom: 14 }}>
            {error}
          </output>
        )}

        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              customer: isNew
                ? { name: name.trim(), phone: phone.trim() }
                : { existingId },
              model: model.trim(),
              plate: plate.trim(),
              km: Number(odo),
              items: chosen.map((n) => {
                const entry = SERVICE_CATALOGUE.find((x) => x.name === n);
                const row = picked[n];
                return {
                  name: n,
                  ...(entry?.rule === "fixed_date"
                    ? { dueDate: row.dueDate }
                    : {}),
                  ...(Number(row.cost) !== entry?.cost
                    ? { cost: Number(row.cost) }
                    : {}),
                };
              }),
            });
          }}
        >
          {/* 1 — customer */}
          <div className="field">
            <span className="eyebrow">1 · Customer</span>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 6, fontSize: 13 }}>
                <input
                  type="radio"
                  checked={isNew}
                  onChange={() => setIsNew(true)}
                />
                New customer
              </label>
              <label style={{ display: "flex", gap: 6, fontSize: 13 }}>
                <input
                  type="radio"
                  checked={!isNew}
                  onChange={() => setIsNew(false)}
                />
                Already on the books
              </label>
            </div>
          </div>

          {isNew ? (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div className="field" style={{ flex: "1 1 200px" }}>
                <label htmlFor="cname">Name</label>
                <input
                  id="cname"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Rahim Uddin"
                />
              </div>
              <div className="field" style={{ flex: "1 1 160px" }}>
                <label htmlFor="cphone">Phone</label>
                <input
                  id="cphone"
                  type="text"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01711223344"
                />
                <span className="hint">11 digits</span>
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="cexisting">Customer</label>
              <select
                id="cexisting"
                value={existingId}
                onChange={(e) => setExistingId(e.target.value)}
              >
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.phone}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 2 — car */}
          <div className="field" style={{ marginTop: 6 }}>
            <span className="eyebrow">2 · Car</span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div className="field" style={{ flex: "1 1 180px" }}>
              <label htmlFor="vmodel">Model</label>
              <input
                id="vmodel"
                type="text"
                list="known-models"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Toyota Axio"
              />
              <datalist id="known-models">
                {KNOWN_MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div className="field" style={{ flex: "1 1 220px" }}>
              <label htmlFor="vplate">Plate</label>
              <input
                id="vplate"
                type="text"
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder="Dhaka Metro Ga 12-3456"
              />
            </div>
            <div className="field" style={{ flex: "0 1 160px" }}>
              <label htmlFor="vodo">Odometer now (km)</label>
              <input
                id="vodo"
                type="number"
                min={0}
                step={1}
                value={odo}
                onChange={(e) => setOdo(e.target.value)}
                placeholder="139157"
              />
            </div>
          </div>

          {/* 3 — services */}
          <div className="field" style={{ marginTop: 6 }}>
            <span className="eyebrow">
              3 · What it is due for — tick at least one
            </span>
          </div>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }} />
                  <th>Service</th>
                  <th>Rule</th>
                  <th style={{ width: 150 }}>Expiry on the paper</th>
                  <th className="r" style={{ width: 110 }}>
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {SERVICE_CATALOGUE.map((e) => {
                  const on = !!picked[e.name];
                  return (
                    <tr key={e.name}>
                      <td>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(e)}
                          aria-label={e.name}
                        />
                      </td>
                      <td>
                        <b>{e.name}</b>
                        {e.safety && (
                          <span className="rulepill" style={{ marginLeft: 6 }}>
                            safety ×1.5
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="rulepill">{intervalOf(e)}</span>
                      </td>
                      <td>
                        {e.rule === "fixed_date" ? (
                          <input
                            type="date"
                            value={picked[e.name]?.dueDate ?? ""}
                            disabled={!on}
                            required={on}
                            onChange={(ev) =>
                              setPicked((p) => ({
                                ...p,
                                [e.name]: {
                                  ...p[e.name],
                                  dueDate: ev.target.value,
                                },
                              }))
                            }
                          />
                        ) : (
                          <span style={{ color: "var(--ink-3)", fontSize: 12 }}>
                            worked out
                          </span>
                        )}
                      </td>
                      <td className="r">
                        {on ? (
                          <input
                            type="number"
                            min={0}
                            step={1}
                            style={{ width: 90, textAlign: "right" }}
                            value={picked[e.name].cost}
                            onChange={(ev) =>
                              setPicked((p) => ({
                                ...p,
                                [e.name]: {
                                  ...p[e.name],
                                  cost: ev.target.value,
                                },
                              }))
                            }
                          />
                        ) : (
                          <span className="money">{tkS(e.cost)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              className="btn primary"
              type="submit"
              disabled={!ready || pending}
            >
              {pending ? "Adding…" : "Add to books"}
            </button>
            <button className="btn" type="button" onClick={onCancel}>
              Cancel
            </button>
            {missingDate && (
              <span
                style={{
                  fontSize: 12,
                  color: "var(--warn-ink)",
                  alignSelf: "center",
                }}
              >
                a fixed-date service needs its expiry off the paper
              </span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
