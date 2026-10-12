"""API behaviour that does not need a worker run."""
import pytest
from fastapi.testclient import TestClient

from app.examples.catalog import EXAMPLES
from app.main import app
from app.services.job_manager import JobManager
from app.services.log_parser import parse_forward_log


@pytest.fixture()
def client(tmp_path):
    with TestClient(app) as c:
        app.state.jobs = JobManager(runs_dir=tmp_path)
        yield c


def test_health(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["adalib_installed"]


def test_capabilities_reports_package_defaults(client):
    body = client.get("/api/capabilities").json()
    assert body["modules"]["forward"]["status"] == "available"
    assert body["modules"]["forward"]["option_defaults"]["Nt_total"] == 2500


@pytest.mark.parametrize("ex", EXAMPLES, ids=[e["id"] for e in EXAMPLES])
def test_examples_validate(client, ex):
    body = client.post("/api/system/validate", json=ex["system"]).json()
    assert body["ok"], body
    assert len(body["latex"]) == len(ex["system"]["states"])


def test_validate_reports_index(client):
    spec = {"states": [{"name": "x", "initial": 1}, {"name": "y", "initial": 0}],
            "parameters": [], "equations": ["y", "q*x"]}
    body = client.post("/api/system/validate", json=spec).json()
    assert not body["ok"] and body["errors"][0]["index"] == 1


def test_forward_rejects_bad_grid_and_equation(client):
    ex = EXAMPLES[0]
    bad_grid = {"system": ex["system"], "time": ex["time"], "options": {"n_seg": 7, "Nt_total": 100}}
    assert client.post("/api/forward/run", json=bad_grid).status_code == 422
    bad_eq = {"system": {**ex["system"], "equations": ["import os", "U"]}, "time": ex["time"]}
    r = client.post("/api/forward/run", json=bad_eq)
    assert r.status_code == 422 and r.json()["detail"]["index"] == 0
    bad_time = {"system": ex["system"], "time": {"t0": 1, "t1": 0}}
    assert client.post("/api/forward/run", json=bad_time).status_code == 422


def test_unknown_job(client):
    assert client.get("/api/jobs/nope").status_code == 404
    assert client.get("/api/jobs/..%5C..").status_code == 404


def test_log_parser_formats():
    log = "\n".join([
        "[seg 0/9] Adam done in 1.832s | loss=1.645e+02 | parts=['1.627e+02', '1.844e+00']",
        "[seg 0/9] L-BFGS done in 0.775s | loss=9.858e+00 | parts=['6.488e+00', '3.370e+00'] | CONVERGENCE: X",
        "[epoch 2/5] Adam done in 1.020s | loss=3.0e-01 | parts=['1.0e-01', '2.0e-01']",
        "[full] L-BFGS done in 3.100s | loss=1.0e-05 | parts=['5e-06', '5e-06'] | ABNORMAL: ",
        "unrelated line",
    ])
    recs = parse_forward_log(log)
    assert [r["unit"] for r in recs] == ["segment", "segment", "epoch", "full"]
    assert recs[0]["index"] == 0 and recs[0]["total"] == 10 and recs[0]["loss"] == 164.5
    assert recs[1]["message"] == "CONVERGENCE: X"
    assert recs[2]["index"] == 1 and recs[2]["total"] == 5
    assert recs[3]["parts"] == [5e-06, 5e-06]


def test_index_html_is_revalidated():
    from app.config import FRONTEND_DIST
    if not (FRONTEND_DIST / "index.html").is_file():
        return
    with TestClient(app) as c:
        for path in ("/", "/index.html", "/some/client/route"):
            r = c.get(path)
            assert r.status_code == 200 and r.headers["cache-control"] == "no-cache", path
