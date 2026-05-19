/**
 * eslint-plugin-effect-locality
 *
 * ESLint rules enforcing FP discipline around effectful APIs in TypeScript
 * codebases. See README.md for the project's purpose, naming, and roadmap.
 */
import { rule as noImperativeEffectTrigger } from "./rules/no-imperative-effect-trigger.js";
import { rule as noOrphanFallibleEffect } from "./rules/no-orphan-fallible-effect.js";
import { rule as noScreenLocalPhaseState } from "./rules/no-screen-local-phase-state.js";
import { rule as preferTaggedUnionState } from "./rules/prefer-tagged-union-state.js";
import { rule as singleOwnerEffectfulSymbol } from "./rules/single-owner-effectful-symbol.js";

const meta = {
  name: "eslint-plugin-effect-locality",
  version: "0.3.0",
} as const;

const rules = {
  "no-imperative-effect-trigger": noImperativeEffectTrigger,
  "no-orphan-fallible-effect": noOrphanFallibleEffect,
  "no-screen-local-phase-state": noScreenLocalPhaseState,
  "prefer-tagged-union-state": preferTaggedUnionState,
  "single-owner-effectful-symbol": singleOwnerEffectfulSymbol,
} as const;

const plugin = {
  meta,
  rules,
};

export { plugin, rules, meta };
export default plugin;
