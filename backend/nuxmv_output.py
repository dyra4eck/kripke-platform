"""Parse nuXmv batch output into structures the API can serialise.

nuXmv prints one verdict line per specification, optionally followed by a
counterexample trace. Traces are *incremental*: each state lists only the
variables whose value changed, so a full valuation has to be accumulated
while walking the trace.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_SPEC = re.compile(r"^-- specification (.*?)\s+is (true|false)\s*$")
_STATE = re.compile(r"^\s*-> State: (\d+)\.(\d+) <-\s*$")
_ASSIGN = re.compile(r"^\s{4,}([A-Za-z_][\w$#-]*)\s*=\s*(.+?)\s*$")
_LOOP = re.compile(r"^\s*-- Loop starts here\s*$")
_DEADLOCK = re.compile(r"is not total|deadlock state", re.IGNORECASE)


def _coerce(raw: str) -> Any:
    if raw == "TRUE":
        return True
    if raw == "FALSE":
        return False
    try:
        return int(raw)
    except ValueError:
        return raw


@dataclass
class TraceState:
    index: int
    #: Full valuation, not just the variables that changed at this step.
    values: dict[str, Any]
    #: True on the state where nuXmv reported "-- Loop starts here".
    loop_start: bool = False

    @property
    def state(self) -> Any:
        """Value of state_, i.e. the node to highlight in the editor."""
        return self.values.get("state_")


@dataclass
class Verdict:
    formula: str
    holds: bool
    trace: list[TraceState] = field(default_factory=list)


@dataclass
class CheckResult:
    verdicts: list[Verdict] = field(default_factory=list)
    #: None when check_fsm said nothing recognisable about totality.
    total: bool | None = None

    @property
    def all_hold(self) -> bool:
        return all(v.holds for v in self.verdicts)


def parse_output(text: str) -> CheckResult:
    result = CheckResult()
    current: Verdict | None = None
    values: dict[str, Any] = {}
    pending_loop = False

    for line in text.splitlines():
        if _DEADLOCK.search(line):
            result.total = "not total" not in line.lower()
            continue

        m = _SPEC.match(line)
        if m:
            current = Verdict(formula=m.group(1), holds=m.group(2) == "true")
            result.verdicts.append(current)
            # Each specification gets a fresh trace.
            values = {}
            pending_loop = False
            continue

        if current is None or current.holds:
            continue

        if _LOOP.match(line):
            pending_loop = True
            continue

        m = _STATE.match(line)
        if m:
            # Carry the accumulated valuation forward: nuXmv only prints
            # deltas after the first state.
            current.trace.append(
                TraceState(index=int(m.group(2)), values=dict(values),
                           loop_start=pending_loop)
            )
            pending_loop = False
            continue

        m = _ASSIGN.match(line)
        if m and current.trace:
            values[m.group(1)] = _coerce(m.group(2))
            current.trace[-1].values = dict(values)

    return result


def to_dict(result: CheckResult) -> dict[str, Any]:
    return {
        "total": result.total,
        "all_hold": result.all_hold,
        "verdicts": [
            {
                "formula": v.formula,
                "holds": v.holds,
                "trace": [
                    {
                        "index": s.index,
                        "state": s.state,
                        "loop_start": s.loop_start,
                        "values": s.values,
                    }
                    for s in v.trace
                ],
            }
            for v in result.verdicts
        ],
    }
