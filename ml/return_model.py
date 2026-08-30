"""
Return probability — "will this owner turn up on their own?"

The visit model predicts a *gap* from the last visit and clamps to today. For
half the book that is useless: 538 of 1,051 vehicles are already past the median
gap, so the answer is "today" and it conveys nothing.

This asks the question that survives censoring instead: given that they have
already been away E days, what is the chance they walk in within the next 30?

Discrete-time hazard on person-period rows. Every spell contributes one row per
30-day period it survived, and the last row carries the event flag. That lets
the 1,051 vehicles who have *not* come back yet count as evidence — they are the
strongest evidence there is that a long absence keeps going — where the point
model has to throw them away.

No new dependency: this is counting, not fitting. Whether features beat the bare
table is measured below rather than assumed; on this data they do not, so the
table is what ships.
"""

from __future__ import annotations

from datetime import date

BUCKET_DAYS = 30
# Spells longer than this are lumped into the last bucket; beyond ~2 years the
# risk set is too thin to estimate a rate from.
MAX_DAYS = 720
N_BUCKETS = MAX_DAYS // BUCKET_DAYS
# Below this many spells still at risk, a bucket's rate is noise, not a rate.
# Measured: the 300-330d bucket has 26 spells and reads 0.692; 360-390d has one
# spell and reads 1.000. Carried forward, that told the UI a long-absent
# customer was *certain* to walk in -- the exact opposite of what it means.
MIN_AT_RISK = 40


def _d(s: str) -> date:
    y, m, dd = map(int, s.split("-"))
    return date(y, m, dd)


def visits(v: dict) -> list[str]:
    """Distinct service dates. Several items on one date is one visit."""
    return sorted({h["date"] for h in v.get("service_history", [])})


def spells(cases: list[dict]) -> list[tuple[str, int, bool]]:
    """
    (case_id, duration_days, ended) for every inter-visit spell.

    A completed gap ended in a visit. The stretch from a vehicle's last visit to
    the case date has not ended yet — right-censored — and is kept, because
    dropping it is exactly the bias that makes a naive model think everybody
    comes back soon.
    """
    out: list[tuple[str, int, bool]] = []
    for c in cases:
        today = _d(c["today"])
        for v in c["vehicles"]:
            vs = [_d(x) for x in visits(v)]
            for a, b in zip(vs, vs[1:]):
                out.append((c["case_id"], (b - a).days, True))
            if vs:
                out.append((c["case_id"], (today - vs[-1]).days, False))
    return out


