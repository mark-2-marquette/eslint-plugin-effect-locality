/**
 * eslint-plugin-fp-discipline
 *
 * ESLint rules enforcing FP discipline around effectful APIs in TypeScript
 * codebases. See README.md for the project's purpose, naming, and roadmap.
 */
import { rule as singleOwnerEffectfulSymbol } from "./rules/single-owner-effectful-symbol.js";

const meta = {
  name: "eslint-plugin-fp-discipline",
  version: "0.1.0",
} as const;

const rules = {
  "single-owner-effectful-symbol": singleOwnerEffectfulSymbol,
} as const;

const plugin = {
  meta,
  rules,
};

export { plugin, rules, meta };
export default plugin;
