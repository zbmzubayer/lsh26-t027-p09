import { addMonths, format, parseISO } from "date-fns";
import {
  type CaseData,
  type HistoryEntry,
  readingProblem,
  type ServiceItem,
  type Vehicle,
} from "@/lib/engine";
import prisma from "@/lib/prisma";
import { CATALOGUE_BY_NAME } from "@/lib/service-catalogue";

/**
 * Assembly of the published case shape out of Postgres. `GET /api/case` and the
 * two write routes all read through `loadCase`, so there is exactly one place
 * where DB rows become the JSON the engine, the UI and engine-check consume.
 *
 * Ordering: owners, vehicles by id; readings and history by date ascending —
 * which is how the published file is ordered too. `service_items` is the one
 * exception: the file's order is neither alphabetical nor insertable from the
 * DB (there is no order column), so items come back name-ascending. Nothing
 * downstream depends on it — the engine sorts items by score, `lastDone` looks
 * them up by name, and every number in engine-check is order-independent.
 */

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/** Case list for the switcher, cheapest form: ids, `today`, and two counts. */
export async function listCases() {
  const cases = await prisma.case.findMany({ orderBy: { id: "asc" } });
  const grouped = await prisma.vehicle.groupBy({
    by: ["caseId"],
    _count: { _all: true },
  });
  const owners = await prisma.owner.groupBy({
    by: ["caseId"],
    _count: { _all: true },
  });
  const vBy = new Map(grouped.map((g) => [g.caseId, g._count._all]));
  const oBy = new Map(owners.map((g) => [g.caseId, g._count._all]));
  return cases.map((c) => ({
    case_id: c.id,
    today: c.today,
    vehicles: vBy.get(c.id) ?? 0,
    owners: oBy.get(c.id) ?? 0,
  }));
}

export async function loadCase(caseId: string): Promise<CaseData> {
  const [kase, vehicles] = await Promise.all([
    prisma.case.findUnique({
      where: { id: caseId },
      include: { owners: { orderBy: { id: "asc" } } },
    }),
    prisma.vehicle.findMany({
      where: { caseId },
      orderBy: { id: "asc" },
      include: {
        odometerReadings: { orderBy: { date: "asc" } },
        serviceItems: { orderBy: { name: "asc" } },
        serviceRecords: {
          orderBy: { date: "asc" },
          include: { item: { select: { name: true } } },
        },
      },
    }),
  ]);
  if (!kase) throw new CaseNotFound(caseId);

  return {
    case_id: kase.id,
    today: kase.today,
    owners: kase.owners.map((o) => ({
      id: o.id,
      name: o.name,
      phone: o.phone,
    })),
    vehicles: vehicles.map(
      (v): Vehicle => ({
        id: v.id,
        owner_id: v.ownerId,
        model: v.model,
        plate: v.plate,
        odometer_readings: v.odometerReadings.map((r) => ({
          date: r.date,
          km: r.km,
        })),
        service_items: v.serviceItems.map(
          (i): ServiceItem => ({
            name: i.name,
            rule: i.rule,
            // exactly one of these is set per rule; undefined keeps the key out
            // of the JSON entirely, the way the published file has it
            ...(i.dueDate != null ? { due_date: i.dueDate } : {}),
            ...(i.everyMonths != null ? { every_months: i.everyMonths } : {}),
            ...(i.everyKm != null ? { every_km: i.everyKm } : {}),
            cost_bdt: i.costBdt.toFixed(2),
          }),
        ),
        service_history: v.serviceRecords.map(
          (r): HistoryEntry => ({
            item: r.item.name,
            date: r.date,
            km: r.km,
            cost_bdt: r.costBdt.toFixed(2),
          }),
        ),
      }),
    ),
  };
}

export class CaseNotFound extends Error {
  constructor(caseId: string) {
    super(`No case ${caseId}`);
  }
}
export class BadWrite extends Error {}

/**
 * A km is only believable against the car it belongs to. Both write paths that
 * can land one — a new reading, and the km on a recorded service — go through
 * here, because a guard on only one of them leaves the other still able to
 * poison every distance estimate on the vehicle with a mistyped digit.
 */
async function guardReading(
  caseId: string,
  vehicleId: string,
  date: string,
  km: number,
): Promise<void> {
  const readings = await prisma.odometerReading.findMany({
    where: { caseId, vehicleId },
    select: { date: true, km: true },
  });
  const problem = readingProblem(readings, date, km);
  if (problem) throw new BadWrite(problem);
}

