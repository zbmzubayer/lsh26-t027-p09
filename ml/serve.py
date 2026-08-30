"""FastAPI wrapper around the visit-gap model, for ngrok exposure.

Stateless by design, exactly like /api/run in the Next app: the caller posts a
vehicle, the service answers with a predicted gap. It never reads the database
and never holds workshop state, so the tunnel carries no secrets and a restart
loses nothing but a two-second refit.

It answers ONLY the behavioural half — how long until this customer comes back.
Due dates stay in src/lib/engine.ts, the single source of truth for the domain;
the Next route joins the two. Duplicating the due-date rules here would give the
workshop two answers that could disagree.

Run:
    npm run ml:serve          # uvicorn on :8010
    ngrok http 8010           # put the https URL in ML_URL, then restart next dev
"""

import json
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import return_model
from sklearn.ensemble import RandomForestRegressor

from visit_model import FOREST, OUT, build_all, d, grid_for, load_cases, visits

FALLBACK_GAP_DAYS = 84  # fleet median; mirrors FALLBACK_GAP_DAYS in src/lib/visit.ts
STATE: dict = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Refit on boot from the same training set as the bundled table, so the
    live service and the offline fallback can never disagree. ~1500 rows and
    300 shallow trees is a couple of seconds -- no model artifact to keep in
    sync, and visit-check.ts asserts the two agree."""
    cases = load_cases()
    X, y, _groups = build_all(cases)
    STATE["model"] = RandomForestRegressor(**FOREST).fit(X, y)
    STATE["meta"] = json.loads(OUT.read_text())
    STATE["n"] = len(y)
    print(f"fitted on {len(y)} gaps from {len(cases)} cases")
    yield


app = FastAPI(title="Visit predictor", version="1.0", lifespan=lifespan)

# The Next route calls this server-side, so CORS is not needed for the app
# itself. It is open because a judge poking the tunnel from a browser console
# should get an answer rather than a console error; nothing here is secret and
# nothing here writes.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["POST", "GET"], allow_headers=["*"]
)


# --- request shapes are a trust boundary: parsed, not trusted -----------------
class Reading(BaseModel):
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    km: int = Field(ge=0)


class Item(BaseModel):
    name: str
    rule: str
    due_date: str | None = None
    every_months: int | None = Field(default=None, gt=0)
    every_km: int | None = Field(default=None, gt=0)
    cost_bdt: str


class History(BaseModel):
    item: str
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    km: int | None = None
    cost_bdt: str


class VehicleIn(BaseModel):
    id: str
    owner_id: str = ""
    model: str = ""
    plate: str = ""
    odometer_readings: list[Reading] = []
    service_items: list[Item] = []
    service_history: list[History] = []


class PredictIn(BaseModel):
    today: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    vehicles: list[VehicleIn] = Field(min_length=1, max_length=500)


class Prediction(BaseModel):
    vehicle_id: str
    last_visit: str | None
    predicted_gap_days: int
    predicted_visit: str
    gap_by_month: list[int]
    basis: str
    # "will they come on their own?" — conditioned on how long they have already
    # been away, so it stays informative for the half of the fleet whose point
    # prediction has already been clamped to today.
    days_away: int | None = None
    p_return_30: float | None = None
    p_return_60: float | None = None


def predict_one(v: dict, today: str) -> Prediction:
    last_day, grid = grid_for(STATE["model"], v)
    if grid is None:
        # No history means no gap to stand on. Say so instead of guessing with
        # a model that was never shown a vehicle like this.
        return Prediction(
            vehicle_id=v["id"], last_visit=None,
            predicted_gap_days=FALLBACK_GAP_DAYS,
            predicted_visit=str(d(today) + timedelta(days=FALLBACK_GAP_DAYS)),
            gap_by_month=[FALLBACK_GAP_DAYS] * 12,
            basis="fleet median \u2014 no service history",
        )

    gap = grid[d(last_day).month - 1]
    # Right-censored: they have not come back yet, so a gap landing in the past
    # means "overdue a visit", never a date. The Next side clamps to today too.
    predicted = max(d(last_day) + timedelta(days=gap), d(today))
    away = (d(today) - d(last_day)).days
    hz = STATE["meta"].get("return_hazard")
    return Prediction(
        vehicle_id=v["id"], last_visit=last_day,
        predicted_gap_days=gap, predicted_visit=str(predicted),
        gap_by_month=grid,
        basis=f"{len(visits(v))} past visits, last {last_day}",
        days_away=away,
        p_return_30=return_model.p_return(hz["hazard"], away, 30) if hz else None,
        p_return_60=return_model.p_return(hz["hazard"], away, 60) if hz else None,
    )


@app.post("/predict")
def predict(body: PredictIn) -> dict:
    vs = [v.model_dump() for v in body.vehicles]
    return {
        "today": body.today,
        "interval_days": STATE["meta"]["interval_days"],
        "metrics": STATE["meta"]["metrics"],
        "predictions": [predict_one(v, body.today) for v in vs],
    }


@app.get("/health")
def health() -> dict:
    return {"ok": "model" in STATE, "n_gaps": STATE.get("n"),
            "metrics": STATE.get("meta", {}).get("metrics")}
