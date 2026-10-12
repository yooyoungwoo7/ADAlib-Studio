"""
Real end-to-end runs: API -> job manager -> worker process -> adalib.run_forward.
Nothing is mocked; the LV run takes ~30-60 s (TensorFlow start-up + training).
"""
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.examples.catalog import EXAMPLES
from app.main import app
from app.services.job_manager import JobManager

pytestmark = pytest.mark.integration

LV = next(e for e in EXAMPLES if e["id"] == "lotka_volterra_paper")


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
            return st
        time.sleep(1)
    raise TimeoutError(job_id)


def test_lotka_volterra_forward_end_to_end(client):
    # the example's own settings (= examples/forward/lotka_volterra_forward.py); coarser grids
    # give visibly wrong ADA-F solutions for this stiff-ish LV scaling (rel. L2 ~0.7 at n_seg=10)
    options = LV["options"]
    r = client.post("/api/forward/run", json={"system": LV["system"], "time": LV["time"], "options": options})
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    st = _wait(client, job_id)
    log = client.get(f"/api/jobs/{job_id}/log").json()["text"]
    assert st["status"] == "completed", (st, log[-3000:])

    res = client.get(f"/api/jobs/{job_id}/result").json()
    t = np.array(res["t"])
    assert t.shape == (2500,) and t[0] == 0.0 and abs(t[-1] - 1.0) < 1e-6
    for name in ("U", "R"):
        y = np.array(res["y"][name], dtype=float)
        assert y.shape == t.shape and np.all(np.isfinite(y))
    assert res["y"]["U"][0] == pytest.approx(0.5, abs=1e-6)
    assert res["y"]["R"][0] == pytest.approx(0.075, abs=1e-6)
    # ADA result is a real solution, not noise: close to the BDF reference
    assert res["reference"]["error"] is None
    # measured 4.8e-3 / 3.4e-3 with adalib 0.1.0 on this machine
    assert res["metrics"]["U"]["rel_l2"] < 2e-2 and res["metrics"]["R"]["rel_l2"] < 2e-2
    # training history comes from adalib's own log: 50 segments x (Adam + L-BFGS)
    assert len(res["history"]) == 100
    assert res["solver_meta"]["n_seg"] == 50
    assert "adalib 0.1.0: run_forward" in log

    csv = client.get(f"/api/jobs/{job_id}/files/trajectory.csv").text.splitlines()
    assert csv[0] == "t,U,R,U_reference,R_reference" and len(csv) == 2501


def test_cancel_running_job(client):
    options = {**LV["options"], "n_seg": 50, "Nt_total": 2500, "epochs": 50}
    job_id = client.post("/api/forward/run", json={"system": LV["system"], "time": LV["time"],
                                                   "options": options}).json()["job_id"]
    for _ in range(60):
        if client.get(f"/api/jobs/{job_id}").json()["status"] == "running":
            break
        time.sleep(0.5)
    time.sleep(3)
    client.post(f"/api/jobs/{job_id}/cancel")
    st = _wait(client, job_id, timeout=60)
    assert st["status"] == "cancelled"
    assert client.get(f"/api/jobs/{job_id}/result").status_code == 409


def test_running_job_survives_server_restart(tmp_path):
    """A new JobManager on the same runs dir (= restarted server) re-attaches a live worker."""
    from app.services.job_manager import JobManager

    first = JobManager(runs_dir=tmp_path)
    options = {**LV["options"], "n_seg": 10, "Nt_total": 500, "epochs": 3}
    payload = {"system": LV["system"], "time": LV["time"], "options": options, "reference": False}
    job_id = first.submit("forward", payload)["id"]
    for _ in range(60):
        if first.get(job_id)["status"] == "running":
            break
        time.sleep(0.5)
    first.shutdown()                       # server goes away; worker keeps running
    second = JobManager(runs_dir=tmp_path)
    assert second.get(job_id)["status"] == "running"
    for _ in range(240):
        st = second.get(job_id)
        if st["status"] != "running":
            break
        time.sleep(0.5)
    assert st["status"] == "completed", st
    assert second.result(job_id)["n_points"] == 500
