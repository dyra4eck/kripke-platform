#!/usr/bin/env bash
#
# validate -> convert -> model-check, for one model.
#
#   run_pipeline.sh MODEL.json [OUTDIR]
#
# With MODEL.smv next to the input it also diffs against that golden file.
# With MODEL.expected next to the input it also diffs the verification verdicts.
#
set -euo pipefail

SCHEMA="${KRIPKE_SCHEMA:-$(dirname "$0")/../schemas/kripke.schema.json}"
CMDS="${NUXMV_CMD:-$(dirname "$0")/verify.cmd}"
MODEL_CHECKER="${MODEL_CHECKER:-nuXmv}"
TIMEOUT="${PIPELINE_TIMEOUT:-120}"

input="${1:?usage: run_pipeline.sh MODEL.json [OUTDIR]}"
outdir="${2:-out/$(basename "${input%.json}")}"
base="$(basename "${input%.json}")"
mkdir -p "$outdir"

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

step "1/4 validate $input"
python3 "$(dirname "$0")/validate_model.py" "$input" --schema "$SCHEMA"

step "2/4 convert"
kripke_generator "$input" "$outdir/$base.smv"

golden="$(dirname "$input")/$base.smv"
if [[ -f "$golden" ]]; then
  step "3/4 golden diff"
  if diff -u "$golden" "$outdir/$base.smv"; then
    echo "matches $golden"
  else
    echo "generated SMV differs from the committed golden file" >&2
    exit 1
  fi
else
  step "3/4 golden diff -- skipped, no $golden"
fi

step "4/4 model check with $MODEL_CHECKER"
# The model checker parses attacker-controlled input, so it runs with a hard
# wall-clock cap. State explosion is a when, not an if.
set +e
timeout --signal=KILL "$TIMEOUT" \
  "$MODEL_CHECKER" -source "$CMDS" "$outdir/$base.smv" \
  > "$outdir/$base.out" 2>&1
rc=$?
set -e

cat "$outdir/$base.out"

if [[ $rc -eq 137 ]]; then
  echo "TIMEOUT after ${TIMEOUT}s" >&2
  exit 124
elif [[ $rc -ne 0 ]]; then
  echo "$MODEL_CHECKER exited with $rc" >&2
  exit "$rc"
fi

grep -E '^-- specification' "$outdir/$base.out" > "$outdir/$base.verdicts" || true

expected="$(dirname "$input")/$base.expected"
if [[ -f "$expected" ]]; then
  step "verdict diff"
  diff -u "$expected" "$outdir/$base.verdicts"
  echo "verdicts match $expected"
else
  echo
  echo "no $expected -- recording current verdicts as a starting point:"
  cat "$outdir/$base.verdicts"
fi
