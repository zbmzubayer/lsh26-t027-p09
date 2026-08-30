"use client";

import { useMemo, useState } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import caseJson from "@/data/case-pub-01.json";
import {
  addOdometerReading,
  bdt,
  buildCallList,
  buildForecast,
  type CallSort,
  type CaseData,
  currentKm,
  type ItemStatus,
  kmPerDay,
  recordService,
  reminderMessage,
  type Status,
  vehicleStatuses,
} from "@/lib/engine";

const seed = caseJson as CaseData;

function StatusBadge({ status }: { status: Status }) {
  if (status === "overdue") return <Badge variant="destructive">Overdue</Badge>;
  if (status === "due_soon")
    return (
      <Badge
        className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30"
        variant="outline"
      >
        Due soon
      </Badge>
    );
  return <Badge variant="outline">Fine</Badge>;
}

function dueLabel(s: ItemStatus) {
  if (!Number.isFinite(s.daysLeft)) return "never (no usage)";
  if (s.daysLeft < 0) return `${-s.daysLeft} days overdue (${s.dueDate})`;
  if (s.daysLeft === 0) return `due today (${s.dueDate})`;
  return `in ${s.daysLeft} days (${s.dueDate})`;
}

export default function Home() {
  const [data, setData] = useState<CaseData>(seed);
  const [selectedId, setSelectedId] = useState(seed.vehicles[0].id);
  const [filter, setFilter] = useState("");
  const [kmInput, setKmInput] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [sort, setSort] = useState<CallSort>("score");

  const callList = useMemo(() => buildCallList(data, sort), [data, sort]);
  const forecast = useMemo(() => buildForecast(data), [data]);
  const allStatuses = useMemo(
    () => data.vehicles.flatMap((v) => vehicleStatuses(v, data.today)),
    [data],
  );
  const overdueCount = allStatuses.filter((s) => s.status === "overdue").length;
  const dueSoonCount = allStatuses.filter(
    (s) => s.status === "due_soon",
  ).length;

  const selected =
    data.vehicles.find((v) => v.id === selectedId) ?? data.vehicles[0];
  const selectedOwner = data.owners.find((o) => o.id === selected.owner_id);
  const selectedStatuses = vehicleStatuses(selected, data.today);

  const copyReminder = async (ownerId: string) => {
    await navigator.clipboard.writeText(reminderMessage(data, ownerId));
    setCopied(ownerId);
    setTimeout(() => setCopied(null), 1500);
  };

  const worst = (statuses: ItemStatus[]): Status =>
    statuses.some((s) => s.status === "overdue")
      ? "overdue"
      : statuses.some((s) => s.status === "due_soon")
        ? "due_soon"
        : "fine";

  const maxWeekCost = Math.max(
    forecast.backlog.cost,
    ...forecast.weeks.map((w) => w.cost),
    1,
  );

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-8 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Dhaka Auto Care — Service Due Predictor
          </h1>
          <p className="text-sm text-muted-foreground">
            Today:{" "}
            <span className="font-medium text-foreground">{data.today}</span> ·{" "}
            {data.vehicles.length} vehicles · {data.owners.length} owners ·{" "}
            <span className="text-destructive font-medium">
              {overdueCount} overdue
            </span>{" "}
            ·{" "}
            <span className="text-amber-600 dark:text-amber-400 font-medium">
              {dueSoonCount} due soon
            </span>{" "}
            · {bdt(forecast.backlog.cost)} overdue backlog
          </p>
        </div>
        <ThemeToggle />
      </header>

      <Tabs defaultValue="calls">
        <TabsList>
          <TabsTrigger value="calls">Daily call list</TabsTrigger>
          <TabsTrigger value="vehicles">Vehicles</TabsTrigger>
          <TabsTrigger value="forecast">8-week forecast</TabsTrigger>
        </TabsList>

        {/* ---------------- Call list ---------------- */}
        <TabsContent value="calls" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground max-w-2xl">
              Default rule: taka of work at risk, weighted by how late it is
              (overdue 1–7×, capped at 180 days; due soon 0–0.5×), with a 1.5×
              bump for safety/legal items — brake pads, tyres, fitness
              certificate, insurance.
            </p>
            <select
              className="rounded-md border bg-background px-2 py-1.5 text-sm"
              value={sort}
              onChange={(e) => setSort(e.target.value as CallSort)}
            >
              <option value="score">Sort: score (default)</option>
              <option value="most_overdue">Sort: most overdue</option>
              <option value="highest_value">Sort: highest value</option>
            </select>
          </div>
          {callList.map((row, i) => (
            <Card key={row.vehicle.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  <span className="text-muted-foreground mr-2">#{i + 1}</span>
                  {row.owner.name} ·{" "}
                  <span className="font-normal">{row.owner.phone}</span>
                  <button
                    type="button"
                    className="ml-2 font-normal text-muted-foreground hover:underline"
                    onClick={() => setSelectedId(row.vehicle.id)}
                  >
                    {row.vehicle.model} · {row.vehicle.plate}
                  </button>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <span className="text-sm tabular-nums">
                    score{" "}
                    <span className="font-semibold">
                      {Math.round(row.score).toLocaleString("en-IN")}
                    </span>{" "}
                    · {bdt(row.totalCost)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyReminder(row.owner.id)}
                  >
                    {copied === row.owner.id ? "Copied!" : "Copy reminder"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="font-mono text-xs text-muted-foreground">
                  {row.composition}
                </p>
                <ul className="space-y-1">
                  {row.items.map((s) => (
                    <li
                      key={s.item.name}
                      className="flex flex-wrap items-center gap-2 text-sm"
                    >
                      <StatusBadge status={s.status} />
                      <span className="font-medium">{s.item.name}</span>
                      <span className="text-muted-foreground">
                        {dueLabel(s)} · {s.reason} · {bdt(s.cost)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* ---------------- Vehicles ---------------- */}
        <TabsContent value="vehicles">
          <div className="grid gap-4 md:grid-cols-[280px_1fr]">
            <div className="space-y-2">
              <Input
                placeholder="Filter by plate, model, owner…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="max-h-[70vh] overflow-y-auto rounded-md border divide-y">
                {data.vehicles
                  .filter((v) => {
                    const owner = data.owners.find((o) => o.id === v.owner_id);
                    return `${v.plate} ${v.model} ${owner?.name}`
                      .toLowerCase()
                      .includes(filter.toLowerCase());
                  })
                  .map((v) => {
                    const w = worst(vehicleStatuses(v, data.today));
                    return (
                      <button
                        type="button"
                        key={v.id}
                        onClick={() => setSelectedId(v.id)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
                          v.id === selectedId ? "bg-accent" : ""
                        }`}
                      >
                        <span>
                          <span className="font-medium">{v.model}</span>
                          <span className="block text-xs text-muted-foreground">
                            {v.plate}
                          </span>
                        </span>
                        <span
                          className={`size-2 shrink-0 rounded-full ${
                            w === "overdue"
                              ? "bg-destructive"
                              : w === "due_soon"
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                          }`}
                        />
                      </button>
                    );
                  })}
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {selected.model} · {selected.plate}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Owner: {selectedOwner?.name} ({selectedOwner?.phone}) ·
                  Odometer: {currentKm(selected).toLocaleString()} km · ~
                  {Math.round(kmPerDay(selected))} km/day
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const km = Number(kmInput);
                    if (Number.isFinite(km) && km >= currentKm(selected)) {
                      setData((d) => addOdometerReading(d, selected.id, km));
                      setKmInput("");
                    }
                  }}
                >
                  <Input
                    className="max-w-45"
                    type="number"
                    min={currentKm(selected)}
                    placeholder={`New odometer (≥ ${currentKm(selected).toLocaleString()})`}
                    value={kmInput}
                    onChange={(e) => setKmInput(e.target.value)}
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    Update odometer
                  </Button>
                </form>

                <div className="rounded-md border divide-y">
                  {selectedStatuses.map((s) => (
                    <div
                      key={s.item.name}
                      className="flex flex-wrap items-center gap-2 p-3 text-sm"
                    >
                      <StatusBadge status={s.status} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {s.item.name}{" "}
                          <span className="font-normal text-muted-foreground">
                            · {bdt(s.cost)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Next due {dueLabel(s)} · {s.reason}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        onClick={() =>
                          setData((d) =>
                            recordService(
                              d,
                              selected.id,
                              s.item.name,
                              d.today,
                              s.item.rule === "distance_km"
                                ? currentKm(selected)
                                : undefined,
                            ),
                          )
                        }
                      >
                        Mark done today
                      </Button>
                    </div>
                  ))}
                </div>

                <div>
                  <h3 className="mb-1 text-sm font-medium">Service history</h3>
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {[...selected.service_history]
                      .sort((a, b) => b.date.localeCompare(a.date))
                      .map((h, i) => (
                        <li key={`${h.item}-${h.date}-${i}`}>
                          {h.date} — {h.item}
                          {h.km !== null
                            ? ` @ ${h.km.toLocaleString()} km`
                            : ""}{" "}
                          · {bdt(Number(h.cost_bdt))}
                        </li>
                      ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ---------------- Forecast ---------------- */}
        <TabsContent value="forecast" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Work coming up in the next 8 weeks (items whose next due date lands
            in each week), plus the overdue backlog.
          </p>
          <div className="space-y-2">
            {[forecast.backlog, ...forecast.weeks].map((w) => (
              <div key={w.label} className="flex items-center gap-3 text-sm">
                <span className="w-14 shrink-0 font-medium">{w.label}</span>
                <span className="w-40 shrink-0 text-xs text-muted-foreground">
                  {w.start ? `${w.start} → ${w.end}` : "before today"}
                </span>
                <div className="h-6 flex-1 rounded bg-muted">
                  <div
                    className={`h-full rounded ${w.label === "Overdue" ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${(w.cost / maxWeekCost) * 100}%` }}
                  />
                </div>
                <span className="w-36 shrink-0 text-right tabular-nums">
                  {w.count} items · {bdt(w.cost)}
                </span>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
