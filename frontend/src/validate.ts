import Ajv2020, { type ErrorObject } from "ajv/dist/2020";

import schema from "../../schemas/kripke.schema.json";
import type { KripkeModel } from "./types/kripke";

/**
 * The editor validates against the very same schema the backend uses, so a
 * model accepted here is accepted there. Only the checks the schema cannot
 * express -- totality, reachability, referential integrity -- are written
 * out below, mirroring scripts/validate_model.py.
 */
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

/** Taken from the schema rather than restated, so the two cannot drift. */
export const IDENTIFIER = new RegExp(schema.$defs.identifier.pattern);

/** Reserved in the generated SMV or in the nuXmv grammar itself. */
const RESERVED = new Set([
  "state_", "MODULE", "VAR", "IVAR", "FROZENVAR", "DEFINE", "ASSIGN", "INIT",
  "TRANS", "INVAR", "SPEC", "CTLSPEC", "LTLSPEC", "INVARSPEC", "PSLSPEC",
  "COMPUTE", "FAIRNESS", "JUSTICE", "COMPASSION", "CONSTANTS", "ISA", "case",
  "esac", "init", "next", "self", "boolean", "array", "of", "mod", "union",
  "in", "TRUE", "FALSE", "process", "main",
]);

const where = (error: ErrorObject) =>
  error.instancePath.replace(/^\//, "").replace(/\//g, " → ") || "модель";

export function schemaErrors(value: unknown): string[] {
  if (validateSchema(value)) return [];
  return (validateSchema.errors ?? []).map(
    (e) => `${where(e)}: ${e.message ?? "не соответствует схеме"}`,
  );
}

/** States with no outgoing transition: the relation is not total there. */
export function deadEnds(model: KripkeModel): string[] {
  const withOutgoing = new Set(model.transitions.map(([from]) => from));
  return model.states.filter((s) => !withOutgoing.has(s));
}

/** States no path from an initial state reaches. */
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

/** Everything the schema cannot say. Assumes the shape is already valid. */
export function semanticErrors(model: KripkeModel): string[] {
  const errors: string[] = [];
  const known = new Set<string>(model.states);

  for (const s of model.initial_states) {
    if (!known.has(s)) errors.push(`начальное состояние ${s} не объявлено`);
  }
  model.transitions.forEach(([from, to], i) => {
    if (!known.has(from)) errors.push(`переход ${i + 1}: нет состояния ${from}`);
    if (!known.has(to)) errors.push(`переход ${i + 1}: нет состояния ${to}`);
  });

  const labelled = new Set<string>();
  const predicates = new Set<string>();
  for (const entry of model.state_predicates) {
    if (!known.has(entry.state)) {
      errors.push(`предикаты для несуществующего состояния ${entry.state}`);
    }
    if (labelled.has(entry.state)) {
      errors.push(`состояние ${entry.state} описано дважды`);
    }
    labelled.add(entry.state);
    for (const p of entry.predicates) predicates.add(p);
  }

  const unlabelled = model.states.filter((s) => !labelled.has(s));
  if (unlabelled.length) {
    errors.push(`без записи о предикатах: ${unlabelled.join(", ")}`);
  }

  const clash = [...predicates].filter((p) => known.has(p));
  if (clash.length) {
    errors.push(`имя занято и состоянием, и предикатом: ${clash.join(", ")}`);
  }

  for (const name of [...known, ...predicates]) {
    if (RESERVED.has(name)) errors.push(`${name} — зарезервированное имя SMV`);
  }

  const dead = deadEnds(model);
  if (dead.length) {
    errors.push(`без исходящих переходов: ${dead.join(", ")}`);
  }
  const orphans = unreachable(model);
  if (orphans.length) {
    errors.push(`недостижимы из начального состояния: ${orphans.join(", ")}`);
  }

  return errors;
}

/** Everything wrong with a candidate model, schema first. */
export function validateModel(value: unknown): string[] {
  const shape = schemaErrors(value);
  return shape.length ? shape : semanticErrors(value as KripkeModel);
}