/**
 * `recordService` as DB writes. Mirrors the pure function exactly: insert the
 * history row, push the odometer forward when the km beats the current reading,
 * and renew a fixed_date item's paper by 12 months. Reset falls out of
 * recomputation — exactly one item's next due changes.
 */
export async function recordServiceDb(
  caseId: string,
  vehicleId: string,
  itemName: string,
  date?: string,
  km?: number,
): Promise<CaseData> {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) throw new CaseNotFound(caseId);
  const when = date ?? kase.today;

  const item = await prisma.serviceItem.findUnique({
    where: { caseId_vehicleId_name: { caseId, vehicleId, name: itemName } },
  });
  if (!item) throw new BadWrite(`${vehicleId} has no item "${itemName}"`);
  if (item.rule === "distance_km" && km == null)
    throw new BadWrite(`${itemName} is distance-based and needs a km`);

  if (km != null) await guardReading(caseId, vehicleId, when, km);

  const latest = await prisma.odometerReading.findFirst({
    where: { caseId, vehicleId },
    orderBy: { date: "desc" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.serviceRecord.create({
      data: {
        caseId,
        vehicleId,
        serviceItemId: item.id,
        date: when,
        km: km ?? null,
        costBdt: item.costBdt,
      },
    });
    if (km != null && km > (latest?.km ?? 0)) {
      await tx.odometerReading.upsert({
        where: { caseId_vehicleId_date: { caseId, vehicleId, date: when } },
        create: { caseId, vehicleId, date: when, km },
        update: { km },
      });
    }
    if (item.rule === "fixed_date") {
      await tx.serviceItem.update({
        where: { id: item.id },
        data: { dueDate: iso(addMonths(parseISO(when), 12)) },
      });
    }
  });

  return loadCase(caseId);
}

/** Replace-or-append the reading dated `today`; distance estimates recompute. */
export async function addOdometerReadingDb(
  caseId: string,
  vehicleId: string,
  km: number,
): Promise<CaseData> {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) throw new CaseNotFound(caseId);
  const exists = await prisma.vehicle.findUnique({
    where: { caseId_id: { caseId, id: vehicleId } },
    select: { id: true },
  });
  if (!exists) throw new BadWrite(`No vehicle ${vehicleId} in ${caseId}`);

  await guardReading(caseId, vehicleId, kase.today, km);

  await prisma.odometerReading.upsert({
    where: {
      caseId_vehicleId_date: { caseId, vehicleId, date: kase.today },
    },
    create: { caseId, vehicleId, date: kase.today, km },
    update: { km },
  });
  return loadCase(caseId);
}

/* ---------------------------------------------------------------------------
 * Intake: putting a walk-in customer and their car onto the books.
 * ------------------------------------------------------------------------ */

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/**
 * Next free "V43" / "O28" for this workshop. Parses the number rather than
 * taking max() of the string, so the 100th vehicle sorts after the 99th.
 */
async function nextId(
  tx: Tx,
  caseId: string,
  kind: "vehicle" | "owner",
): Promise<string> {
  const rows =
    kind === "vehicle"
      ? await tx.vehicle.findMany({ where: { caseId }, select: { id: true } })
      : await tx.owner.findMany({ where: { caseId }, select: { id: true } });
  const max = rows.reduce(
    (m, r) => Math.max(m, Number.parseInt(r.id.slice(1), 10) || 0),
    0,
  );
  return `${kind === "vehicle" ? "V" : "O"}${String(max + 1).padStart(2, "0")}`;
}

export interface IntakeItem {
  name: string;
  /** required for fixed_date items, rejected for the other two */
  dueDate?: string;
  /** overrides the catalogue price */
  cost?: number;
}

export interface IntakeInput {
  customer: { existingId: string } | { name: string; phone: string };
  model: string;
  plate: string;
  /** what the odometer reads right now; stored as a reading dated case.today */
  km: number;
  items: IntakeItem[];
}

