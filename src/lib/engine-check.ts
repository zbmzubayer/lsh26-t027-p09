// Run: npx -y tsx src/lib/engine-check.ts
import "dotenv/config";
import assert from "node:assert";
import pub01 from "../data/case-pub-01.json";
import {
  addOdometerReading,
  buildCallList,
  buildForecast,
  type CaseData,
  computeItem,
  kmPerDay,
  readingProblem,
  recordService,
  vehicleStatuses,
} from "./engine";

// ---- format-note example (Rahim Uddin / Toyota Axio) ----
const data: CaseData = {
  case_id: "CHECK",
  today: "2026-08-30",
  owners: [{ id: "O01", name: "Rahim Uddin", phone: "01711223344" }],
  vehicles: [
    {
      id: "V01",
      owner_id: "O01",
      model: "Toyota Axio",
      plate: "Dhaka Metro Ga 12-3456",
      odometer_readings: [
        { date: "2026-07-31", km: 59935 },
        { date: "2026-08-30", km: 60835 },
      ],
      service_items: [
        {
          name: "Insurance",
          rule: "fixed_date",
          due_date: "2026-09-04",
          cost_bdt: "12000.00",
        },
        {
          name: "Air filter",
          rule: "period_months",
          every_months: 6,
          cost_bdt: "1200.00",
        },
        {
          name: "Brake pads",
          rule: "distance_km",
          every_km: 10000,
          cost_bdt: "6000.00",
        },
      ],
      service_history: [
        {
          item: "Air filter",
          date: "2026-02-26",
          km: null,
          cost_bdt: "1200.00",
        },
        {
          item: "Brake pads",
          date: "2026-04-11",
          km: 50835,
          cost_bdt: "6000.00",
        },
      ],
    },
  ],
};
const v = data.vehicles[0];

// daily running: 900 km over 30 days
assert.strictEqual(kmPerDay(v), 30);

// fixed date: 5 days away -> due_soon
const ins = computeItem(v, v.service_items[0], data.today);
assert.strictEqual(ins.daysLeft, 5);
assert.strictEqual(ins.status, "due_soon");

// period: 2026-02-26 + 6m = 2026-08-26 -> 4 days overdue
const filter = computeItem(v, v.service_items[1], data.today);
assert.strictEqual(filter.dueDate, "2026-08-26");
assert.strictEqual(filter.status, "overdue");

// distance: due at 60835, current 60835 -> due today
const pads = computeItem(v, v.service_items[2], data.today);
assert.strictEqual(pads.daysLeft, 0);
assert.strictEqual(pads.status, "due_soon");

// call list: one vehicle row; score = insurance 7,500 + filter 1,360 + pads 4,500
const calls = buildCallList(data);
assert.strictEqual(calls.length, 1);
assert.strictEqual(calls[0].worstDaysLeft, -4);
assert.strictEqual(Math.round(calls[0].score), 13360);

// record service resets only that item
const after = recordService(data, "V01", "Air filter");
const v2 = after.vehicles[0];
assert.strictEqual(
  computeItem(v2, v2.service_items[1], data.today).status,
  "fine",
);
assert.strictEqual(
  computeItem(v2, v2.service_items[2], data.today).status,
  "due_soon",
); // untouched
assert.strictEqual(v2.service_history.length, 3);

// distance items require a km
assert.throws(() => recordService(data, "V01", "Brake pads"));
// with a km above the last reading, an odometer reading is appended too
const afterPads = recordService(data, "V01", "Brake pads", "2026-08-30", 60900);
const vp = afterPads.vehicles[0];
assert.strictEqual(vp.odometer_readings.length, 3);
assert.strictEqual(
  computeItem(vp, vp.service_items[2], data.today).status,
  "fine",
);

// new odometer reading pushes brake pads overdue and raises the daily rate
const after2 = addOdometerReading(data, "V01", 62835);
const v3 = after2.vehicles[0];
assert.ok(kmPerDay(v3) > 30);
assert.strictEqual(
  computeItem(v3, v3.service_items[2], data.today).status,
  "overdue",
);

// ---- PUB-01 fixtures from the build guide ----
const kase = pub01 as CaseData;

