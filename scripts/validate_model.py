#!/usr/bin/env python3
"""Validate a Kripke model JSON before it reaches the C++ converter.

Two layers:
  1. JSON Schema  -- shape and identifier safety
  2. Semantics    -- referential integrity, totality, name collisions

Exit codes: 0 ok, 1 invalid model, 2 usage/internal error.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

try:
    from jsonschema import Draft202012Validator
except ImportError:
    print("error: pip install jsonschema", file=sys.stderr)
    raise SystemExit(2)

# Reserved in the generated SMV or in the NuSMV/nuXmv grammar itself.
RESERVED = {
    "state_",
    "MODULE", "VAR", "IVAR", "FROZENVAR", "DEFINE", "ASSIGN", "INIT", "TRANS",
    "INVAR", "SPEC", "CTLSPEC", "LTLSPEC", "INVARSPEC", "PSLSPEC", "COMPUTE",
    "FAIRNESS", "JUSTICE", "COMPASSION", "CONSTANTS", "ISA", "case", "esac",
    "init", "next", "self", "boolean", "array", "of", "mod", "union", "in",
    "TRUE", "FALSE", "process", "main",
}


class Problem(Exception):
    pass


def check(model: dict) -> list[str]:
    errors: list[str] = []
    states = set(model["states"])

    if len(model["states"]) != len(states):
        errors.append("duplicate entries in 'states'")

    for s in model["initial_states"]:
        if s not in states:
            errors.append(f"initial state '{s}' is not declared in 'states'")

    # The converter only emits init(state_) := initial_states[0]; anything
    # beyond the first element is silently dropped.

    outgoing: dict[str, set[str]] = {s: set() for s in states}
    for i, (src, dst) in enumerate(model["transitions"]):
        if src not in states:
            errors.append(f"transitions[{i}]: unknown source state '{src}'")
        if dst not in states:
            errors.append(f"transitions[{i}]: unknown target state '{dst}'")
        if src in outgoing:
            outgoing[src].add(dst)

    # A Kripke structure requires a total transition relation. The converter
    # papers over violations with a `TRUE: state_;` fallback, which turns a
    # deadlock into an invisible self-loop and makes `AG EX TRUE` vacuous.
    dead = sorted(s for s, outs in outgoing.items() if not outs)
    if dead:
        errors.append(
            "transition relation is not total; states with no successor: "
            + ", ".join(dead)
        )

    predicates: set[str] = set()
    seen_states: set[str] = set()
    for i, entry in enumerate(model["state_predicates"]):
        st = entry["state"]
        if st not in states:
            errors.append(f"state_predicates[{i}]: unknown state '{st}'")
        if st in seen_states:
            errors.append(f"state_predicates[{i}]: duplicate entry for '{st}'")
        seen_states.add(st)
        predicates.update(p for p in entry["predicates"] if p)

    unlabelled = sorted(states - seen_states)
    if unlabelled:
        errors.append(
            "states with no labelling entry: " + ", ".join(unlabelled)
        )

    clash = predicates & states
    if clash:
        errors.append(
            "identifier used as both a state and a predicate: "
            + ", ".join(sorted(clash))
        )

    for name in sorted(states | predicates):
        if name in RESERVED:
            errors.append(f"'{name}' is a reserved SMV identifier")

    # Reachability is a warning-level property, but an unreachable state
    # usually means the editor exported a stale graph.
    reachable = set(model["initial_states"]) & states
    frontier = list(reachable)
    while frontier:
        cur = frontier.pop()
        for nxt in outgoing.get(cur, ()):
            if nxt not in reachable:
                reachable.add(nxt)
                frontier.append(nxt)
    orphans = sorted(states - reachable)
    if orphans:
        errors.append("unreachable states: " + ", ".join(orphans))

    return errors


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("model", type=pathlib.Path)
    ap.add_argument(
        "--schema",
        type=pathlib.Path,
        default=pathlib.Path(__file__).resolve().parents[1]
        / "schemas"
        / "kripke.schema.json",
    )
    args = ap.parse_args()

    try:
        model = json.loads(args.model.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"{args.model}: cannot read: {exc}", file=sys.stderr)
        return 1

    try:
        schema = json.loads(args.schema.read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"{args.schema}: cannot read schema: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:                      # jsonschema.SchemaError
        print(f"{args.schema}: invalid schema: {exc}", file=sys.stderr)
        return 2

    validator = Draft202012Validator(schema)

    errors = [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in validator.iter_errors(model)
    ]
    if not errors:
        errors = check(model)

    if errors:
        print(f"{args.model}: INVALID", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"{args.model}: ok "
          f"({len(model['states'])} states, "
          f"{len(model['transitions'])} transitions, "
          f"{len(model.get('specifications', []))} specs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
