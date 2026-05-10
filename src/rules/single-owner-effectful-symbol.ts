/**
 * Rule: single-owner-effectful-symbol
 *
 * For a project-supplied catalogue of effectful symbols (e.g.
 * `messaging().requestPermission`, `AsyncStorage.setItem`), this rule warns
 * at every call site after the first within an ESLint run. It encodes the
 * "single owner" discipline: a resource-mediated effect should be invoked
 * from exactly one module so that ordering, idempotency, and platform
 * one-shot semantics (iOS notification permission, Linking.openSettings,
 * etc.) are concentrated and reasoned-about in one place.
 *
 * Mechanism
 * ---------
 * - Each call's callee is canonicalised to a string of the form
 *   `messaging().requestPermission` or `AsyncStorage.setItem`. The shape is
 *   inspired by react-x/purity's qualified-name matching
 *   (https://www.eslint-react.xyz/docs/rules/purity) but the implementation
 *   is independent and the catalogue is user-supplied rather than hardcoded.
 * - Cross-file aggregation lives in a process-level `Map<pattern, Set<file>>`
 *   that is populated as ESLint visits each file. The N-th file (N > maxOwners)
 *   to call a pattern is reported.
 *
 * Limitations
 * -----------
 * - ESLint's per-file model means the warning is order-dependent. Whichever
 *   file ESLint visits first becomes the owner; the others get warned.
 *   In practice this is fine: a developer running `eslint .` will see
 *   exactly the set of competing-owner files and can pick which one is
 *   canonical (and add the rest to `allowList`, or refactor).
 * - The registry persists for the lifetime of the Node process, so editor
 *   integrations that re-lint a single file will not see warnings from
 *   files outside the open buffer until a full project lint runs.
 *
 * A future enhancement is a CLI tool that performs a true project-wide
 * pass; for now, document-and-ship.
 */
import { ESLintUtils, type TSESTree } from "@typescript-eslint/utils";

export interface SymbolSpec {
  /** Qualified-name pattern, e.g. `messaging().requestPermission`. */
  pattern: string;
  /** Maximum number of files allowed to call this symbol. Defaults to 1. */
  maxOwners?: number;
  /** Absolute file paths exempt from being treated as competing owners. */
  allowList?: string[];
}

export interface RuleOptions {
  effectfulSymbols: SymbolSpec[];
}

type MessageIds = "tooManyOwners";

/**
 * Process-level registry: pattern -> ordered set of filenames that have called
 * the pattern. Insertion order is the "ownership order".
 */
const registry = new Map<string, Set<string>>();

/** Test hook: clear cross-file state between cases. */
export function resetRegistryForTests(): void {
  registry.clear();
}

/**
 * Convert a callee AST node into a canonical string like
 * `messaging().requestPermission` or `AsyncStorage.setItem`. Returns null
 * for callees that don't fit the supported shapes (e.g. dynamic property
 * access, `this.x`, computed members, `?.` chains, etc.). Intentionally
 * conservative: callees we can't canonicalise simply don't match any
 * pattern.
 */
function nodeToCanonical(node: TSESTree.Node | null | undefined): string | null {
  if (node == null) return null;
  switch (node.type) {
    case "Identifier":
      return node.name;
    case "MemberExpression": {
      if (node.computed) return null;
      if (node.property.type !== "Identifier") return null;
      const obj = nodeToCanonical(node.object);
      if (obj === null) return null;
      return `${obj}.${node.property.name}`;
    }
    case "CallExpression": {
      const callee = nodeToCanonical(node.callee);
      if (callee === null) return null;
      // We don't include arguments in the canonical form; `messaging()`
      // matches regardless of what (if anything) is passed.
      return `${callee}()`;
    }
    default:
      return null;
  }
}

/**
 * No external docs site yet; the rule documents itself via its source. If
 * `RuleCreator` requires a URL, give it the repo URL.
 */
const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/vulcanize/eslint-plugin-fp-discipline",
);

export const rule = createRule<[RuleOptions], MessageIds>({
  name: "single-owner-effectful-symbol",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Warn when more than one file calls a configured effectful symbol; resource-mediated APIs should have a single owner.",
    },
    schema: [
      {
        type: "object",
        properties: {
          effectfulSymbols: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                maxOwners: { type: "integer", minimum: 1 },
                allowList: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["pattern"],
              additionalProperties: false,
            },
          },
        },
        required: ["effectfulSymbols"],
        additionalProperties: false,
      },
    ],
    messages: {
      tooManyOwners:
        "Effectful symbol `{{pattern}}` already has {{max}} owner(s) elsewhere in the project (first: {{firstOwner}}). This file becomes a competing owner; consolidate the call into a single module or add this file to the rule's allowList.",
    },
  },
  defaultOptions: [{ effectfulSymbols: [] }],
  create(context, [options]) {
    const filename = context.filename;
    const symbols = options.effectfulSymbols;
    if (symbols.length === 0) {
      return {};
    }

    // Index by canonical pattern for O(1) lookup at each CallExpression.
    const byPattern = new Map<string, SymbolSpec>();
    for (const sym of symbols) {
      byPattern.set(sym.pattern, sym);
    }

    return {
      CallExpression(node) {
        const canonical = nodeToCanonical(node.callee);
        if (canonical === null) return;
        const sym = byPattern.get(canonical);
        if (sym === undefined) return;

        const allowList = sym.allowList ?? [];
        if (allowList.includes(filename)) return;

        const max = sym.maxOwners ?? 1;
        let owners = registry.get(canonical);
        if (owners === undefined) {
          owners = new Set();
          registry.set(canonical, owners);
        }
        owners.add(filename);

        // The first `max` distinct filenames in insertion order are the
        // sanctioned owners; everyone after is a violation.
        const ordered = Array.from(owners);
        const idx = ordered.indexOf(filename);
        if (idx >= max) {
          const firstOwner = ordered[0] ?? "(unknown)";
          context.report({
            node,
            messageId: "tooManyOwners",
            data: {
              pattern: canonical,
              max: String(max),
              firstOwner,
            },
          });
        }
      },
    };
  },
});

export default rule;