/** Turns a catalogue pick into the columns a ServiceItem row needs. */
function itemColumns(pick: IntakeItem) {
  const entry = CATALOGUE_BY_NAME.get(pick.name);
  if (!entry) throw new BadWrite(`"${pick.name}" is not a service we fit`);
  if (entry.rule === "fixed_date" && !pick.dueDate)
    throw new BadWrite(`${pick.name} needs the expiry date from the paper`);
  if (entry.rule !== "fixed_date" && pick.dueDate)
    throw new BadWrite(
      `${pick.name} is ${entry.rule.replace("_", "-")}; its due date is worked out, not entered`,
    );
  const cost = pick.cost ?? entry.cost;
  if (!Number.isFinite(cost) || cost < 0)
    throw new BadWrite(`${pick.name} needs a valid cost`);
  return {
    name: entry.name,
    rule: entry.rule,
    costBdt: cost.toFixed(2),
    dueDate: entry.rule === "fixed_date" ? (pick.dueDate as string) : null,
    everyMonths: entry.everyMonths ?? null,
    everyKm: entry.everyKm ?? null,
  };
}

/**
 * Customer, car, its first odometer reading and its service items, in one
 * transaction. All or nothing: a vehicle without a reading has no current
 * odometer and would break `currentKm()`, and one with no items fails the
 * case's own Zod contract.
 */
export async function intakeVehicle(
  caseId: string,
  input: IntakeInput,
): Promise<{ vehicleId: string; data: CaseData }> {
  const kase = await prisma.case.findUnique({ where: { id: caseId } });
  if (!kase) throw new CaseNotFound(caseId);

  const model = input.model.trim();
  const plate = input.plate.trim();
  if (!model) throw new BadWrite("The car needs a model");
  if (!plate) throw new BadWrite("The car needs a plate");
  if (!Number.isInteger(input.km) || input.km < 0)
    throw new BadWrite("The odometer reading must be a whole number of km");
  if (!input.items.length)
    throw new BadWrite("Tick at least one service the car is due for");
  if (new Set(input.items.map((i) => i.name)).size !== input.items.length)
    throw new BadWrite("The same service is listed twice");

  const columns = input.items.map(itemColumns);

  const clash = await prisma.vehicle.findUnique({
    where: { caseId_plate: { caseId, plate } },
    select: { id: true },
  });
  if (clash)
    throw new BadWrite(`${plate} is already on the books as ${clash.id}`);

  const vehicleId = await prisma.$transaction(async (tx) => {
    let ownerId: string;
    if ("existingId" in input.customer) {
      const owner = await tx.owner.findUnique({
        where: { caseId_id: { caseId, id: input.customer.existingId } },
        select: { id: true },
      });
      if (!owner)
        throw new BadWrite(`No customer ${input.customer.existingId}`);
      ownerId = owner.id;
    } else {
      const name = input.customer.name.trim();
      const phone = input.customer.phone.trim();
      if (!name) throw new BadWrite("The customer needs a name");
      if (!/^\d{11}$/.test(phone))
        throw new BadWrite("Phone should be 11 digits, like 01711223344");
      ownerId = await nextId(tx, caseId, "owner");
      await tx.owner.create({ data: { caseId, id: ownerId, name, phone } });
    }

    const id = await nextId(tx, caseId, "vehicle");
    await tx.vehicle.create({
      data: { caseId, id, ownerId, model, plate },
    });
    // dated the case's own today, never the clock
    await tx.odometerReading.create({
      data: { caseId, vehicleId: id, date: kase.today, km: input.km },
    });
    await tx.serviceItem.createMany({
      data: columns.map((c) => ({ caseId, vehicleId: id, ...c })),
    });
    return id;
  });

  // the id is returned beside the case, never folded into it: CaseData stays
  // byte-identical to the published shape
  return { vehicleId, data: await loadCase(caseId) };
}

/** One more service onto a car already on the books. */
export async function addServiceItem(
  caseId: string,
  vehicleId: string,
  pick: IntakeItem,
): Promise<CaseData> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { caseId_id: { caseId, id: vehicleId } },
    select: { id: true },
  });
  if (!vehicle) throw new BadWrite(`No vehicle ${vehicleId} in ${caseId}`);

  const columns = itemColumns(pick);
  const exists = await prisma.serviceItem.findUnique({
    where: {
      caseId_vehicleId_name: { caseId, vehicleId, name: columns.name },
    },
    select: { id: true },
  });
  if (exists) throw new BadWrite(`${columns.name} is already on this vehicle`);

  await prisma.serviceItem.create({
    data: { caseId, vehicleId, ...columns },
  });
  return loadCase(caseId);
}
