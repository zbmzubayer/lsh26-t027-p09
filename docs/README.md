# Documentation

Module-by-module documentation for the **Workshop Due Book** (Vehicle Service Due
Predictor, LSH26 team T027, problem P09).

Start with [architecture.md](architecture.md) — it explains the layering and the
four invariants everything else depends on. The rest can be read in any order.

| Document                                       | Covers                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| [architecture.md](architecture.md)             | Layers, request flow, the invariants, why the engine is pure          |
| [domain-engine.md](domain-engine.md)           | `src/lib/engine.ts` — due rules, statuses, km/day, ranking, mutations |
| [data-model.md](data-model.md)                 | Prisma schema, `case-db.ts`, `case-schema.ts`, the service catalogue  |
| [api-reference.md](api-reference.md)           | Every HTTP route and Server Action, with request/response shapes      |
| [auth.md](auth.md)                             | Sessions, password hashing, route gating, per-workshop scoping        |
| [ui.md](ui.md)                                 | The dashboard: view model, components, state and data flow            |
| [ml-visit-predictor.md](ml-visit-predictor.md) | `ml/` — the visit-gap model, the service, the offline fallback        |
| [verification.md](verification.md)             | `engine-check`, `visit-check`, the CLI runner, lint and build         |
| [operations.md](operations.md)                 | Environment, scripts, runbooks, deployment, known limitations         |
| [glossary.md](glossary.md)                     | Case, item, visit, drift, and the other words used throughout         |

## Reading the code in one pass

```
src/lib/engine.ts          the domain — pure, no I/O, no clock
src/lib/case-schema.ts     the trust boundary — Zod, one shape in and out
src/lib/case-db.ts         Postgres <-> that shape
src/lib/due-book-view.ts   counting/grouping for the screens
src/lib/visit.ts           the behavioural half — when the customer turns up
src/app/api/*/route.ts     seven routes, all thin
src/components/due-book/   the dashboard
ml/                        the Python trainer and the prediction service
```

Nothing in `src/lib/engine.ts` imports anything with a side effect. That is the
single most useful fact about this codebase.
