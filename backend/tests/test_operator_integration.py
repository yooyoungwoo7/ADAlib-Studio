"""
Real operator runs: train -> model manifest -> separate inference job.
Uses small training sizes so each job finishes in seconds.
"""
import time

import pytest
from fastapi.testclient import TestClient

from app.examples.catalog import EXAMPLES
from app.main import app
from app.services.job_manager import JobManager

pytestmark = pytest.mark.integration
PEND = next(e for e in EXAMPLES if e["id"] == "pendulum_torque_operator")
SMALL = {"n_train": 200, "n_val": 40, "epochs": 200, "hidden": 64, "n_layers": 2}


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as c:
        app.state.jobs = JobManager(runs_dir=tmp_path)
        yield c
        app.state.jobs.shutdown(kill_running=True)


def _wait(client, job_id, timeout=600):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = client.get(f"/api/jobs/{job_id}").json()
        if st["status"] in ("completed", "failed", "cancelled"):
            if st["status"] != "completed":
                log = client.get(f"/api/jobs/{job_id}/log").json()["text"]
                raise AssertionError((st, log[-3000:]))
            return st
        time.sleep(1)
    raise TimeoutError(job_id)


def test_custom_operator_train_then_infer(client):
    body = {"source": "custom", "system": PEND["system"], **PEND["operator"], "options": SMALL}
    r = client.post("/api/operator/train", json=body)
    assert r.status_code == 202, r.text
    model_id = r.json()["job_id"]
    _wait(client, model_id)
    res = client.get(f"/api/jobs/{model_id}/result").json()
    m = res["manifest"]
    assert m["source"] == "custom" and m["n_seg"] == 25 and m["input_names"] == ["tau"]
    assert res["history"]["source"] == "log" and len(res["history"]["phys_loss"]) >= 2
    pv = res["preview"]
    assert len(pv["t"]) == 26 and pv["reference"]["error"] is None
    assert pv["y"]["theta"][0] == pytest.approx(1.0, abs=1e-6)

    models = client.get("/api/operator/models").json()
    assert [x["model_id"] for x in models] == [model_id]

    # inference with new inputs; out-of-range torque is flagged, not refused
    r = client.post("/api/operator/infer", json={"model_id": model_id, "x0": [0.5, 1.0], "inputs": [3.0]})
    inf_id = r.json()["job_id"]
    _wait(client, inf_id)
    out = client.get(f"/api/jobs/{inf_id}/result").json()
    assert out["y"]["theta"][0] == pytest.approx(0.5, abs=1e-6)
    assert any("tau" in w for w in out["domain_warnings"])
    assert set(out["metrics"]) == {"theta", "omega"}

    bad = client.post("/api/operator/infer", json={"model_id": model_id, "x0": [0.5], "inputs": [0.0]})
    assert bad.status_code == 422


def test_builtin_triple_tank_operator(client):
    body = {"source": "builtin", "builtin": "triple_tank",
            "options": {"n_train": 30, "n_val": 6, "epochs": 20, "hidden": 32, "n_layers": 2}}
    model_id = client.post("/api/operator/train", json=body).json()["job_id"]
    _wait(client, model_id)
    res = client.get(f"/api/jobs/{model_id}/result").json()
    m = res["manifest"]
    assert m["state_names"] == ["h1", "h2", "h3"] and m["input_names"] == ["Q1", "Q2"]
    assert m["domain"]["inputs"] == [[0.0, 150.0], [0.0, 150.0]]
    assert len(res["history"]["phys_loss"]) == 20          # learner.history, one per epoch
    assert res["preview"]["reference"]["error"] is None
    r = client.post("/api/operator/infer", json={"model_id": model_id, "x0": [30, 20, 10], "inputs": [80, 40]})
    out_id = r.json()["job_id"]
    _wait(client, out_id)
    out = client.get(f"/api/jobs/{out_id}/result").json()
    assert len(out["t"]) == m["n_seg"] + 1 and out["domain_warnings"] == []
