/* eslint-disable */
/**
 * Generated from schemas/kripke.schema.json -- do not edit by hand.
 * Run `npm run gen:types` after changing the schema.
 */

/**
 * SMV identifier: letter or underscore, then letters/digits/underscore/$/#/-
 */
export type Identifier = string;
/**
 * CTL/LTL formula. Deliberately restricted charset: no semicolons, braces or comment markers, so the formula cannot escape into the SMV grammar.
 */
export type TemporalFormula = string;

export interface KripkeModel {
  /**
   * @minItems 1
   */
  states: [Identifier, ...Identifier[]];
  /**
   * @minItems 1
   */
  initial_states: [Identifier, ...Identifier[]];
  transitions: [Identifier, Identifier][];
  state_predicates: {
    state: Identifier;
    predicates: Identifier[];
    comment?: string;
  }[];
  specifications?: TemporalFormula[];
  fairness?: TemporalFormula[];
  metadata?: {};
}