// V28 Suzuki Alto: every rule type; km/day = 2,210 / 123 = 17.97
const v28 = kase.vehicles.find((x) => x.id === "V28");
assert.ok(v28);
assert.ok(Math.abs(kmPerDay(v28) - 2210 / 123) < 1e-9);
const expect28: Record<string, [string, number, string]> = {
  "engine oil": ["2026-04-17", -135, "overdue"],
  "air filter": ["2026-06-20", -71, "overdue"],
  tyres: ["2026-08-01", -29, "overdue"],
  "fitness certificate": ["2027-01-14", 137, "fine"],
  "battery warranty": ["2027-03-16", 198, "fine"],
};
for (const s of vehicleStatuses(v28, kase.today)) {
  const [due, days, status] = expect28[s.item.name.toLowerCase()];
  assert.strictEqual(s.dueDate, due, `${s.item.name} dueDate`);
  assert.strictEqual(s.daysLeft, days, `${s.item.name} daysLeft`);
  assert.strictEqual(s.status, status, `${s.item.name} status`);
}

// call list top 6 (guide's table)
const list = buildCallList(kase);
const top = list
  .slice(0, 6)
  .map((r) => [r.vehicle.id, Math.round(r.score)] as const);
console.log("top 6:", top);
assert.deepStrictEqual(top, [
  ["V28", 117690],
  ["V15", 91100],
  ["V16", 79338],
  ["V41", 77625],
  ["V27", 74637],
  ["V07", 64000],
]);

// backlog: 45 jobs, ৳387,700; 8-week buckets
const fc = buildForecast(kase);
console.log("backlog:", fc.backlog.count, fc.backlog.cost);
console.log(
  "weeks:",
  fc.weeks.map((w) => [w.count, w.cost]),
);
assert.strictEqual(fc.backlog.count, 45);
assert.strictEqual(Math.round(fc.backlog.cost), 387700);
assert.deepStrictEqual(
  fc.weeks.map((w) => [w.count, Math.round(w.cost)]),
  [
    [8, 80100],
    [8, 121700],
    [8, 111500],
    [8, 69800],
    [4, 53500],
    [3, 10200],
    [4, 28700],
    [3, 10800],
  ],
);

/* ---------------------------------------------------------------------------
 * Odometer plausibility. A mistyped digit lands silently and every distance
 * estimate on the car recomputes off it, so the guard is judged against the
 * vehicle's own running rather than a fleet constant.
 * ------------------------------------------------------------------------ */
{
  // 40 km/day: 1,200 km over the 30 days to 2026-08-30
  const readings = [
    { date: "2026-07-31", km: 59935 },
    { date: "2026-08-30", km: 61135 },
  ];
  const ok = (km: number, date = "2026-09-29") =>
    readingProblem(readings, date, km);

  assert.strictEqual(ok(62335), null, "a normal month's running was refused");
  // one long drive on top of a normal month, under the 300 km/day floor
  assert.strictEqual(ok(62700), null, "a long trip was refused");
  assert.ok(ok(611350)?.includes("km/day"), "a mistyped extra digit got in");
  assert.ok(
    ok(59000)?.includes("backwards"),
    "an odometer was allowed to run backwards",
  );
  // a reading dated the same day replaces rather than appends, so it is judged
  // against the reading *before* it, not against itself
  assert.strictEqual(
    ok(61200, "2026-08-30"),
    null,
    "a same-day correction was refused",
  );
  // replacing the same-day reading leaves one neighbour, which is not a span:
  // the rate must still be quoted from the car's own history, not the fleet
  assert.ok(
    readingProblem(readings, "2026-08-30", 610000)?.includes("40.0 km/day"),
    "a same-day correction was judged against the fleet median",
  );
  assert.ok(
    readingProblem(readings, "2026-08-15", 70000)?.includes("already read"),
    "a backdated reading was allowed to exceed a later one",
  );
  assert.strictEqual(
    readingProblem([], "2026-08-30", 101743),
    null,
    "a first reading has no history to contradict it",
  );
}

console.log("engine-check: odometer guard holds");

console.log("engine-check: all assertions passed");

