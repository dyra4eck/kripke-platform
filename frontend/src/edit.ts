import type { KripkeModel } from "./types/kripke";
import { IDENTIFIER } from "./validate";

/**
 * Model edits, kept pure so they can be tested and undone without touching
 * the canvas. Every function returns a new model; none mutates its input.
 *
 * Validation lives in validate.ts, driven by the JSON Schema itself.
 */

export { IDENTIFIER };

export function freshStateName(model: KripkeModel): string {
  const taken = new Set(model.states);
  for (let i = 0; ; i++) {
    const name = `s${i}`;
    if (!taken.has(name)) return name;
  }
}

export function addState(model: KripkeModel, name: string): KripkeModel {
  if (model.states.includes(name)) return model;
  return {
    ...model,
    states: [...model.states, name] as KripkeModel["states"],
    // The validator requires a labelling entry for every state, so create an
    // empty one now rather than leaving the model invalid until the user
    // opens the predicate panel.
    state_predicates: [
      ...model.state_predicates,
      { state: name, predicates: [] },
    ],
  };
}

export function removeState(model: KripkeModel, name: string): KripkeModel {
  const states = model.states.filter((s) => s !== name);
  if (states.length === 0) return model; // the schema requires at least one

  const initial = model.initial_states.filter((s) => s !== name);
  return {
    ...model,
    states: states as KripkeModel["states"],
    // Fall back to the first remaining state: initial_states may not be empty.
    initial_states: (initial.length
      ? initial
      : [states[0]]) as KripkeModel["initial_states"],
    transitions: model.transitions.filter(([f, t]) => f !== name && t !== name),
    state_predicates: model.state_predicates.filter((p) => p.state !== name),
  };
}

export function renameState(
  model: KripkeModel,
  from: string,
  to: string,
): KripkeModel {
  if (from === to) return model;
  if (!IDENTIFIER.test(to) || model.states.includes(to)) return model;
  const swap = (s: string) => (s === from ? to : s);
  return {
    ...model,
    states: model.states.map(swap) as KripkeModel["states"],
    initial_states: model.initial_states.map(
      swap,
    ) as KripkeModel["initial_states"],
    transitions: model.transitions.map(
      ([f, t]) => [swap(f), swap(t)] as [string, string],
    ),
    state_predicates: model.state_predicates.map((p) => ({
      ...p,
      state: swap(p.state),
    })),
  };
}

export function addTransition(
  model: KripkeModel,
  from: string,
  to: string,
): KripkeModel {
  const exists = model.transitions.some(([f, t]) => f === from && t === to);
  if (exists) return model;
  return { ...model, transitions: [...model.transitions, [from, to]] };
}

export function removeTransition(
  model: KripkeModel,
  from: string,
  to: string,
): KripkeModel {
  return {
    ...model,
    transitions: model.transitions.filter(([f, t]) => !(f === from && t === to)),
  };
}

export function toggleInitial(model: KripkeModel, name: string): KripkeModel {
  const isInitial = model.initial_states.includes(name);
  const next = isInitial
    ? model.initial_states.filter((s) => s !== name)
    : [...model.initial_states, name];
  if (next.length === 0) return model; // at least one initial state required
  return { ...model, initial_states: next as KripkeModel["initial_states"] };
}

export function addPredicate(
  model: KripkeModel,
  state: string,
  predicate: string,
): KripkeModel {
  if (!IDENTIFIER.test(predicate)) return model;
  // A name cannot be both a state and an atomic proposition: the generated
  // SMV would declare the same identifier twice.
  if (model.states.includes(predicate)) return model;
  return {
    ...model,
    state_predicates: model.state_predicates.map((p) =>
      p.state === state && !p.predicates.includes(predicate)
        ? { ...p, predicates: [...p.predicates, predicate] }
        : p,
    ),
  };
}

export function removePredicate(
  model: KripkeModel,
  state: string,
  predicate: string,
): KripkeModel {
  return {
    ...model,
    state_predicates: model.state_predicates.map((p) =>
      p.state === state
        ? { ...p, predicates: p.predicates.filter((x) => x !== predicate) }
        : p,
    ),
  };
}

export function setSpecifications(
  model: KripkeModel,
  specifications: string[],
): KripkeModel {
  return { ...model, specifications };
}

/** Every atomic proposition used anywhere, for autocomplete. */
export function allPredicates(model: KripkeModel): string[] {
  const seen = new Set<string>();
  for (const entry of model.state_predicates) {
    for (const p of entry.predicates) seen.add(p);
  }
  return [...seen].sort();
}

export const EMPTY_MODEL: KripkeModel = {
  states: ["s0"],
  initial_states: ["s0"],
  transitions: [["s0", "s0"]],
  state_predicates: [{ state: "s0", predicates: [] }],
  specifications: [],
};
