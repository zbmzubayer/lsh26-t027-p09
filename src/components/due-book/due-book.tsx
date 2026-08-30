"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LogoutButton } from "@/components/auth/logout-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { analyse } from "@/lib/due-book-view";
import {
  type CallSort,
  type CaseData,
  DEFAULT_OPTS,
  type EngineOpts,
  reminderMessage,
  vehicleStatuses,
} from "@/lib/engine";
import type { VisitPrediction } from "@/lib/visit";
import { CallList } from "./call-list";
import { DetailDrawer } from "./detail-drawer";
import { IntakeForm, type IntakePayload } from "./intake-form";
import { Method } from "./method";
import { Search } from "./search";
import type { Flash } from "./vehicle-detail";
import { VehicleDetail } from "./vehicle-detail";
import { VehicleGrid } from "./vehicles";
import { Reminders, Workload } from "./workload";

type View =
  | "call"
  | "vehicles"
  | "vehicle"
  | "search"
  | "workload"
  | "reminders";

const TABS: [View, string][] = [
  ["call", "Call list"],
  ["vehicles", "Vehicles"],
  ["search", "Search"],
  ["workload", "Workload"],
  ["reminders", "Reminders"],
];

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body as T;
}

export function DueBook({
  user,
  caseId,
}: {
  user: { name: string; email: string };
  /** The workshop this account works out of, resolved on the server. */
  caseId: string;
}) {
  const qc = useQueryClient();
  const [view, setView] = useState<View>("call");
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [opts, setOpts] = useState<EngineOpts>(DEFAULT_OPTS);
  const [sort, setSort] = useState<CallSort>("score");
  const [flash, setFlash] = useState<Flash | null>(null);
  const [copied, setCopied] = useState<{ label: string; ok: boolean } | null>(
    null,
  );
  const [methodOpen, setMethodOpen] = useState(false);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);

  const kase = useQuery({
    queryKey: ["case", caseId],
    queryFn: () => json<CaseData>("/api/case"),
  });

  /**
   * Both writes return the freshly re-assembled case, so there is one read path
   * and the cache is replaced rather than invalidated-and-refetched. The flash
   * names the single item whose next-due date moved and counts the ones that
   * did not — the reset guarantee, checked on screen instead of eyeballed.
   */
  const write = useMutation({
    mutationFn: async (
      req:
        | { kind: "service"; itemName: string; date: string; km?: number }
        | { kind: "odometer"; km: number }
        | { kind: "item"; name: string; dueDate?: string },
    ) => {
      if (!vehicleId) throw new Error("No vehicle selected");
      const before = new Map(
        (kase.data
          ? vehicleStatuses(
              kase.data.vehicles.find((v) => v.id === vehicleId) ??
                kase.data.vehicles[0],
              kase.data.today,
              opts,
            )
          : []
        ).map((s) => [s.item.name, s.dueDate]),
      );
      const url =
        req.kind === "service"
          ? "/api/service"
          : req.kind === "odometer"
            ? "/api/odometer"
            : "/api/service-item";
      const payload =
        req.kind === "service"
          ? {
              vehicleId,
              itemName: req.itemName,
              date: req.date,
              ...(req.km != null ? { km: req.km } : {}),
            }
          : req.kind === "odometer"
            ? { vehicleId, km: req.km }
            : {
                vehicleId,
                name: req.name,
                ...(req.dueDate ? { dueDate: req.dueDate } : {}),
              };
      const next = await json<CaseData>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { next, before, kind: req.kind };
    },
    onSuccess: ({ next, before, kind }) => {
      qc.setQueryData(["case", caseId], next);
      const v = next.vehicles.find((x) => x.id === vehicleId);
      if (!v) return;
      const after = vehicleStatuses(v, next.today, opts);
      const moved = after.filter((s) => before.get(s.item.name) !== s.dueDate);
      const still = after.length - moved.length;
      if (kind === "item") {
        const fitted = after.find((s) => !before.has(s.item.name));
        setFlash({
          text: fitted
            ? `${fitted.item.name} fitted — first due ${fitted.dueDate} (${fitted.reason}).`
            : "Service fitted.",
        });
        return;
      }
      setFlash({
        text: moved.length
          ? `${moved
              .map(
                (m) =>
                  `${m.item.name} now due ${m.dueDate} (was ${before.get(m.item.name)})`,
              )
              .join(
                "; ",
              )}. The other ${still} item${still === 1 ? "" : "s"} on this vehicle did not move.`
          : kind === "odometer"
            ? "Reading saved. No next-due date changed — this vehicle has no distance-based item close enough to shift."
            : "Saved. No next-due date changed.",
      });
    },
    onError: (e: Error) => setFlash({ bad: true, text: e.message }),
  });

  /** Customer + car + services in one call; jumps straight to the new car. */
  const intake = useMutation({
    mutationFn: (payload: IntakePayload) =>
      json<{ vehicleId: string; case: CaseData }>("/api/vehicle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    onSuccess: ({ vehicleId: id, case: next }) => {
      qc.setQueryData(["case", caseId], next);
      const v = next.vehicles.find((x) => x.id === id);
      const owner = next.owners.find((o) => o.id === v?.owner_id);
      const first = v
        ? [...vehicleStatuses(v, next.today, opts)].sort((a, b) =>
            a.dueDate.localeCompare(b.dueDate),
          )[0]
        : undefined;
      setIntakeOpen(false);
      setIntakeError(null);
      setVehicleId(id);
      setView("vehicle");
      setFlash({
        text: `${id} ${v?.model} added for ${owner?.name} with ${v?.service_items.length} services.${
          first ? ` First due: ${first.item.name}, ${first.dueDate}.` : ""
        }`,
      });
    },
    onError: (e: Error) => setIntakeError(e.message),
  });

  /**
   * "When will they be back?" for the open vehicle. Kept here rather than in
   * VehicleDetail so that component stays presentational, per ml/HANDOFF.md.
   */
  const visit = useMutation({
    mutationFn: (body: { vehicleId: string }) =>
      json<{
        source: "live" | "bundled";
        note?: string;
        predictions: VisitPrediction[];
      }>("/api/visit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
  });

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ label, ok: true });
    } catch {
      // The clipboard is blocked outside a secure context — over plain http on
      // a LAN address, say. Silently doing nothing looks like a broken button.
      setCopied({ label, ok: false });
    }
    setTimeout(() => setCopied(null), 2200);
  };

  const go = (v: View) => {
    setView(v);
    setFlash(null);
  };
  const openVehicle = (id: string) => {
    setVehicleId(id);
    setFlash(null);
    visit.reset(); // never show one car's predicted date under another's plate
    setView("vehicle");
  };

  const data = kase.data;
  const a = data ? analyse(data, opts, sort) : null;

  return (
    <div className="duebook">
      <header className="topbar">
        <div className="topbar-in">
          <div className="mark">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="29"
                height="29"
                rx="5"
                fill="var(--accent)"
              />
              <path
                d="M15 6.5a8.5 8.5 0 0 0-8.5 8.5"
                stroke="#fff"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
                opacity=".55"
              />
              <path
                d="M23.5 15A8.5 8.5 0 0 0 15 6.5"
                stroke="#fff"
                strokeWidth="2"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M15 15l5.2-3.4"
                stroke="#fff"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="15" cy="15" r="1.9" fill="#fff" />
              <path
                d="M8.5 21.5h13"
                stroke="#fff"
                strokeWidth="1.5"
                strokeLinecap="round"
                opacity=".45"
              />
            </svg>
            <div>
              <h1>Workshop Due Book</h1>
              <div className="sub">
                Service register &amp; daily call list · Dhaka
              </div>
            </div>
          </div>

          <div
            className="asof"
            title="Every date on this page is computed against the case's own date, not the browser clock."
          >
            <span>As of</span>
            <b>{a?.today ?? "—"}</b>
          </div>

          <div className="opt" style={{ gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--ink-3)" }}>
              {user.name}
              <span style={{ marginLeft: 8, opacity: 0.7 }}>{caseId}</span>
            </span>
            {copied && (
              <span
                className={`chip ${copied.ok ? "fine" : "overdue"}`}
                aria-live="polite"
                style={{ whiteSpace: "nowrap" }}
              >
                <span className="dot" />
                {copied.ok
                  ? `${copied.label} — copied`
                  : "Clipboard blocked — select the text instead"}
              </span>
            )}
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>

        <nav className="tabs" aria-label="Sections">
          <div className="tabs-in" role="tablist">
            {TABS.map(([k, label]) => {
              const count =
                k === "call"
                  ? a?.callList.length
                  : k === "vehicles"
                    ? a?.vehicles.length
                    : k === "workload"
                      ? a?.workload.totalJobs
                      : k === "reminders"
                        ? a?.totals.ownersToCall
                        : null;
              return (
                <button
                  type="button"
                  key={k}
                  className="tab"
                  role="tab"
                  aria-selected={
                    view === k || (k === "vehicles" && view === "vehicle")
                  }
                  onClick={() => go(k)}
                >
                  {label}
                  {count != null && <span className="cnt">{count}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <main className="shell">
        {view === "call" && (
          <div className="opts">
            <fieldset className="opt">
              <legend>Due-soon window</legend>
              <div className="seg">
                {[14, 30, 45].map((d) => (
                  <button
                    type="button"
                    key={d}
                    aria-pressed={opts.dueSoonDays === d}
                    onClick={() => setOpts((o) => ({ ...o, dueSoonDays: d }))}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="opt">
              <legend>Daily running from</legend>
              <div className="seg">
                {(
                  [
                    ["span", "All readings"],
                    ["last-two", "Last two"],
                  ] as [EngineOpts["kmBasis"], string][]
                ).map(([v, label]) => (
                  <button
                    type="button"
                    key={v}
                    aria-pressed={opts.kmBasis === v}
                    onClick={() => setOpts((o) => ({ ...o, kmBasis: v }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="opt">
              <legend>Safety &amp; legal weighting</legend>
              <div className="seg">
                <button
                  type="button"
                  aria-pressed={opts.riskWeights}
                  onClick={() => setOpts((o) => ({ ...o, riskWeights: true }))}
                >
                  On ×1.5
                </button>
                <button
                  type="button"
                  aria-pressed={!opts.riskWeights}
                  onClick={() => setOpts((o) => ({ ...o, riskWeights: false }))}
                >
                  Off
                </button>
              </div>
            </fieldset>
            <fieldset className="opt">
              <legend title="Rank by the calls that change an outcome: weight each row by how unlikely the owner is to arrive unprompted.">
                Who won&apos;t come on their own
              </legend>
              <div className="seg">
                <button
                  type="button"
                  aria-pressed={opts.returnWeighting}
                  onClick={() =>
                    setOpts((o) => ({ ...o, returnWeighting: true }))
                  }
                >
                  Weight
                </button>
                <button
                  type="button"
                  aria-pressed={!opts.returnWeighting}
                  onClick={() =>
                    setOpts((o) => ({ ...o, returnWeighting: false }))
                  }
                >
                  Off
                </button>
              </div>
            </fieldset>
            <div className="opt" style={{ marginLeft: "auto" }}>
              <span
                className="num"
                style={{ fontSize: 11.5, color: "var(--ink-3)" }}
              >
                {a
                  ? `${a.totals.overdue} overdue · ${a.totals.due_soon} due soon · ${a.totals.fine} fine of ${a.totals.items} items`
                  : ""}
              </span>
            </div>
          </div>
        )}

        <section role="tabpanel">
          {kase.isError && (
            <div className="flash bad">
              Could not load {caseId}: {(kase.error as Error).message}
            </div>
          )}
          {!a && !kase.isError && (
            <p style={{ color: "var(--ink-3)", padding: "40px 0" }}>
              Loading {caseId}…
            </p>
          )}
          {a && data && (
            <>
              {view === "call" && (
                <CallList
                  a={a}
                  dueSoonDays={opts.dueSoonDays}
                  sort={sort}
                  onSort={setSort}
                  onOpenVehicle={openVehicle}
                  onCopyReminder={(ownerId, label) =>
                    copy(reminderMessage(data, ownerId, opts), label)
                  }
                  reminderText={(ownerId) =>
                    reminderMessage(data, ownerId, opts)
                  }
                  onShowMethod={() => setMethodOpen(true)}
                />
              )}
              {view === "vehicles" && (
                <>
                  {intakeOpen ? (
                    <IntakeForm
                      a={a}
                      pending={intake.isPending}
                      error={intakeError}
                      onSubmit={(p) => intake.mutate(p)}
                      onCancel={() => {
                        setIntakeOpen(false);
                        setIntakeError(null);
                      }}
                    />
                  ) : (
                    <div style={{ marginBottom: 14 }}>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => setIntakeOpen(true)}
                      >
                        + Add a car to the books
                      </button>
                    </div>
                  )}
                  <VehicleGrid a={a} onOpen={openVehicle} />
                </>
              )}
              {view === "vehicle" && vehicleId && (
                <VehicleDetail
                  a={a}
                  vehicleId={vehicleId}
                  flash={flash}
                  pending={write.isPending}
                  onBack={() => go("vehicles")}
                  onRecord={(itemName, date, kmValue) =>
                    write.mutate({
                      kind: "service",
                      itemName,
                      date,
                      km: kmValue,
                    })
                  }
                  onOdometer={(kmValue) =>
                    write.mutate({ kind: "odometer", km: kmValue })
                  }
                  onAddItem={(name, dueDate) =>
                    write.mutate({ kind: "item", name, dueDate })
                  }
                  onCheckVisit={() => vehicleId && visit.mutate({ vehicleId })}
                  visit={visit.data?.predictions[0] ?? null}
                  visitSource={visit.data?.source ?? null}
                  visitPending={visit.isPending}
                  visitError={(visit.error as Error | null)?.message ?? null}
                />
              )}
              {view === "search" && (
                <Search
                  a={a}
                  onOpenVehicle={openVehicle}
                  reminderText={(ownerId) =>
                    reminderMessage(data, ownerId, opts)
                  }
                />
              )}
              {view === "workload" && (
                <Workload a={a} data={data} opts={opts} />
              )}
              {view === "reminders" && (
                <Reminders
                  a={a}
                  message={(ownerId) => reminderMessage(data, ownerId, opts)}
                  onCopy={(ownerId, label) =>
                    copy(reminderMessage(data, ownerId, opts), label)
                  }
                />
              )}
            </>
          )}
        </section>

        {a && (
          <DetailDrawer
            open={methodOpen}
            onOpenChange={setMethodOpen}
            eyebrow="How the ranking works"
            title="Every number on this page"
            subtitle={`${a.totals.items} items · measured against ${a.today}`}
          >
            <Method a={a} opts={opts} onCopy={copy} />
          </DetailDrawer>
        )}
      </main>
    </div>
  );
}
