import type { Rule } from "@/lib/engine";

/**
 * Every service this workshop fits, with the rule, interval and price that go
 * with it. Derived from the published data: across all 25 cases these twelve
 * names are the only ones that appear, and each carries one rule, one interval
 * and one price — min(cost) equals max(cost) on all 4,188 rows.
 *
 * This is why the intake form is a picker and not a text box. `RISK_ITEMS` in
 * the engine matches on the lowercased item name, so a typed "Brake pad" or
 * "Tyre" would silently lose the 1.5x safety weighting and rank the car too
 * low, with nothing anywhere reporting an error. A closed list makes that
 * impossible. The price is editable at intake — workshop prices drift — but the
 * rule and the interval are not.
 */
export interface CatalogueEntry {
  name: string;
  rule: Rule;
  /** period_months only */
  everyMonths?: number;
  /** distance_km only */
  everyKm?: number;
  /** default price in taka */
  cost: number;
  /** engine.RISK_ITEMS: late here is a safety or legal problem, not a bigger bill */
  safety?: true;
}

export const SERVICE_CATALOGUE: CatalogueEntry[] = [
  { name: "Engine oil", rule: "period_months", everyMonths: 3, cost: 3500 },
  { name: "Air filter", rule: "period_months", everyMonths: 6, cost: 1200 },
  { name: "Coolant", rule: "period_months", everyMonths: 12, cost: 1800 },
  { name: "AC service", rule: "period_months", everyMonths: 12, cost: 4500 },
  {
    name: "Brake pads",
    rule: "distance_km",
    everyKm: 10000,
    cost: 6000,
    safety: true,
  },
  { name: "Spark plugs", rule: "distance_km", everyKm: 20000, cost: 2400 },
  {
    name: "Tyres",
    rule: "distance_km",
    everyKm: 40000,
    cost: 32000,
    safety: true,
  },
  { name: "Timing belt", rule: "distance_km", everyKm: 80000, cost: 15000 },
  {
    name: "Fitness certificate",
    rule: "fixed_date",
    cost: 2500,
    safety: true,
  },
  { name: "Insurance", rule: "fixed_date", cost: 12000, safety: true },
  { name: "Tax token", rule: "fixed_date", cost: 6500 },
  { name: "Battery warranty", rule: "fixed_date", cost: 9000 },
];

export const CATALOGUE_BY_NAME = new Map(
  SERVICE_CATALOGUE.map((e) => [e.name, e]),
);

/** The ten models already on the books, offered as a datalist at intake. */
export const KNOWN_MODELS = [
  "Honda Grace",
  "Honda Vezel",
  "Mitsubishi Pajero",
  "Nissan X-Trail",
  "Suzuki Alto",
  "Toyota Allion",
  "Toyota Axio",
  "Toyota Hiace",
  "Toyota Noah",
  "Toyota Premio",
];
