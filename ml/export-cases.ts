// Exports every case in the database to ml/cases.json, the training set for
// visit_model.py.
//
// This exists so the Python never needs DATABASE_URL. The model process sits
// behind a public ngrok tunnel; handing it database credentials to save one
// step here would be a bad trade. TypeScript owns the database, Python owns
// the model, and a JSON file is the seam.
//
// Run: npm run ml:export
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { listCases, loadCase } from "../src/lib/case-db";

async function main() {
  const cases = await listCases();
  const out = [];
  for (const c of cases) out.push(await loadCase(c.case_id));

  const path = join(__dirname, "cases.json");
  writeFileSync(path, `${JSON.stringify(out)}\n`);

  const vehicles = out.reduce((n, c) => n + c.vehicles.length, 0);
  const gaps = out.reduce(
    (n, c) =>
      n +
      c.vehicles.reduce(
        (m, v) =>
          m +
          Math.max(0, new Set(v.service_history.map((h) => h.date)).size - 1),
        0,
      ),
    0,
  );
  console.log(
    `exported ${out.length} cases, ${vehicles} vehicles, ${gaps} inter-visit gaps -> ml/cases.json`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
