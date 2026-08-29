"""HTTP layer over runner.run_pipeline().

Thin by design: parse, bound, delegate, serialise. Everything interesting
lives in runner.py, so switching to per-request containers or a job queue
does not touch this file.

Status codes carry meaning:
  422  the submitted model is invalid -- the client can fix it
  500  the converter failed on a model the validator accepted -- our bug
  504  model checking exceeded the time budget
  200  the pipeline ran; check.all_hold says whether the model satisfies
       its specifications. A refuted specification is a result, not an error.
"""

from __future__ import annotations

import os
import threading
from typing import Any

from fastapi import Body, FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware

from runner import Stage, run_pipeline

MAX_STATES = int(os.environ.get("MAX_STATES", "500"))
MAX_TRANSITIONS = int(os.environ.get("MAX_TRANSITIONS", "5000"))
# nuXmv is CPU-bound, so unbounded concurrency just thrashes. Endpoints are
# sync defs, which Starlette runs in its threadpool; this caps how many of
# those threads may be inside a model check at once.
MAX_CONCURRENT = int(os.environ.get("MAX_CONCURRENT", str(os.cpu_count() or 2)))

_slots = threading.Semaphore(MAX_CONCURRENT)

app = FastAPI(
    title="Kripke platform",
    version="0.1.0",
    description="Draw a Kripke model, get it model-checked by nuXmv.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type"],
)


def _guard_size(model: Any) -> None:
    """Reject oversized models before any subprocess is spawned.

    The schema bounds individual identifiers but not how many there are, and
    state explosion is superlinear -- a browser can post a graph that would
    keep a model checker busy for hours.
    """
    if not isinstance(model, dict):
        raise HTTPException(422, detail={"errors": ["body must be a JSON object"]})
    states = model.get("states")
    transitions = model.get("transitions")
    if isinstance(states, list) and len(states) > MAX_STATES:
        raise HTTPException(
            413, detail={"errors": [f"too many states: {len(states)} > {MAX_STATES}"]}
        )
    if isinstance(transitions, list) and len(transitions) > MAX_TRANSITIONS:
        raise HTTPException(
            413,
            detail={
                "errors": [
                    f"too many transitions: {len(transitions)} > {MAX_TRANSITIONS}"
                ]
            },
        )


def _execute(model: Any, *, want_smv: bool, check: bool) -> dict[str, Any]:
    _guard_size(model)
    with _slots:
        result = run_pipeline(model, want_smv=want_smv, check=check)

    if result.ok:
        return result.to_dict()

    payload = result.to_dict()
    if result.stage == Stage.VALIDATE:
        raise HTTPException(422, detail=payload)
    if result.stage == Stage.CONVERT:
        raise HTTPException(500, detail=payload)
    if any("exceeded" in e or "timed out" in e for e in result.errors):
        raise HTTPException(504, detail=payload)
    raise HTTPException(500, detail=payload)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/convert")
def convert(model: Any = Body(...)) -> dict[str, Any]:
    """Validate and generate SMV. No model checking, so it stays fast."""
    return _execute(model, want_smv=True, check=False)


@app.post("/convert.smv")
def convert_raw(model: Any = Body(...)) -> Response:
    """Same as /convert but returns the SMV file itself, for downloading."""
    payload = _execute(model, want_smv=True, check=False)
    return Response(
        payload["smv"],
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="model.smv"'},
    )


@app.post("/verify")
def verify(model: Any = Body(...), smv: bool = True) -> dict[str, Any]:
    """Run the full pipeline: validate, convert, model-check."""
    return _execute(model, want_smv=smv, check=True)