/* ---------------------------------------------------------------------------
 * A vehicle entered by hand: one odometer reading, no service history yet.
 * Nothing in the 25 published cases looks like this — every distance and period
 * item there carries exactly one history row — but /api/run takes arbitrary
 * cases, and "add a vehicle" creates exactly this shape. With no past service
 * to count from, a distance item must count from the reading on the clock, not
 * from zero.
 * ------------------------------------------------------------------------ */
{
  const fresh: CaseData = {
    case_id: "FRESH",
    today: "2026-08-30",
    owners: [{ id: "O01", name: "Walk-in", phone: "01700000000" }],
    vehicles: [
      {
        id: "V43",
        owner_id: "O01",
        model: "Toyota Axio",
        plate: "Dhaka Metro Ga 99-9999",
        odometer_readings: [{ date: "2026-08-30", km: 139157 }],
        service_items: [
          {
            name: "Tyres",
            rule: "distance_km",
            every_km: 40000,
            cost_bdt: "32000.00",
          },
          {
            name: "Engine oil",
            rule: "period_months",
            every_months: 3,
            cost_bdt: "3500.00",
          },
        ],
        service_history: [],
      },
    ],
  };
  const fv = fresh.vehicles[0];
  const tyres = computeItem(fv, fv.service_items[0], fresh.today);
  // 139,157 + 40,000 = 179,157 km away at the fleet median 51 km/day (one
  // reading, so no rate of its own) => 784 days out, comfortably fine.
  assert.strictEqual(tyres.status, "fine", "a new car's tyres are not overdue");
  assert.strictEqual(tyres.daysLeft, 784);
  assert.ok(
    tyres.reason.includes("counted from the current reading at 139,157 km"),
    `reason should name the fallback, got: ${tyres.reason}`,
  );
  // period items with no history anchor on the first reading, as before
  const oil = computeItem(fv, fv.service_items[1], fresh.today);
  assert.strictEqual(oil.dueDate, "2026-11-30");
  assert.strictEqual(oil.status, "fine");
  console.log("engine-check: hand-entered vehicle (no history) behaves");
}

/* ---------------------------------------------------------------------------
 * Phase 5.5 — the same PUB-01 assertions against the case assembled out of
 * Postgres. If the DB assembly ever drifts from the published file, the call
 * list is being ranked on different data than it claims, and that shows up
 * here as a number rather than as a subtly wrong ordering.
 * Skipped when DATABASE_URL is unset, so the file half always runs offline.
 * ------------------------------------------------------------------------ */
async function checkDb() {
  const { loadCase } = await import("./case-db");
  const db = await loadCase("PUB-01");

  // the shape itself, field for field, ignoring service_items order (the
  // published file's order is not alphabetical and the DB has no order column)
  const norm = (c: CaseData) => ({
    ...c,
    vehicles: c.vehicles.map((v) => ({
      ...v,
      service_items: [...v.service_items].sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    })),
  });
  assert.deepStrictEqual(
    norm(db),
    norm(pub01 as CaseData),
    "DB-assembled PUB-01 differs from the published file",
  );

  const dbCalls = buildCallList(db).slice(0, 6);
  assert.deepStrictEqual(
    dbCalls.map((r) => [r.vehicle.id, Math.round(r.score)]),
    [
      ["V28", 117690],
      ["V15", 91100],
      ["V16", 79338],
      ["V41", 77625],
      ["V27", 74637],
      ["V07", 64000],
    ],
    "DB call list top-6 drifted",
  );

  const dbFc = buildForecast(db);
  assert.strictEqual(dbFc.backlog.count, 45);
  assert.strictEqual(Math.round(dbFc.backlog.cost), 387700);
  assert.deepStrictEqual(
    dbFc.weeks.map((w) => [w.count, Math.round(w.cost)]),
    fc.weeks.map((w) => [w.count, Math.round(w.cost)]),
    "DB weekly buckets drifted from the file's",
  );

  console.log("engine-check: DB assembly matches the published file");
}

if (process.env.DATABASE_URL) {
  checkDb()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  console.log("engine-check: DATABASE_URL unset, skipped the DB assertions");
}