def person_periods(sp: list[tuple[str, int, bool]]):
    """One row per 30-day period a spell survived: (case_id, bucket, event)."""
    for case_id, days, ended in sp:
        last = min(days // BUCKET_DAYS, N_BUCKETS - 1)
        for k in range(last):
            yield case_id, k, 0
        yield case_id, last, 1 if ended else 0


def hazard_table(rows) -> list[float]:
    """h[k] = P(visit during bucket k | still away at the start of bucket k)."""
    at_risk = [0] * N_BUCKETS
    events = [0] * N_BUCKETS
    for _, k, e in rows:
        at_risk[k] += 1
        events[k] += e
    # A thin or empty bucket inherits the last rate measured from a risk set big
    # enough to mean something, rather than inventing a spike from three spells.
    out, carry = [], 0.0
    for k in range(N_BUCKETS):
        if at_risk[k] >= MIN_AT_RISK:
            carry = events[k] / at_risk[k]
        out.append(round(carry, 5))
    return out


def p_return(hazard: list[float], elapsed_days: int, horizon_days: int) -> float:
    """
    P(visit within `horizon_days`, given they are already `elapsed_days` away).

    Survival across the buckets the horizon covers: 1 − Π(1 − h_k). Partial
    buckets are prorated, so a 14-day horizon is not silently rounded to 30.
    """
    if horizon_days <= 0:
        return 0.0
    survive = 1.0
    start, end = elapsed_days, elapsed_days + horizon_days
    k = min(start // BUCKET_DAYS, N_BUCKETS - 1)
    pos = start
    while pos < end:
        edge = min((k + 1) * BUCKET_DAYS, end) if k < N_BUCKETS - 1 else end
        share = (edge - pos) / BUCKET_DAYS
        survive *= (1.0 - hazard[k]) ** share
        pos = edge
        k = min(k + 1, N_BUCKETS - 1)
    return round(1.0 - survive, 4)


def brier(pred: list[float], obs: list[int]) -> float:
    return round(sum((p - o) ** 2 for p, o in zip(pred, obs)) / len(pred), 5)


def evaluate(cases: list[dict]) -> dict:
    """
    Leave-one-case-out, same protocol as visit_model.py: fit the table on 24
    workshops, score the held-out one. The baseline is the flat fleet rate,
    which is what "we have no idea" looks like.
    """
    rows = list(person_periods(spells(cases)))
    ids = [c["case_id"] for c in cases]

    pred_model, pred_flat, obs = [], [], []
    for held in ids:
        train = [r for r in rows if r[0] != held]
        test = [r for r in rows if r[0] == held]
        h = hazard_table(train)
        flat = sum(r[2] for r in train) / len(train)
        for _, k, e in test:
            pred_model.append(h[k])
            pred_flat.append(flat)
            obs.append(e)

    # Calibration: within each predicted-probability decile, does the observed
    # rate match what was promised? A probability nobody checked is decoration.
    paired = sorted(zip(pred_model, obs))
    size = max(1, len(paired) // 10)
    calibration = []
    for i in range(0, len(paired), size):
        chunk = paired[i : i + size]
        if len(chunk) < size // 2:
            break
        calibration.append(
            {
                "predicted": round(sum(p for p, _ in chunk) / len(chunk), 4),
                "observed": round(sum(o for _, o in chunk) / len(chunk), 4),
                "n": len(chunk),
            }
        )

    sp = spells(cases)
    return {
        "cv": "leave-one-case-out",
        "bucket_days": BUCKET_DAYS,
        "n_person_periods": len(rows),
        "n_completed_gaps": sum(1 for s in sp if s[2]),
        "n_censored_spells": sum(1 for s in sp if not s[2]),
        "baseline_brier": brier(pred_flat, obs),
        "model_brier": brier(pred_model, obs),
        "flat_rate": round(sum(obs) / len(obs), 4),
        "calibration": calibration,
    }


def fit(cases: list[dict]) -> dict:
    """The block that goes into src/data/visit-predictions.json."""
    metrics = evaluate(cases)
    hazard = hazard_table(person_periods(spells(cases)))
    return {"bucket_days": BUCKET_DAYS, "hazard": hazard, "metrics": metrics}


def check(block: dict, cases: list[dict]) -> None:
    """One runnable check: the claim this file exists to make."""
    m = block["metrics"]
    assert m["model_brier"] < m["baseline_brier"], (
        f"hazard table lost to the flat rate "
        f"({m['model_brier']} vs {m['baseline_brier']}) -- do not ship it"
    )
    h = block["hazard"]
    assert len(h) == N_BUCKETS
    assert all(0.0 <= x < 1.0 for x in h), "a hazard of 1.0 -- certainty is never measured"
    # A long absence must not read as a certain return; that is the tail-noise
    # failure this guard exists to catch.
    assert p_return(h, 365, 30) < 0.9, "long-absent customers read as certain returns"
    # Longer horizon can never be less likely than a shorter one.
    for elapsed in (0, 60, 180, 365):
        a, b, c = (p_return(h, elapsed, n) for n in (14, 30, 60))
        assert a <= b <= c, f"non-monotonic horizons at {elapsed}d: {a} {b} {c}"
    assert m["n_censored_spells"] > 0, "censored spells were dropped"
    print(
        f"return-model check ok: brier {m['model_brier']} vs flat "
        f"{m['baseline_brier']}, {m['n_person_periods']} person-periods"
    )
