import type { KripkeModel } from "./types/kripke";

/** Mirrors $defs/identifier in schemas/kripke.schema.json. */
export const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$#-]*$/;

/**
 * Model edits, kept pure so they can be tested and undone without touching
 * the canvas. Every function returns a new model; none mutates its input.
 */

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
    state_predicates: [...model.state_predicates, { state: name, predicates: [] }],
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
    initial_states: (initial.length ? initial : [states[0]]) as KripkeModel["initial_states"],
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
    initial_states: model.initial_states.map(swap) as KripkeModel["initial_states"],
    transitions: model.transitions.map(([f, t]) => [swap(f), swap(t)] as [string, string]),
    state_predicates: model.state_predicates.map((p) => ({ ...p, state: swap(p.state) })),
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

/** States with no outgoing transition: the relation is not total there. */
export function deadEnds(model: KripkeModel): string[] {
  const withOutgoing = new Set(model.transitions.map(([f]) => f));
  return model.states.filter((s) => !withOutgoing.has(s));
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

/**
 * States no path from an initial state reaches. Valid as a graph, but the
 * server rejects them: an unreachable state usually means a stale export or
 * a transition drawn in the wrong direction.
 */
export function unreachable(model: KripkeModel): string[] {
  const next = new Map<string, string[]>();
  for (const [from, to] of model.transitions) {
    next.set(from, [...(next.get(from) ?? []), to]);
  }
  const seen = new Set(model.initial_states);
  const queue = [...model.initial_states];
  while (queue.length) {
    for (const to of next.get(queue.pop()!) ?? []) {
      if (!seen.has(to)) {
        seen.add(to);
        queue.push(to);
      }
    }
  }
  return model.states.filter((s) => !seen.has(s));
}

export const EMPTY_MODEL: KripkeModel = {
  states: ["s0"],
  initial_states: ["s0"],
  transitions: [["s0", "s0"]],
  state_predicates: [{ state: "s0", predicates: [] }],
  specifications: [],
};
