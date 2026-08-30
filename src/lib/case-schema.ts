import { z } from "zod";

/**
 * The published case JSON, exactly as it arrives. This is the trust boundary:
 * `POST /api/run` is fed arbitrary JSON by the judge, and `GET /api/case`
 * assembles the same shape out of Postgres — both parse through here, so the
 * engine downstream can assume the invariants instead of defending against
 * every field.
 *
 * Types are inferred from these schemas; engine.ts imports them rather than
 * declaring a second, looser copy.
 */

const isoDate = z.iso.date(); // "2026-08-30"
const bdt = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "cost_bdt must be a decimal string");

export const OwnerSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
});

export const OdoReadingSchema = z.object({
  date: isoDate,
  km: z.number().int().nonnegative(),
});

export const ServiceItemSchema = z.discriminatedUnion("rule", [
  z.object({
    name: z.string().min(1),
    rule: z.literal("fixed_date"),
    due_date: isoDate,
    cost_bdt: bdt,
  }),
  z.object({
    name: z.string().min(1),
    rule: z.literal("period_months"),
    every_months: z.number().int().positive(),
    cost_bdt: bdt,
  }),
  z.object({
    name: z.string().min(1),
    rule: z.literal("distance_km"),
    every_km: z.number().int().positive(),
    cost_bdt: bdt,
  }),
]);

export const HistoryEntrySchema = z.object({
  item: z.string().min(1),
  date: isoDate,
  km: z.number().int().nonnegative().nullable(),
  cost_bdt: bdt,
});

export const VehicleSchema = z
  .object({
    id: z.string().min(1),
    owner_id: z.string().min(1),
    model: z.string().min(1),
    plate: z.string().min(1),
    // kmPerDay() and currentKm() read .at(-1); an empty list has no current odometer.
    odometer_readings: z.array(OdoReadingSchema).min(1),
    service_items: z.array(ServiceItemSchema).min(1),
    service_history: z.array(HistoryEntrySchema),
  })
  // recordService() and lastDone() look items up by name.
  .refine(
    (v) =>
      new Set(v.service_items.map((i) => i.name)).size ===
      v.service_items.length,
    {
      message: "service item names must be unique within a vehicle",
      path: ["service_items"],
    },
  )
  .refine(
    (v) => {
      const names = new Set(v.service_items.map((i) => i.name));
      return v.service_history.every((h) => names.has(h.item));
    },
    {
      message: "service_history references an unknown item",
      path: ["service_history"],
    },
  );

export const CaseSchema = z
  .object({
    case_id: z.string().min(1),
    today: isoDate,
    owners: z.array(OwnerSchema).min(1),
    vehicles: z.array(VehicleSchema).min(1),
  })
  .refine(
    (c) => {
      const owners = new Set(c.owners.map((o) => o.id));
      return c.vehicles.every((v) => owners.has(v.owner_id));
    },
    { message: "vehicle.owner_id has no matching owner", path: ["vehicles"] },
  );

export type Owner = z.infer<typeof OwnerSchema>;
export type OdoReading = z.infer<typeof OdoReadingSchema>;
export type ServiceItem = z.infer<typeof ServiceItemSchema>;
export type Rule = ServiceItem["rule"];
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type Vehicle = z.infer<typeof VehicleSchema>;
export type CaseData = z.infer<typeof CaseSchema>;
