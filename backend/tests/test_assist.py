"""Natural-language assistant: settings, provider choice, validation and retry (LLM calls faked)."""
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import llm_assist

PENDULUM = {"reply": "Damped pendulum, gamma = 0.3 assumed.",
            "system": {"name": "pendulum", "states": [{"name": "theta", "initial": 1.0}, {"name": "omega", "initial": 0.0}],
                       "parameters": [{"name": "gamma", "value": 0.3}, {"name": "g_over_l", "value": 9.81}],
                       "equations": ["omega", "-gamma*omega - g_over_l*sin(theta)"]},
            "time": {"t0": 0, "t1": 10}}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(llm_assist, "SETTINGS_FILE", tmp_path / "settings.json")
    for info in llm_assist.PROVIDERS.values():
        monkeypatch.delenv(info["env"], raising=False)
    with TestClient(app) as c:
        yield c


def fake_llm(monkeypatch, answers):
    calls = []

    def _call(provider, model, key, messages, instructions=""):
        calls.append({"provider": provider, "model": model, "key": key, "messages": messages,
                      "instructions": instructions})
        return answers[len(calls) - 1]
    monkeypatch.setattr(llm_assist, "_call", _call)
    return calls


def test_settings_keep_key_server_side(client, tmp_path):
    st = client.get("/api/assist/status").json()
    assert st["provider"] is None and not st["providers"]["openai"]["configured"]
    st = client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-test-abcd1234",
                                                  "model": "gpt-x"}).json()
    assert st["provider"] == "openai" and st["providers"]["openai"]["key_hint"] == "…1234"
    assert st["providers"]["openai"]["model"] == "gpt-x" and "sk-test" not in json.dumps(st)
    assert json.loads((tmp_path / "settings.json").read_text())["llm"]["openai"]["api_key"] == "sk-test-abcd1234"
    st = client.put("/api/assist/settings", json={"provider": "openai", "api_key": "", "model": ""}).json()
    assert not st["providers"]["openai"]["configured"] and st["providers"]["openai"]["model"] == "gpt-5.4-mini"


def test_env_key_and_no_key(client, monkeypatch):
    r = client.post("/api/assist/forward", json={"prompt": "pendulum"})
    assert r.status_code == 400 and "key" in r.json()["detail"]["message"]
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-env-9999")
    st = client.get("/api/assist/status").json()
    assert st["provider"] == "anthropic" and st["providers"]["anthropic"]["source"] == "env"


def test_describe_retries_until_valid(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "anthropic", "api_key": "sk-ant-abcdefgh"})
    bad = {**PENDULUM, "system": {**PENDULUM["system"], "equations": ["omega", "-g*sin(theta) + t"]}}
    calls = fake_llm(monkeypatch, ["```json\n" + json.dumps(bad) + "\n```", json.dumps(PENDULUM)])
    cur = {"name": "old", "states": [{"name": "x", "initial": 1}], "parameters": [], "equations": ["-x"]}
    r = client.post("/api/assist/forward", json={"prompt": "damped pendulum for 10 s", "current_system": cur,
                                                 "history": [{"role": "user", "content": "hi"},
                                                             {"role": "assistant", "content": "hello"}]})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["attempts"] == 2 and out["provider"] == "anthropic" and out["model"] == "claude-haiku-5-5"
    assert out["system"]["equations"][1] == "-gamma*omega - g_over_l*sin(theta)" and out["time"]["t1"] == 10
    first = calls[0]["messages"]
    assert [m["role"] for m in first] == ["user", "assistant", "user"] and '"name": "old"' in first[-1]["content"]
    assert "invalid" in calls[1]["messages"][-1]["content"] and calls[0]["key"] == "sk-ant-abcdefgh"


