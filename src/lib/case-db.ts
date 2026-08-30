import { addMonths, format, parseISO } from "date-fns";
import type {
  CaseData,
  HistoryEntry,
  ServiceItem,
  Vehicle,
} from "@/lib/engine";
import prisma from "@/lib/prisma";

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
  if (!Number.isInteger(km) || km < 0)
    throw new BadWrite("km must be a non-negative whole number");

  const exists = await prisma.vehicle.findUnique({
    where: { caseId_id: { caseId, id: vehicleId } },
    select: { id: true },
  });
  if (!exists) throw new BadWrite(`No vehicle ${vehicleId} in ${caseId}`);

  await prisma.odometerReading.upsert({
    where: {
      caseId_vehicleId_date: { caseId, vehicleId, date: kase.today },
    },
    create: { caseId, vehicleId, date: kase.today, km },
    update: { km },
  });
  return loadCase(caseId);
}
