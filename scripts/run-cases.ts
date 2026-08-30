/**
 * Answers for one or more case files, without a browser or a database.
 *
 * Accepts the three shapes a case can arrive in — a single case object, a bare
 * array of them, or a file wrapping either under `case`/`cases` — so a judge
 * can point it at whatever they have. Output comes from the same buildAnswers()
 * as POST /api/run, so the two cannot disagree.
 *
 *   npm run cases -- src/data/case-pub-01.json
 *   npm run cases -- ml/cases.json --out answers.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { buildAnswers } from "../src/lib/answers";
import { CaseSchema } from "../src/lib/case-schema";
import type { CaseData } from "../src/lib/engine";

/** Unwraps the accepted shapes into a flat list of unvalidated cases. */
function unwrap(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    for (const key of ["cases", "case"]) {
      if (key in o) return unwrap(o[key]);
    }
  }
  return [raw];
}

function main(argv: string[]) {
  const outAt = argv.indexOf("--out");
  const out = outAt === -1 ? null : argv[outAt + 1];
  // outAt is -1 when --out is absent, and -1 + 1 === 0 would eat the first file
  const files = argv.filter(
    (a, i) => !a.startsWith("--") && !(outAt !== -1 && i === outAt + 1),
  );
  if (!files.length) {
    console.error(
      "usage: npm run cases -- <case.json> [more.json…] [--out answers.json]",
    );
    process.exit(2);
  }

  const answers = [];
  for (const file of files) {
    for (const [i, candidate] of unwrap(
      JSON.parse(readFileSync(file, "utf8")),
    ).entries()) {
      const parsed = CaseSchema.safeParse(candidate);
      if (!parsed.success) {
        // A bad case is worth failing on: silently skipping it would report
        // fewer answers than the judge handed us and look like a pass.
        console.error(`${file}[${i}]: ${z.prettifyError(parsed.error)}`);
        process.exit(1);
      }
      answers.push(buildAnswers(parsed.data as CaseData));
    }
  }

  const body = JSON.stringify(
    answers.length === 1 ? answers[0] : answers,
    null,
    2,
  );
  if (out) {
    writeFileSync(out, `${body}\n`);
    for (const a of answers)
      console.error(
        `${a.case_id}: ${a.vehicles.length} vehicles, ${a.call_list.length} to call`,
      );
    console.error(`-> ${out}`);
  } else {
    console.log(body);
  }
}

main(process.argv.slice(2));
