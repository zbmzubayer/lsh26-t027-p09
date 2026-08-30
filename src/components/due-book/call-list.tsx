"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/due-book-view";
import type { CallSort } from "@/lib/engine";
import { Chip, daysText, Plate, tk, tkS } from "./format";
import { ItemTable } from "./item-table";

export function CallList({
  a,
  dueSoonDays,
  sort,
  onSort,
  onOpenVehicle,
  onCopyReminder,
  onShowMethod,
}: {
  a: Analysis;
  dueSoonDays: number;
  sort: CallSort;
  onSort: (s: CallSort) => void;
  onOpenVehicle: (id: string) => void;
  onCopyReminder: (ownerId: string, label: string) => void;
  onShowMethod: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = filter.trim().toLowerCase();
  const rows = a.callList.filter((r) => {
    if (onlyOverdue && !r.items.some((i) => i.status === "overdue"))
      return false;
    if (!q) return true;
    return `${r.owner.name} ${r.vehicle.plate} ${r.vehicle.model} ${r.owner.phone}`
      .toLowerCase()
      .includes(q);
  });

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="k">Owners to call</div>
          <div className="v">{a.totals.ownersToCall}</div>
          <div className="n">of {a.totals.owners} on the books</div>
        </div>
        <div className="tile">
          <div className="k">Vehicles flagged</div>
          <div className="v">{a.callList.length}</div>
          <div className="n">of {a.totals.vehicles} in the yard</div>
        </div>
        <div className="tile crit">
          <div className="k">Overdue items</div>
          <div className="v">{a.totals.overdue}</div>
          <div className="n">
            {tk(a.totals.overdueValue)} of work already late
          </div>
        </div>
        <div className="tile warn">
          <div className="k">Due within {dueSoonDays} days</div>
          <div className="v">{a.totals.due_soon}</div>
          <div className="n">catch before they go late</div>
        </div>
        <div className="tile">
          <div className="k">Work on the table</div>
          <div className="v">{tkS(a.totals.dueValue)}</div>
          <div className="n">taka, overdue + due soon</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-hd">
          <h2>Today&apos;s call list</h2>
          <input
            type="text"
            placeholder="Owner, plate or model…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: 210 }}
          />
          <label
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              fontSize: 12.5,
              color: "var(--ink-2)",
            }}
          >
            <input
              type="checkbox"
              checked={onlyOverdue}
              onChange={(e) => setOnlyOverdue(e.target.checked)}
            />{" "}
            Overdue only
          </label>
          <select
            aria-label="Sort order"
            value={sort}
            onChange={(e) => onSort(e.target.value as CallSort)}
          >
            <option value="score">Rank by score</option>
            <option value="most_overdue">Rank by most overdue</option>
            <option value="highest_value">Rank by highest value</option>
          </select>
          <span className="note">
            {rows.length} row{rows.length === 1 ? "" : "s"} · tap a row for the
            reasons
          </span>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th style={{ width: 64, whiteSpace: "nowrap" }}>#</th>
                <th>Owner</th>
                <th>Vehicle</th>
                <th>State</th>
                <th>Worst item</th>
                <th className="r">Value due</th>
                <th
                  className="r"
                  title="Sum over the vehicle's items of cost × urgency × safety weight"
                >
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      padding: 26,
                      textAlign: "center",
                      color: "var(--ink-3)",
                    }}
                  >
                    Nothing matches that filter.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => {
                const id = r.vehicle.id;
                const open = expanded.has(id);
                const overdue = r.items.filter(
                  (x) => x.status === "overdue",
                ).length;
                const soon = r.items.filter(
                  (x) => x.status === "due_soon",
                ).length;
                const worst = overdue ? "overdue" : "due_soon";
                return [
                  <tr
                    key={id}
                    className={`callrow stripe ${worst}`}
                    aria-expanded={open}
                    tabIndex={0}
                    onClick={() => toggle(id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle(id);
                      }
                    }}
                  >
                    <td className="rank" style={{ whiteSpace: "nowrap" }}>
                      <span className="caret">▸</span> {i + 1}
                    </td>
                    <td>
                      <div className="owner">{r.owner.name}</div>
                      <div className="phone">{r.owner.phone}</div>
                    </td>
                    <td>
                      <div className="model">{r.vehicle.model}</div>
                      <div style={{ marginTop: 3 }}>
                        <Plate>{r.vehicle.plate}</Plate>
                      </div>
                    </td>
                    <td>
                      {overdue > 0 && (
                        <Chip status="overdue">{overdue} overdue</Chip>
                      )}{" "}
                      {soon > 0 && (
                        <Chip status="due_soon">{soon} due soon</Chip>
                      )}
                    </td>
                    <td
                      className="num"
                      style={{
                        whiteSpace: "nowrap",
                        color:
                          r.worstDaysLeft < 0
                            ? "var(--crit-ink)"
                            : "var(--warn-ink)",
                      }}
                    >
                      {daysText(
                        r.worstDaysLeft < 0 ? "overdue" : "due_soon",
                        r.worstDaysLeft,
                      )}
                    </td>
                    <td className="r money">{tkS(r.totalCost)}</td>
                    <td className="r score">{tkS(r.score)}</td>
                  </tr>,
                  open ? (
                    <tr className="detail" key={`${id}-d`}>
                      <td colSpan={7}>
                        <div className="detail-in">
                          <ItemTable statuses={r.items} compact />
                          <div className="rowacts">
                            <button
                              type="button"
                              className="btn sm primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenVehicle(id);
                              }}
                            >
                              Open vehicle page
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCopyReminder(
                                  r.owner.id,
                                  `Copy reminder for ${r.owner.name}`,
                                );
                              }}
                            >
                              Copy reminder for {r.owner.name}
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p
        style={{
          marginTop: 12,
          fontSize: 12.5,
          color: "var(--ink-3)",
          maxWidth: "74ch",
        }}
      >
        A vehicle appears here only when at least one item is overdue or falls
        inside the {dueSoonDays}-day window. Rank is the vehicle&apos;s score:
        every flagged item contributes{" "}
        <span className="num">cost × urgency × safety weight</span>, so a late
        brake job outranks a pile of cheap filters.{" "}
        <button
          type="button"
          className="btn sm"
          style={{ marginLeft: 4 }}
          onClick={onShowMethod}
        >
          How the ranking works →
        </button>
      </p>
    </>
  );
}
