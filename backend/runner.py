"""Run the verification pipeline for a single model.

Deliberately free of any web framework: the HTTP layer calls run_pipeline()
and serialises the result. Swapping this implementation for one that spawns
a container per request (docker socket) or enqueues a job means replacing
this module, not the handlers.

Isolation here is process-level rather than container-level:
  * a fresh temporary directory per request, removed afterwards
  * RLIMIT_AS and RLIMIT_CPU on every child
  * a wall-clock timeout, because RLIMIT_CPU does not cover a sleeping child
  * no shell anywhere; argument lists only
"""

from __future__ import annotations

import json
import os
import resource
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from nuxmv_output import CheckResult, parse_output, to_dict

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(os.environ.get("KRIPKE_SCRIPTS", ROOT / "scripts"))
SCHEMA = Path(os.environ.get("KRIPKE_SCHEMA", ROOT / "schemas" / "kripke.schema.json"))
VERIFY_CMD = Path(os.environ.get("NUXMV_CMD", SCRIPTS / "verify.cmd"))
CONVERTER = os.environ.get("CONVERTER_BIN", "kripke_generator")
MODEL_CHECKER = os.environ.get("MODEL_CHECKER", "nuXmv")

TIMEOUT_S = int(os.environ.get("PIPELINE_TIMEOUT", "60"))
MEMORY_MB = int(os.environ.get("PIPELINE_MEMORY_MB", "1024"))

sys.path.insert(0, str(SCRIPTS))
import validate_model  # noqa: E402  (path set above)

from jsonschema import Draft202012Validator  # noqa: E402

_validator = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")))


class Stage:
    VALIDATE = "validate"
    CONVERT = "convert"
    CHECK = "check"


@dataclass
class PipelineResult:
    ok: bool
    stage: str
    errors: list[str] = field(default_factory=list)
    smv: str | None = None
    check: CheckResult | None = None
    duration_s: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "ok": self.ok,
            "stage": self.stage,
            "errors": self.errors,
            "duration_s": round(self.duration_s, 3),
        }
        if self.smv is not None:
            payload["smv"] = self.smv
        if self.check is not None:
            payload["check"] = to_dict(self.check)
        return payload


def _limits() -> None:
    """Applied in the child between fork and exec."""
    resource.setrlimit(resource.RLIMIT_AS, (MEMORY_MB << 20,) * 2)
    # A little above the wall clock, so the timeout is what normally fires
    # and the CPU cap only catches a busy loop that ignores SIGTERM.
    resource.setrlimit(resource.RLIMIT_CPU, (TIMEOUT_S + 5,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (256, 256))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def _run(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=TIMEOUT_S,
        preexec_fn=_limits,  # noqa: PLW1509 (single-threaded child setup)
        check=False,
        env={"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")},
    )


def validate(model: dict) -> list[str]:
    """Schema errors first; semantic checks only once the shape is right."""
    errors = [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in _validator.iter_errors(model)
    ]
    return errors or validate_model.check(model)


def run_pipeline(
    model: dict, *, want_smv: bool = True, check: bool = True
) -> PipelineResult:
    started = time.monotonic()
    elapsed = lambda: time.monotonic() - started  # noqa: E731

    errors = validate(model)
    if errors:
        return PipelineResult(False, Stage.VALIDATE, errors, duration_s=elapsed())

    workdir = Path(tempfile.mkdtemp(prefix="kripke-"))
    try:
        (workdir / "model.json").write_text(
            json.dumps(model, ensure_ascii=False), encoding="utf-8"
        )

        try:
            conv = _run([CONVERTER, "model.json", "model.smv"], workdir)
        except subprocess.TimeoutExpired:
            return PipelineResult(
                False, Stage.CONVERT, ["converter timed out"], duration_s=elapsed()
            )
        if conv.returncode != 0:
            return PipelineResult(
                False,
                Stage.CONVERT,
                [(conv.stderr or conv.stdout).strip() or f"exit {conv.returncode}"],
                duration_s=elapsed(),
            )

        smv = (workdir / "model.smv").read_text(encoding="utf-8")

        if not check:
            return PipelineResult(
                True, Stage.CONVERT, smv=smv, duration_s=elapsed()
            )

        try:
            chk = _run(
                [MODEL_CHECKER, "-source", str(VERIFY_CMD), "model.smv"], workdir
            )
        except subprocess.TimeoutExpired:
            return PipelineResult(
                False,
                Stage.CHECK,
                [f"model checking exceeded {TIMEOUT_S}s"],
                smv=smv if want_smv else None,
                duration_s=elapsed(),
            )

        parsed = parse_output(chk.stdout)
        if chk.returncode != 0 and not parsed.verdicts:
            return PipelineResult(
                False,
                Stage.CHECK,
                [(chk.stderr or chk.stdout).strip()[:2000] or f"exit {chk.returncode}"],
                smv=smv if want_smv else None,
                duration_s=elapsed(),
            )

        # A refuted specification is a successful run with a useful answer,
        # not a pipeline failure. ok reflects the pipeline, not the verdicts.
        return PipelineResult(
            True,
            Stage.CHECK,
            smv=smv if want_smv else None,
            check=parsed,
            duration_s=elapsed(),
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
