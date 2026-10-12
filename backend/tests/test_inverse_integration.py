"""Real adalib.run_inverse runs through the API (synthetic and uploaded data)."""
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.examples.catalog import EXAMPLES
from app.main import app
from app.services.job_manager import JobManager

pytestmark = pytest.mark.integration
LV = next(e for e in EXAMPLES if e["id"] == "lotka_volterra_inverse")


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as c:
        app.state.jobs = JobManager(runs_dir=tmp_path)
        yield c
        app.state.jobs.shutdown(kill_running=True)


def _wait(client, job_id, timeout=900):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = client.get(f"/api/jobs/{job_id}").json()
        if st["status"] in ("completed", "failed", "cancelled"):
            assert st["status"] == "completed", (st, client.get(f"/api/jobs/{job_id}/log").json()["text"][-3000:])
            return st
        time.sleep(1)
    raise TimeoutError(job_id)


def _body(**over):
    inv = LV["inverse"]
    body = {"system": LV["system"], "time": LV["time"], "unknowns": inv["unknowns"], "data_source": "synthetic",
            "synthetic": inv["synthetic"], "options": inv["options"]}
    body.update(over)
    return body


def test_lotka_volterra_inverse_synthetic(client):
    r = client.post("/api/inverse/run", json=_body())
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    _wait(client, job_id)
    res = client.get(f"/api/jobs/{job_id}/result").json()
    est = res["estimated"]
    # alpha is recovered reproducibly (1.99374, identical to adalib's own example script).
    # gamma is NOT reliable with these settings in adalib 0.1.0: in one run it reached 1.126,
    # in others (including examples/inverse/lotka_volterra_inverse.py itself) the first
    # segment's L-BFGS drove it to its lower bound 0. The test checks the pipeline, not that.
    assert est["alpha"] == pytest.approx(2.0, rel=0.05)
    assert np.isfinite(est["gamma"]) and est["gamma"] >= 0.0
    rows = {p["name"]: p for p in res["parameters"]}
    assert rows["beta"]["estimated"] is False and rows["beta"]["value"] == 0.04
    assert rows["alpha"]["reference"] == 2.0 and rows["alpha"]["rel_error"] < 0.05
    assert len(res["observations"]["t"]) == 200 and set(res["fit"]) == {"prey", "predator"}
    assert res["history"]["n_steps"] > 10 and "alpha" in res["history"]["params"]
    assert res["check"]["error"] is None
    st = client.get(f"/api/jobs/{job_id}").json()
    assert st["progress"]["unit"] == "segment" and "alpha=" in st["progress"]["stage"]


def test_inverse_upload_validation_and_partial_observation(client):
    t = np.linspace(0.01, 1.0, 50)
    bad = _body(data_source="upload", upload={"t": list(t[::-1]), "columns": {"prey": [0.5] * 50}})
    r = client.post("/api/inverse/run", json=bad)
    assert r.status_code == 422 and "increasing" in r.json()["detail"]["message"]
    bad = _body(data_source="upload", upload={"t": [0.1, 2.0], "columns": {"prey": [0.5, 0.6]}})
    assert "outside" in client.post("/api/inverse/run", json=bad).json()["detail"]["message"]
    bad = _body(data_source="upload", upload={"t": [0.1, 0.2], "columns": {"rabbits": [0.5, 0.6]}})
    assert client.post("/api/inverse/run", json=bad).status_code == 422

    # a real upload: only prey observed, one missing value -> row dropped with a note
    from adalib.systems import LotkaVolterra
    sol = LotkaVolterra().simulate([0.5, 0.075], (0, 1), p=[2.0, 0.04, 1.06, 0.02], t_eval=t)
    prey = list(sol.y[0])
    prey[10] = None
    opts = {**LV["inverse"]["options"], "epochs": 2, "adam_inner": 100, "use_lbfgs": False}
    body = _body(data_source="upload", upload={"t": list(t), "columns": {"prey": prey}, "filename": "lv.csv"},
                 options=opts, reference_values={"alpha": 2.0})
    job_id = client.post("/api/inverse/run", json=body).json()["job_id"]
    _wait(client, job_id)
    res = client.get(f"/api/jobs/{job_id}/result").json()
    assert list(res["observations"]["y"]) == ["prey"] and len(res["observations"]["t"]) == 49
    assert "dropped" in res["observations"]["notes"][0]
    rows = {p["name"]: p for p in res["parameters"]}
    assert "reference" in rows["alpha"] and "reference" not in rows["gamma"]
