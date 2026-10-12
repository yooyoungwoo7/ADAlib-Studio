"""Real adalib.run_mpc runs through the API: the surrogate is trained once
(/api/mpc/train), then closed loops reuse it (/api/mpc/run) without retraining."""
import time

import pytest
from fastapi.testclient import TestClient

from app.examples.catalog import EXAMPLES, MPC_BUILTINS
from app.main import app
from app.services.job_manager import JobManager

pytestmark = pytest.mark.integration
PEND = next(e for e in EXAMPLES if e["id"] == "pendulum_torque_mpc")
QUICK = {"n_train": 20, "n_val": 5, "epochs": 20, "hidden": 32, "n_layers": 2}
TRAIN_KEYS = ("n_train", "n_val", "epochs", "batch_size", "lr", "hidden", "n_layers", "seed",
              "lpa_n_panels", "lpa_max_order", "lpa_nt_seg")


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as c:
        app.state.jobs = JobManager(runs_dir=tmp_path)
        yield c
        app.state.jobs.shutdown(kill_running=True)


def _wait(client, job_id):
    for _ in range(900):
        st = client.get(f"/api/jobs/{job_id}").json()
        if st["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(1)
    assert st["status"] == "completed", (st, client.get(f"/api/jobs/{job_id}/log").json()["text"][-3000:])
    return client.get(f"/api/jobs/{job_id}/result").json(), st


def _post(client, path, body):
    r = client.post(path, json=body)
    assert r.status_code == 202, r.text
    return _wait(client, r.json()["job_id"])


def _log(client, job_id):
    return client.get(f"/api/jobs/{job_id}/log").json()["text"]


def test_custom_train_once_then_compare_fd_ad(client):
    m = PEND["mpc"]
    opts = {k: v for k, v in m["options"].items() if k in TRAIN_KEYS}
    trained, _ = _post(client, "/api/mpc/train", {"source": "custom", "system": PEND["system"], "dt": m["dt"],
                                                  "options": opts})
    model_id = trained["model_id"]
    assert trained["kind"] == "mpc_train" and trained["history"]["epoch"]
    assert [x["model_id"] for x in client.get("/api/mpc/models").json()] == [model_id]

    n = m["options"]["n_steps"]
    body = {"model_id": model_id, "x0": [s["initial"] for s in PEND["system"]["states"]], "targets": m["targets"],
            "tracking_weights": m["tracking_weights"], "control_weights": m["control_weights"], "n_steps": n,
            "horizon": m["options"].get("horizon"), "controllers": [{"gradient": "fd"}, {"gradient": "autodiff"}]}
    r = client.post("/api/mpc/run", json=body)
    res, st = _wait(client, r.json()["job_id"])
    log = _log(client, r.json()["job_id"])
    assert "Training LPA" not in log and log.count("Loaded LPA operator") == 2        # reused, not retrained
    assert [x["label"] for x in res["runs"]] == ["FD", "AD"]
    for run in res["runs"]:
        assert len(run["t"]) == n + 1 and len(run["u"]["tau"]) == n
        assert all(-3.0 - 1e-6 <= u <= 3.0 + 1e-6 for u in run["u"]["tau"])        # bounds respected
        assert run["x"]["theta"][-1] > 0.05                                           # moves toward 0.2
    assert res["x"] == res["runs"][0]["x"] and res["model_id"] == model_id
    assert st["progress"]["unit"] == "step" and st["progress"]["stage"].startswith("AD (2/2)")


def test_builtin_cstr_and_bioreactor(client):
    cstr = next(b for b in MPC_BUILTINS if b["id"] == "cstr")
    trained, _ = _post(client, "/api/mpc/train", {"source": "builtin", "builtin": "cstr", "options": QUICK})
    res, _ = _post(client, "/api/mpc/run", {"model_id": trained["model_id"], "x0": cstr["x0"],
                                            "targets": cstr["targets"], "n_steps": 4, "horizon": 3,
                                            "controllers": [{"gradient": "autodiff"}, {"optimizer": "CEM"}]})
    assert res["time_unit"] == "min" and [x["label"] for x in res["runs"]] == ["AD", "CEM"]
    for run in res["runs"]:
        assert len(run["x"]["T_R"]) == 5 and run["tracking"]["T_R"]["target"] == 136.0
        assert all(-8500 - 1e-3 <= q <= 1e-3 for q in run["u"]["Q_dot"])
    assert res["runs"][0]["metadata"]["opt_nfev_mean"] > 0
    bio = next(b for b in MPC_BUILTINS if b["id"] == "fedbatch_bioreactor")
    trained, _ = _post(client, "/api/mpc/train", {"source": "builtin", "builtin": "fedbatch_bioreactor",
                                                  "options": QUICK})
    res, _ = _post(client, "/api/mpc/run", {"model_id": trained["model_id"], "x0": bio["x0"], "n_steps": 3})
    assert res["mode"] == "economic" and res["economic"]["final"] >= 0 and res["tracking"] == {}


def test_one_shot_run_surrogate_is_reusable(client):
    """A pre-split one-shot job (train + loop) exposes its trained surrogate."""
    m = PEND["mpc"]
    old = {"source": "custom", "system": PEND["system"], "dt": m["dt"], "targets": m["targets"],
           "options": {**m["options"], **QUICK, "n_steps": 2}}
    st = app.state.jobs.submit("mpc", old, label="pendulum_torque (MPC)")
    _wait(client, st["id"])
    models = client.get("/api/mpc/models").json()
    assert [x["origin"] for x in models] == ["mpc_run"] and models[0]["spec"]["name"] == PEND["system"]["name"]
    res, _ = _post(client, "/api/mpc/run", {"model_id": st["id"], "x0": [0.0, 0.0], "targets": m["targets"],
                                            "n_steps": 3})
    assert len(res["runs"]) == 1 and len(res["t"]) == 4


def test_mpc_validation(client):
    bad = {"source": "custom", "system": {**PEND["system"], "controls": []}}
    assert client.post("/api/mpc/train", json=bad).status_code == 422
    assert client.post("/api/mpc/train", json={"source": "builtin"}).status_code == 422
    assert client.post("/api/mpc/run", json={"model_id": "nope", "x0": [0, 0]}).status_code == 404
    dup = {"model_id": "x", "controllers": [{"gradient": "fd"}, {"gradient": "fd"}]}
    assert client.post("/api/mpc/run", json=dup).status_code == 422
