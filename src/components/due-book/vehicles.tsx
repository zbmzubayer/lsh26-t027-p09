"use client";

import { useState } from "react";
import type { Analysis } from "@/lib/due-book-view";
import { Chip, km, Plate } from "./format";

export function VehicleGrid({
  a,
  onOpen,
}: {
  a: Analysis;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const q = filter.trim().toLowerCase();

  const list = [...a.vehicles]
    .sort(
      (x, y) => y.score - x.score || x.vehicle.id.localeCompare(y.vehicle.id),
    )
    .filter(
      (v) =>
        !q ||
        `${v.owner.name} ${v.vehicle.plate} ${v.vehicle.model} ${v.vehicle.id}`
          .toLowerCase()
          .includes(q),
    );

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>All vehicles</h2>
        <input
          type="text"
          placeholder="Owner, plate, model or id…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: 230 }}
        />
        <span className="note">
          {list.length} of {a.vehicles.length} · worst first
        </span>
      </div>
      <div className="panel-bd">
        <div className="vgrid">
          {list.length === 0 && (
            <p style={{ color: "var(--ink-3)" }}>
              Nothing matches that filter.
            </p>
          )}
          {list.map((v) => (
            <button
              type="button"
              key={v.vehicle.id}
              className={`vcard ${v.worst}`}
              onClick={() => onOpen(v.vehicle.id)}
            >
              <div className="row1">
                <span className="model">{v.vehicle.model}</span>
                <span className="vid">{v.vehicle.id}</span>
              </div>
              <Plate>{v.vehicle.plate}</Plate>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                {v.owner.name} · <span className="num">{v.owner.phone}</span>
              </div>
              <div className="counts">
                {v.counts.overdue > 0 && (
                  <Chip status="overdue">{v.counts.overdue}</Chip>
                )}
                {v.counts.due_soon > 0 && (
                  <Chip status="due_soon">{v.counts.due_soon}</Chip>
                )}
                {v.worst === "fine" && <Chip status="fine">All fine</Chip>}
              </div>
              <div
                style={{ fontSize: 11.5, color: "var(--ink-3)", marginTop: 1 }}
              >
                <span className="num">{km(v.currentKm)}</span> km ·{" "}
                <span className="num">{v.rate.toFixed(1)}</span> km/day
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Sparkline({
  readings,
}: {
  readings: { date: string; km: number }[];
}) {
  const W = 190;
  const H = 52;
  const P = 5;
  const day = (d: string) => Date.parse(d) / 86400000;
  const xs = readings.map((r) => day(r.date));
  const ys = readings.map((r) => r.km);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const sx = (v: number) =>
    P + (x1 === x0 ? 0 : (v - x0) / (x1 - x0)) * (W - 2 * P);
  const sy = (v: number) =>
    H - P - (y1 === y0 ? 0 : (v - y0) / (y1 - y0)) * (H - 2 * P);
  const last = readings[readings.length - 1];

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Odometer from ${km(ys[0])} km on ${readings[0].date} to ${km(last.km)} km on ${last.date}`}
    >
      <polyline
        points={readings
          .map((r) => `${sx(day(r.date)).toFixed(1)},${sy(r.km).toFixed(1)}`)
          .join(" ")}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {readings.map((r) => (
        <circle
          key={r.date}
          cx={sx(day(r.date)).toFixed(1)}
          cy={sy(r.km).toFixed(1)}
          r={2.6}
          fill="var(--surface)"
          stroke="var(--accent)"
          strokeWidth={1.5}
        />
      ))}
      <circle
        cx={sx(day(last.date)).toFixed(1)}
        cy={sy(last.km).toFixed(1)}
        r={4.5}
        fill="var(--accent)"
        stroke="var(--surface)"
        strokeWidth={2}
      />
    </svg>
  );
}
