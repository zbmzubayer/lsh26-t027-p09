"""Predicts when each vehicle will next turn up at the workshop.

The rule engine (src/lib/engine.ts) says when an item is DUE. It cannot say
when the customer actually COMES -- that is behaviour, and it is the one thing
in these cases that genuinely varies. Everything else is a constant: km/day has
a within-vehicle sd of 0.5, and every item has exactly one cost and one
interval. So this is the only place a fitted model earns its keep.

Trains on every case in ml/cases.json (25 workshops, 1549 observed inter-visit
gaps, produced by `npm run ml:export`). Validation is leave-one-CASE-out: fit on
24 workshops, predict the one held out. That is the situation that actually
matters -- a workshop whose history the model has never seen.

Writes src/data/visit-predictions.json: a predicted gap for each calendar month,
per vehicle, per case, so the app can re-predict after a service is recorded
without running Python. Domain due-dates stay in engine.ts -- this file only
produces the behavioural half, and the TypeScript side joins the two.

Run:  npm run ml:export && npm run ml
"""

import collections
import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import LeaveOneGroupOut

ROOT = Path(__file__).resolve().parent.parent
CASES = ROOT / "ml/cases.json"
CASE = ROOT / "src/data/case-pub-01.json"  # fallback when the export has not run
OUT = ROOT / "src/data/visit-predictions.json"

# ponytail: depth 5 pays now that there are ~1500 rows. At 56 it did not --
# anything past depth 3 memorised. If the training set ever shrinks again,
# re-check against metrics["permuted_mae_days"] before trusting a deeper tree.
FOREST = dict(n_estimators=300, max_depth=5, random_state=0, n_jobs=-1)
FEATURES = ["km_per_day", "n_items", "n_distance", "n_period", "n_fixed",
            "annual_burden_bdt", "prev_gap_days", "visit_month", "cost_at_visit_bdt"]

d = lambda s: date(*map(int, s.split("-")))


def load_cases() -> list[dict]:
    """Every workshop in the database, or just the committed fixture if the
    export has not been run. Training on one case still works, only worse."""
    if CASES.exists():
        return json.loads(CASES.read_text())
    return [json.loads(CASE.read_text())]


def km_per_day(v, fallback=51.0):
    """Same span-average rule as engine.ts kmPerDay(), same fleet fallback."""
    r = sorted(v["odometer_readings"], key=lambda x: x["date"])
    days = (d(r[-1]["date"]) - d(r[0]["date"])).days if r else 0
    return (r[-1]["km"] - r[0]["km"]) / days if days > 0 else fallback


def vehicle_features(v):
    """The parts of the feature vector that do not depend on which visit."""
    items = v["service_items"]
    return dict(
        km_per_day=km_per_day(v),
        n_items=len(items),
        n_distance=sum(i["rule"] == "distance_km" for i in items),
        n_period=sum(i["rule"] == "period_months" for i in items),
        n_fixed=sum(i["rule"] == "fixed_date" for i in items),
        # yearly spend implied by the recurring items -- a proxy for how much
        # this customer is used to spending, which shapes how often they come
        annual_burden_bdt=sum(
            float(i["cost_bdt"]) / ((i.get("every_months") or 12) / 12)
            for i in items if i["rule"] == "period_months"
        ),
    )


def visits(v):
    """History collapsed to distinct visit dates -> [(date, total_cost)].

    Several items done on one day is ONE visit. Counting them separately would
    invent gaps of zero days and teach the model that customers come constantly.
    """
    by = collections.defaultdict(float)
    for h in v["service_history"]:
        by[h["date"]] += float(h["cost_bdt"])
    return sorted(by.items())


def row_at(v, base, vs, i):
    """Feature vector as of visit i, using only what was knowable then."""
    day, cost = vs[i]
    return dict(base,
                # -1 = no previous gap observed; trees split it off cleanly
                prev_gap_days=(d(vs[i][0]) - d(vs[i - 1][0])).days if i else -1,
                visit_month=d(day).month,
                cost_at_visit_bdt=cost)


def build(case):
    """One row per observed gap: features at visit i, label = days to visit i+1."""
    X, y, groups = [], [], []
    for v in case["vehicles"]:
        base = vehicle_features(v)
        vs = visits(v)
        for i in range(len(vs) - 1):
            row = row_at(v, base, vs, i)
            X.append([row[f] for f in FEATURES])
            y.append((d(vs[i + 1][0]) - d(vs[i][0])).days)
            groups.append(v["id"])
    return np.array(X, float), np.array(y, float), np.array(groups)


def build_all(cases):
    """Pooled training set, grouped by CASE so a workshop never trains itself."""
    X, y, groups = [], [], []
    for c in cases:
        Xc, yc, _ = build(c)
        if len(yc):
            X.append(Xc), y.append(yc)
            groups += [c["case_id"]] * len(yc)
    return np.vstack(X), np.concatenate(y), np.array(groups)


