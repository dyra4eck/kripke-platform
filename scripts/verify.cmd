# Batch script for nuXmv / NuSMV.
# NB: comments here use '#'. The '--' form is SMV-language syntax and is
# not understood by the command interpreter.

# Without this, nuXmv prints the error and still exits 0.
set on_failure_script_quits

# Stage 1: parse and build. Any syntax or type error dies here.
read_model
flatten_hierarchy
encode_variables
build_flat_model
build_model

# Stage 2: structural sanity of the FSM (totality, deadlock states).
# Note: the generator's `TRUE: state_;` fallback makes this pass by
# construction; totality is really enforced by validate_model.py.
check_fsm

# Stage 3: the SPEC / FAIRNESS blocks embedded in the model.
check_ctlspec
check_ltlspec

quit