def test_reply_language_and_broken_escapes(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    ans = {**PENDULUM, "reply": "J'ai pos\u00e9 \u0003b8' = \u0003c9."}
    calls = fake_llm(monkeypatch, [json.dumps(ans)])
    out = client.post("/api/assist/forward", json={"prompt": "hello", "language": "ko-KR"}).json()
    assert out["reply"] == "J'ai posé θ' = ω."
    assert "User interface language: ko-KR." in calls[0]["messages"][-1]["content"]


def test_images_reach_both_providers(client, monkeypatch):
    sent = []
    monkeypatch.setattr(llm_assist, "_post", lambda url, headers, body: sent.append(body) or (
        {"content": [{"type": "text", "text": json.dumps(PENDULUM)}]} if url.endswith("/v1/messages")
        else {"choices": [{"message": {"content": json.dumps(PENDULUM)}}]}))
    img = {"media_type": "image/png", "data": "iVBORw0KGgo="}
    for provider in ("anthropic", "openai"):
        client.put("/api/assist/settings", json={"provider": provider, "api_key": "sk-abcdefgh"})
        r = client.post("/api/assist/forward", json={"prompt": "", "images": [img],
                                                     "history": [{"role": "user", "content": "earlier"}]})
        assert r.status_code == 200, r.text
    ant, oai = sent
    assert ant["messages"][0] == {"role": "user", "content": "earlier"}          # history stays text
    blocks = ant["messages"][-1]["content"]
    assert blocks[0]["source"] == {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}
    assert "shown in the image" in blocks[-1]["text"]
    parts = oai["messages"][-1]["content"]
    assert parts[1]["image_url"]["url"] == "data:image/png;base64,iVBORw0KGgo=" and oai["messages"][0]["role"] == "system"
    assert client.post("/api/assist/forward", json={"prompt": " "}).status_code == 422   # nothing to do


def test_solver_options_are_merged_and_checked(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    cur = {"basis": "adaf", "n_seg": 50, "Nt_total": 2500, "epochs": 5, "use_lbfgs": True}
    bad = {**PENDULUM, "options": {"n_seg": 120}}                    # 2500 % 120 != 0
    worse = {**PENDULUM, "options": {"n_segments": 100}}             # unknown key
    good = {**PENDULUM, "options": {"n_seg": 100, "Nt_total": 5000, "use_lbfgs": False}}
    calls = fake_llm(monkeypatch, [json.dumps(bad), json.dumps(worse), json.dumps(good)])
    out = client.post("/api/assist/forward", json={"prompt": "100 segments, no L-BFGS", "current_options": cur}).json()
    o = out["options"]
    assert out["attempts"] == 3 and (o["n_seg"], o["Nt_total"], o["use_lbfgs"], o["epochs"]) == (100, 5000, False, 5)
    assert "divisible" in calls[1]["messages"][-1]["content"] and "n_segments" in calls[2]["messages"][-1]["content"]
    assert '"options": {"basis": "adaf"' in calls[0]["messages"][-1]["content"]
    fake_llm(monkeypatch, [json.dumps(PENDULUM)])                   # no "options": all kept
    out = client.post("/api/assist/forward", json={"prompt": "x", "current_options": cur}).json()
    assert out["options"]["n_seg"] == 50 and out["options"]["Nt_total"] == 2500


def test_plot_style_only_request_keeps_the_system(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    cur = PENDULUM["system"]
    style0 = {"line_width": 1.5, "colors": {"omega": "blue"}, "export_dpi": 300}
    bad = {"reply": "x", "plot_style": {"colors": {"x": "red"}}}                       # no state x
    worse = {"reply": "x", "plot_style": {"colours": {"theta": "red"}}}               # unknown key
    good = {"reply": "θ is red now", "plot_style": {"colors": {"theta": "#d62728"}, "line_width": 2,
                                                    "export_dpi": None, "legend_position": "top-right"}}
    calls = fake_llm(monkeypatch, [json.dumps(bad), json.dumps(worse), json.dumps(good)])
    out = client.post("/api/assist/forward", json={
        "prompt": "theta in red", "current_system": cur, "current_time": {"t0": 0, "t1": 7},
        "current_plot_style": style0}).json()
    assert out["attempts"] == 3 and out["system"]["name"] == "pendulum" and out["time"]["t1"] == 7
    assert out["plot_style"] == {"line_width": 2, "colors": {"omega": "blue", "theta": "#d62728"},
                                 "legend_position": "top-right"}                      # export_dpi reset
    assert "unknown state" in calls[1]["messages"][-1]["content"] and "colours" in calls[2]["messages"][-1]["content"]
    assert '"export_dpi": 300' in calls[0]["messages"][-1]["content"]
    fake_llm(monkeypatch, [json.dumps({"reply": "x", "plot_style": {"colors": {"theta": "nope!"}}})] * 3)
    r = client.post("/api/assist/forward", json={"prompt": "x", "current_system": cur})
    assert r.status_code == 422


def test_describe_gives_up(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    fake_llm(monkeypatch, ["not json"] * llm_assist.MAX_ATTEMPTS)
    r = client.post("/api/assist/forward", json={"prompt": "something"})
    assert r.status_code == 422 and "valid setup" in r.json()["detail"]["message"]


# ── Operator / Inverse / MPC ─────────────────────────────────────────────

TANK = {"name": "tank", "states": [{"name": "h", "initial": 1.0, "lower": 0.0, "upper": 3.0}],
        "parameters": [{"name": "a", "value": 0.5}],
        "controls": [{"name": "q", "value": 0.2, "lower": 0.0, "upper": 1.0}],
        "equations": ["q - a*sqrt(h)"]}


def test_operator_setup(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    cur = {"source": "custom", "builtin": "triple_tank", "system": {**PENDULUM["system"], "controls": []},
           "n_seg": 25, "t_final": 5.0, "options": {"epochs": 1000, "n_train": 2000, "n_val": 200}}
    no_range = {"reply": "x", "system": {**TANK, "states": [{"name": "h", "initial": 1.0}]}}
    good = {"reply": "Tank set up.", "system": TANK, "t_final": 10, "options": {"epochs": 3000}}
    calls = fake_llm(monkeypatch, [json.dumps(no_range), json.dumps(good)])
    r = client.post("/api/assist/operator", json={"prompt": "single tank with inflow q", "state": cur})
    assert r.status_code == 200, r.text
    out = r.json()
    st = out["state"]
    assert out["attempts"] == 2 and "training range" in calls[1]["messages"][-1]["content"]
    assert st["system"]["controls"][0]["name"] == "q" and st["t_final"] == 10 and st["n_seg"] == 25
    assert st["options"]["epochs"] == 3000 and st["options"]["n_train"] == 2000
    assert "Operator Learning module" in calls[0]["instructions"] and '"n_seg": 25' in calls[0]["messages"][-1]["content"]
    fake_llm(monkeypatch, [json.dumps({"reply": "x", "source": "builtin", "builtin": "cstr"})])
    st = client.post("/api/assist/operator", json={"prompt": "use the CSTR", "state": cur}).json()["state"]
    assert (st["source"], st["builtin"]) == ("builtin", "cstr")


def test_inverse_setup(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "anthropic", "api_key": "sk-ant-abcdefgh"})
    cur = {"system": PENDULUM["system"], "time": {"t0": 0, "t1": 10},
           "unknowns": {"gamma": {"estimate": True, "initial": 0.1, "lower": 0, "upper": None}},
           "data_source": "synthetic", "synthetic": {"n_points": 100, "noise_pct": 1, "seed": 42, "observed": []},
           "compare_to_values": False, "options": {"epochs": 5}, "uploaded_file": None}
    none_estimated = {"reply": "x", "unknowns": {"gamma": {"estimate": False}}}
    bad_bounds = {"reply": "x", "unknowns": {"g_over_l": {"estimate": True, "initial": 5, "upper": 4}}}
    good = {"reply": "Both estimated.", "unknowns": {"g_over_l": {"estimate": True, "initial": 5, "lower": 0}},
            "synthetic": {"noise_pct": 5, "observed": ["theta"]}, "options": {"epochs": 20}}
    calls = fake_llm(monkeypatch, [json.dumps(none_estimated), json.dumps(bad_bounds), json.dumps(good)])
    r = client.post("/api/assist/inverse", json={"prompt": "also estimate g/l, 5% noise, only theta measured",
                                                 "state": cur})
    assert r.status_code == 200, r.text
    st = r.json()["state"]
    assert "at least one" in calls[1]["messages"][-1]["content"] and "upper" in calls[2]["messages"][-1]["content"]
    assert st["unknowns"]["gamma"]["estimate"] and st["unknowns"]["g_over_l"] == {
        "estimate": True, "initial": 5, "lower": 0, "upper": None}
    assert st["synthetic"] == {"n_points": 100, "noise_pct": 5, "seed": 42, "observed": ["theta"]}
    assert st["options"]["epochs"] == 20 and st["options"]["lambda_data"] == 10.0
    # a new system: unknowns restart from its parameters; no file means synthetic data
    tank = {**TANK, "controls": [], "equations": ["-a*sqrt(h)"]}
    calls = fake_llm(monkeypatch, [json.dumps({"reply": "x", "system": {**TANK}}),
                                   json.dumps({"reply": "x", "system": tank, "data_source": "upload",
                                               "unknowns": {"a": {"estimate": True, "initial": 1.0, "lower": 0}}}),
                                   json.dumps({"reply": "x", "system": tank,
                                               "unknowns": {"a": {"estimate": True, "initial": 1.0, "lower": 0}}})])
    r = client.post("/api/assist/inverse", json={"prompt": "draining tank", "state": cur})
    assert r.status_code == 200, r.text
    assert "control" in calls[1]["messages"][-1]["content"] and "synthetic" in calls[2]["messages"][-1]["content"]
    st = r.json()["state"]
    assert list(st["unknowns"]) == ["a"] and st["data_source"] == "synthetic" and st["synthetic"]["observed"] == []


def test_mpc_setup(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    cur = {"source": "custom", "builtin": "cstr", "system": TANK, "dt": 0.1, "targets": {"h": 1.5},
           "tracking_weights": {}, "control_weights": {"q": 0.1}, "controllers": ["autodiff"],
           "options": {"n_steps": 20, "n_train": 200, "n_val": 50}}
    cem = {"reply": "x", "controllers": ["autodiff", "CEM"]}
    stale = {"reply": "x", "targets": {"x": 1}}
    good = {"reply": "Compare AD and FD over 50 steps.", "controllers": ["autodiff", "fd"],
            "options": {"n_steps": 50, "horizon": 10}, "targets": {"h": 2.0}}
    calls = fake_llm(monkeypatch, [json.dumps(cem), json.dumps(stale), json.dumps(good)])
    r = client.post("/api/assist/mpc", json={"prompt": "compare FD, 50 steps, target 2", "state": cur})
    assert r.status_code == 200, r.text
    st = r.json()["state"]
    assert "built-in only" in calls[1]["messages"][-1]["content"] and "not one of" in calls[2]["messages"][-1]["content"]
    assert st["controllers"] == ["autodiff", "fd"] and st["options"]["n_steps"] == 50 and st["options"]["horizon"] == 10
    assert st["targets"] == {"h": 2.0} and st["control_weights"] == {"q": 0.1} and st["options"]["n_train"] == 200
    # a replaced system drops targets/weights of names it no longer has, then needs a target
    new_sys = {**TANK, "states": [{"name": "z", "initial": 1, "lower": 0, "upper": 3}], "equations": ["q - a*sqrt(z)"]}
    calls = fake_llm(monkeypatch, [json.dumps({"reply": "x", "system": new_sys}),
                                   json.dumps({"reply": "x", "system": new_sys, "targets": {"z": 1}})])
    st = client.post("/api/assist/mpc", json={"prompt": "rename h to z", "state": cur}).json()["state"]
    assert "track" in calls[1]["messages"][-1]["content"] and st["targets"] == {"z": 1.0}
    assert st["control_weights"] == {"q": 0.1}
    assert client.post("/api/assist/nope", json={"prompt": "x"}).status_code == 422


def test_figure_style_is_free_plotly_and_merged(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    cur = {"source": "custom", "builtin": "triple_tank", "system": TANK, "n_seg": 25, "t_final": 5.0,
           "options": {}, "figure_style": {"*": {"layout": {"font": {"size": 12}}},
                                           "old_figure": {"layout": {"title": {"text": "kept"}}}}}
    fig = {"id": "prediction", "title": "Operator prediction per state",
           "layout": {"yaxis": {"title": {"text": "theta"}}, "yaxis2": {"title": {"text": "omega"}}},
           "traces": [{"index": 0, "name": "#1 operator", "yaxis": "y"}, {"index": 1, "name": "#1 operator", "yaxis": "y2"}]}
    unknown_fig = {"reply": "x", "figure_style": {"nope": {"layout": {"title": {"text": "x"}}}}}
    bad_selector = {"reply": "x", "figure_style": {"prediction": {"traces": {"omega": {"line": {"color": "red"}}}}}}
    good = {"reply": "Minor ticks off, legend below, omega red.", "figure_style": {
        "*": {"layout": {"yaxes": {"minor": {"ticks": ""}}, "font": None}},
        "prediction": {"layout": {"legend": {"orientation": "h", "y": -0.2, "yanchor": "top"}},
                       "traces": {"axis:y2": {"line": {"color": "red"}}},
                       "export": {"width_cm": 8, "height_cm": 6, "dpi": 600}}}}
    calls = fake_llm(monkeypatch, [json.dumps(unknown_fig), json.dumps(bad_selector), json.dumps(good)])
    r = client.post("/api/assist/operator", json={"prompt": "작은 티커 없애고 레전드 밑으로, omega 빨간색",
                                                  "state": cur, "figures": [fig],
                                                  "figure_ids": ["prediction", "compare", "loss"]})
    assert r.status_code == 200, r.text
    st = r.json()["state"]
    assert "unknown figure" in calls[1]["messages"][-1]["content"] and "bad selector" in calls[2]["messages"][-1]["content"]
    assert '"yaxis2"' in calls[0]["messages"][-1]["content"] and "Figure style" in calls[0]["instructions"]
    assert st["figure_style"] == {
        "*": {"layout": {"yaxes": {"minor": {"ticks": ""}}}},                       # font removed by null
        "old_figure": {"layout": {"title": {"text": "kept"}}},                        # untouched, still valid
        "prediction": {"layout": {"legend": {"orientation": "h", "y": -0.2, "yanchor": "top"}},
                       "traces": {"axis:y2": {"line": {"color": "red"}}},
                       "export": {"width_cm": 8, "height_cm": 6, "dpi": 600}}}
    assert st["system"]["name"] == "tank"                                             # setup unchanged
    # Forward: the same figure style next to plot_style
    fake_llm(monkeypatch, [json.dumps({"reply": "x", "figure_style": {"loss": {"layout": {"yaxis": {"type": "log"}}}},
                                       "plot_style": {"line_width": 2}})])
    out = client.post("/api/assist/forward", json={"prompt": "log loss", "current_system": PENDULUM["system"],
                                                   "figure_ids": ["trajectories", "loss"]}).json()
    assert out["figure_style"] == {"loss": {"layout": {"yaxis": {"type": "log"}}}} and out["plot_style"] == {"line_width": 2}
    fake_llm(monkeypatch, [json.dumps({"reply": "x", "figure_style": {"*": {"layout": {"title": {
        "text": "<a href='javascript:alert(1)'>x</a>"}}}}})] * 3)
    assert client.post("/api/assist/forward", json={"prompt": "x", "current_system": PENDULUM["system"]}).status_code == 422


def test_figure_style_per_problem(client, monkeypatch):
    client.put("/api/assist/settings", json={"provider": "openai", "api_key": "sk-abcdefgh"})
    cur = {"*": {"layout": {"font": {"size": 12}}},
           "@lorenz": {"trajectories": {"layout": {"title": {"text": "Lorenz attractor"}}},
                       "trajectory_panel_z": {"layout": {"title": {"text": "z only"}}}}}   # z: not a state now
    nested = {"reply": "x", "figure_style": {"@pendulum": {"@x": {}}}}
    unknown = {"reply": "x", "figure_style": {"@pendulum": {"nope": {"layout": {"title": {"text": "t"}}}}}}
    good = {"reply": "Title set for this problem.",
            "figure_style": {"@pendulum": {"trajectories": {"layout": {"title": {"text": "Damped pendulum"}}}}}}
    calls = fake_llm(monkeypatch, [json.dumps(nested), json.dumps(unknown), json.dumps(good)])
    out = client.post("/api/assist/forward", json={
        "prompt": "제목을 Damped pendulum으로", "current_system": PENDULUM["system"], "current_figure_style": cur,
        "figure_ids": ["trajectories", "trajectory_panel_theta", "trajectory_panel_omega"],
        "figure_system": "pendulum"}).json()
    assert "'@x'" in calls[1]["messages"][-1]["content"] and "unknown figure" in calls[2]["messages"][-1]["content"]
    assert '"pendulum"' in calls[0]["messages"][-1]["content"] and "@<problem name>" in calls[0]["instructions"]
    assert out["figure_style"] == {**cur, "@pendulum": {"trajectories": {"layout": {"title": {"text": "Damped pendulum"}}}}}
