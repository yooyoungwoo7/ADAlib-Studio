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

    def _call(provider, model, key, messages):
        calls.append({"provider": provider, "model": model, "key": key, "messages": messages})
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
    assert r.status_code == 422 and "valid system" in r.json()["detail"]["message"]
