"""Tests for the parser, the runner and the HTTP layer.

The nuXmv-dependent tests are skipped when no model checker is on PATH, so
the suite still runs on a machine (or a CI job) without the private image.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from nuxmv_output import parse_output  # noqa: E402

FIXTURE = (Path(__file__).parent / "nuxmv_gbn.txt").read_text(encoding="utf-8")
GBN = json.loads((ROOT / "examples" / "K_GBN_fixed.json").read_text(encoding="utf-8"))

has_checker = shutil.which("nuXmv") or shutil.which("NuSMV")
needs_checker = pytest.mark.skipif(not has_checker, reason="no model checker on PATH")


# --------------------------------------------------------------- parser


def test_parses_every_verdict():
    r = parse_output(FIXTURE)
    assert [v.holds for v in r.verdicts] == [True, False, True]
    assert r.all_hold is False
    assert r.total is True


def test_trace_accumulates_unchanged_variables():
    """nuXmv prints only what changed; the parser must carry the rest."""
    bad = next(v for v in parse_output(FIXTURE).verdicts if not v.holds)
    assert [s.state for s in bad.trace] == ["s0", "s1", "s5", "s_done", "s_done"]
    # ACK_received is set in state 1 and never mentioned again.
    assert bad.trace[2].values["ACK_received"] is False
    assert bad.trace[2].values["window_full"] is True


def test_loop_marker_is_attached_to_the_right_state():
    bad = next(v for v in parse_output(FIXTURE).verdicts if not v.holds)
    assert [s.index for s in bad.trace if s.loop_start] == [6]


def test_satisfied_specifications_carry_no_trace():
    assert all(not v.trace for v in parse_output(FIXTURE).verdicts if v.holds)


def test_empty_output_is_not_a_crash():
    r = parse_output("")
    assert r.verdicts == [] and r.total is None


# --------------------------------------------------------------- runner


def test_deadlock_is_rejected_before_any_subprocess():
    from runner import Stage, run_pipeline

    r = run_pipeline(
        {
            "states": ["s0", "s1"],
            "initial_states": ["s0"],
            "transitions": [["s0", "s1"]],
            "state_predicates": [
                {"state": "s0", "predicates": ["p"]},
                {"state": "s1", "predicates": []},
            ],
        }
    )
    assert not r.ok and r.stage == Stage.VALIDATE
    assert "not total" in r.errors[0]


def test_smv_injection_is_rejected():
    from runner import Stage, run_pipeline

    r = run_pipeline(
        {
            "states": ["s0", "x}; MODULE evil"],
            "initial_states": ["s0"],
            "transitions": [["s0", "s0"]],
            "state_predicates": [{"state": "s0", "predicates": []}],
        }
    )
    assert not r.ok and r.stage == Stage.VALIDATE


@needs_checker
def test_full_pipeline_on_a_real_model():
    from runner import run_pipeline

    r = run_pipeline(GBN)
    assert r.ok and r.check.all_hold
    assert r.smv.startswith("MODULE main")


@needs_checker
def test_refuted_specification_is_a_result_not_an_error():
    from runner import run_pipeline

    model = dict(GBN, specifications=["AG transmitting"])
    r = run_pipeline(model)
    assert r.ok, "a false specification must not fail the pipeline"
    assert r.check.all_hold is False
    assert r.check.verdicts[0].trace, "a refuted CTL spec should come with a trace"


# ------------------------------------------------------------------ api


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from app import app

    return TestClient(app)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_invalid_model_returns_422(client):
    r = client.post("/verify", json={"states": ["s0"]})
    assert r.status_code == 422
    assert r.json()["detail"]["stage"] == "validate"


def test_oversized_model_returns_413(client):
    n = 600
    model = {
        "states": [f"s{i}" for i in range(n)],
        "initial_states": ["s0"],
        "transitions": [[f"s{i}", f"s{(i + 1) % n}"] for i in range(n)],
        "state_predicates": [{"state": f"s{i}", "predicates": []} for i in range(n)],
    }
    assert client.post("/verify", json=model).status_code == 413


@needs_checker
def test_verify_returns_verdicts(client):
    body = client.post("/verify", json=GBN).json()
    assert body["ok"] and body["check"]["all_hold"]
    assert len(body["check"]["verdicts"]) == len(GBN["specifications"])


@needs_checker
def test_verify_can_omit_the_smv(client):
    assert "smv" not in client.post("/verify?smv=false", json=GBN).json()


def test_convert_skips_model_checking(client):
    body = client.post("/convert", json=GBN).json()
    assert body["ok"] and body["stage"] == "convert"
    assert "check" not in body
    assert "MODULE main" in body["smv"]


def test_convert_raw_downloads_a_file(client):
    r = client.post("/convert.smv", json=GBN)
    assert r.status_code == 200
    assert r.text.startswith("MODULE main")
    assert "attachment" in r.headers["content-disposition"]