def evaluate(X, y, groups):
    """Leave-one-case-out, plus the same fit on shuffled labels.

    The permutation refits are the point: a model that beats the baseline on
    shuffled labels is fitting noise, and with this few features that is a real
    risk worth measuring rather than assuming away.
    """
    logo = LeaveOneGroupOut()

    def cv(labels):
        resid, base = [], []
        for tr, te in logo.split(X, labels, groups):
            m = RandomForestRegressor(**FOREST).fit(X[tr], labels[tr])
            resid.append(m.predict(X[te]) - labels[te])
            base.append(np.median(labels[tr]) - labels[te])
        return np.concatenate(resid), np.concatenate(base)

    resid, base = cv(y)
    rng = np.random.default_rng(0)
    permuted = [np.abs(cv(rng.permutation(y))[0]).mean() for _ in range(12)]
    mae = float(np.abs(resid).mean())
    return resid, {
        "n_gaps": int(len(y)),
        "n_cases": int(len(set(groups))),
        "cv": "leave-one-case-out",
        "max_depth": FOREST["max_depth"],
        "baseline_mae_days": round(float(np.abs(base).mean()), 1),
        "model_mae_days": round(mae, 1),
        "permuted_mae_days": round(float(np.mean(permuted)), 1),
        "permuted_best_mae_days": round(float(np.min(permuted)), 1),
        "permutations_beating_model": int(sum(p <= mae for p in permuted)),
    }


def grid_for(model, v):
    """Predicted gap for each of the twelve months, or None with no history.

    Only visit_month changes as the calendar moves, so precomputing all twelve
    lets the app re-predict after a recorded service with an array index -- no
    Python at request time.
    """
    vs = visits(v)
    if not vs:
        return None, None
    base = vehicle_features(v)
    last_day, last_cost = vs[-1]
    prev = (d(vs[-1][0]) - d(vs[-2][0])).days if len(vs) > 1 else -1
    rows = [[dict(base, prev_gap_days=prev, visit_month=m,
                  cost_at_visit_bdt=last_cost)[f] for f in FEATURES]
            for m in range(1, 13)]
    return last_day, [int(round(float(g))) for g in model.predict(np.array(rows, float))]


def main():
    cases = load_cases()
    X, y, groups = build_all(cases)
    resid, metrics = evaluate(X, y, groups)

    # Honest interval: quantiles of the held-out errors, not of the training fit.
    lo, hi = (round(float(np.quantile(resid, q))) for q in (0.10, 0.90))
    model = RandomForestRegressor(**FOREST).fit(X, y)

    out = {}
    for c in cases:
        per_vehicle = {}
        for v in c["vehicles"]:
            last_day, grid = grid_for(model, v)
            if grid is None:
                continue
            gap = grid[d(last_day).month - 1]
            per_vehicle[v["id"]] = {
                "last_visit": last_day,
                "gap_by_month": grid,
                "predicted_gap_days": gap,
                "predicted_visit": str(d(last_day) + timedelta(days=gap)),
            }
        out[c["case_id"]] = per_vehicle

    OUT.write_text(json.dumps({
        "source": CASES.name if CASES.exists() else CASE.name,
        "metrics": metrics,
        "interval_days": {"p10": lo, "p90": hi},
        "features": FEATURES,
        "cases": out,
    }, indent=2) + "\n")

    print(f"trained on {metrics['n_gaps']} gaps from {metrics['n_cases']} cases, "
          f"depth {metrics['max_depth']}")
    print(f"baseline (median of the training cases): MAE {metrics['baseline_mae_days']}d")
    print(f"model ({metrics['cv']}):                 MAE {metrics['model_mae_days']}d")
    print(f"shuffled labels: MAE {metrics['permuted_mae_days']}d "
          f"(best {metrics['permuted_best_mae_days']}d, "
          f"{metrics['permutations_beating_model']}/12 beat the model)")
    print(f"80% interval: {lo:+d}d to {hi:+d}d around the prediction")
    print(f"-> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    check(out, metrics, cases)


def check(out, metrics, cases):
    """One runnable check: the claim this whole file exists to make."""
    assert metrics["model_mae_days"] < metrics["baseline_mae_days"], "model lost to the baseline"
    assert metrics["permutations_beating_model"] == 0, "shuffled labels matched it -- no signal"
    assert len(out) == len(cases), "a case was dropped from the output"
    for c in cases:
        # Vehicle ids repeat across cases (V01 exists in every one), so the table
        # is keyed by case first. Getting this wrong hands one workshop another
        # workshop's prediction, silently.
        assert set(out[c["case_id"]]) <= {v["id"] for v in c["vehicles"]}
    flat = [v for per in out.values() for v in per.values()]
    assert all(len(v["gap_by_month"]) == 12 for v in flat)
    assert all(v["predicted_gap_days"] > 0 for v in flat), "predicted a visit in the past"
    print(f"self-check ok ({len(flat)} vehicles across {len(out)} cases)")


if __name__ == "__main__":
    main()
