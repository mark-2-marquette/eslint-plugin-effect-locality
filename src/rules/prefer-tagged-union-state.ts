/**
 * Rule: prefer-tagged-union-state
 *
 * Enforces ADR-2026-05-19 Drift Pattern 1 — the parallel-state shape:
 *
 *   const [isLoading, setIsLoading] = useState(false);
 *   const [error,     setError]     = useState<Error | null>(null);
 *   const [data,      setData]      = useState<Data | null>(null);
 *
 * compiles to a type that admits `isLoading=true && error=Error &&
 * data=Data` simultaneously — an impossible state. The right shape is
 * a discriminated-union driven by `useReducer`:
 *
 *   type State =
 *     | { phase: 'idle' }
 *     | { phase: 'loading' }
 *     | { phase: 'error';   error: Error }
 *     | { phase: 'success'; data: Data };
 *   const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
 *
 * Detection
 * ---------
 * For each function-scoped component (FunctionDeclaration,
 * FunctionExpression, ArrowFunctionExpression), collect the `useState`
 * calls in its top-level body (NOT inside nested function expressions).
 * Categorise each:
 *   - boolean       — `useState<boolean>(_)` or `useState(true|false)`
 *   - error-null    — `useState<Error | null>(...)` (or any type name
 *                     listed in `errorTypeNames`)
 *   - generic-null  — `useState<T | null>(...)` where T is a
 *                     TypeReference and not an error type
 *
 * If a single component contains both (boolean) and at least one of
 * (error-null OR generic-null), report once per component on the
 * first boolean useState (the most actionable trigger).
 *
 * This is intentionally heuristic: the rule fires on shape, not on
 * dataflow. False positives (two unrelated state slots that happen
 * to coexist as boolean + Data|null) are addressed by a per-line
 * disable comment with reason; the rule's goal is to surface the
 * pattern for review, not to type-prove the impossibility.
 */
import { ESLintUtils, AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

export interface RuleOptions {
  /** Type names treated as error-shaped. Default: `["Error"]`. */
  errorTypeNames?: string[];
}

type MessageIds = "preferTaggedUnion";

const DEFAULT_ERROR_TYPE_NAMES: readonly string[] = ["Error"];

const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/mark-2-marquette/eslint-plugin-effect-locality",
);

type StateShape = "boolean" | "error-null" | "generic-null" | "other";

interface CategorisedState {
  shape: StateShape;
  call: TSESTree.CallExpression;
}

export const rule = createRule<[RuleOptions], MessageIds>({
  name: "prefer-tagged-union-state",
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag the parallel-state shape (useState<boolean> + useState<Error|null> + useState<T|null>) that encodes impossible state combinations. Prefer a useReducer-driven discriminated union.",
    },
    schema: [
      {
        type: "object",
        properties: {
          errorTypeNames: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      preferTaggedUnion:
        "Parallel-state shape detected in this component: a boolean phase flag (`{{booleanVar}}`) coexists with a nullable {{otherShape}} state (`{{otherVar}}`). This encodes impossible combinations like `loading=true && data=Data`. Per ADR-2026-05-19 Drift Pattern 1, refactor to a `useReducer` with a tagged-union state ({ phase: 'idle' | 'loading' | 'error' | 'success' }).",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const errorTypeNames =
      options.errorTypeNames ?? DEFAULT_ERROR_TYPE_NAMES;

    function categorise(call: TSESTree.CallExpression): StateShape {
      // Explicit typeArguments first.
      const typeArgs = call.typeArguments;
      if (typeArgs && typeArgs.params.length > 0) {
        const t = typeArgs.params[0];
        if (t) {
          switch (t.type) {
            case AST_NODE_TYPES.TSBooleanKeyword:
              return "boolean";
            case AST_NODE_TYPES.TSUnionType: {
              // Look for `X | null` shape.
              const nonNull = t.types.filter(
                (member) => member.type !== AST_NODE_TYPES.TSNullKeyword,
              );
              const hasNull = t.types.some(
                (member) => member.type === AST_NODE_TYPES.TSNullKeyword,
              );
              if (!hasNull) return "other";
              if (nonNull.length !== 1) return "other";
              const head = nonNull[0];
              if (!head) return "other";
              if (head.type === AST_NODE_TYPES.TSTypeReference) {
                const tn = head.typeName;
                if (tn.type === AST_NODE_TYPES.Identifier) {
                  if (errorTypeNames.includes(tn.name)) return "error-null";
                  return "generic-null";
                }
              }
              return "generic-null";
            }
            default:
              return "other";
          }
        }
      }
      // Inferred from initial argument's literal type — only the
      // boolean case is meaningful (`useState(false)`). String and
      // number literals are explicitly out of scope for this rule
      // (they don't form the parallel-state shape).
      const arg = call.arguments[0];
      if (
        arg &&
        arg.type === AST_NODE_TYPES.Literal &&
        typeof arg.value === "boolean"
      ) {
        return "boolean";
      }
      return "other";
    }

    function processComponentFunction(
      fn:
        | TSESTree.FunctionDeclaration
        | TSESTree.FunctionExpression
        | TSESTree.ArrowFunctionExpression,
    ): void {
      const body = fn.body;
      if (!body || body.type !== AST_NODE_TYPES.BlockStatement) return;
      // Top-level useState calls only — nested closures are
      // semantically different components.
      const states: CategorisedState[] = [];
      for (const stmt of body.body) {
        if (stmt.type !== AST_NODE_TYPES.VariableDeclaration) continue;
        for (const declarator of stmt.declarations) {
          if (!declarator.init) continue;
          if (declarator.init.type !== AST_NODE_TYPES.CallExpression) continue;
          const call = declarator.init;
          if (call.callee.type !== AST_NODE_TYPES.Identifier) continue;
          if (call.callee.name !== "useState") continue;
          const shape = categorise(call);
          if (shape === "other") continue;
          states.push({ shape, call });
        }
      }

      const boolStates = states.filter((s) => s.shape === "boolean");
      const errorStates = states.filter((s) => s.shape === "error-null");
      const genericStates = states.filter((s) => s.shape === "generic-null");

      if (boolStates.length === 0) return;
      if (errorStates.length === 0 && genericStates.length === 0) return;

      const trigger = boolStates[0]!;
      const partner = errorStates[0] ?? genericStates[0]!;

      context.report({
        node: trigger.call,
        messageId: "preferTaggedUnion",
        data: {
          booleanVar: getDestructuredFirstName(trigger.call) ?? "(unnamed)",
          otherShape: partner.shape === "error-null" ? "Error" : "T",
          otherVar: getDestructuredFirstName(partner.call) ?? "(unnamed)",
        },
      });
    }

    return {
      FunctionDeclaration: processComponentFunction,
      FunctionExpression: processComponentFunction,
      ArrowFunctionExpression: processComponentFunction,
    };
  },
});

/**
 * For a useState call inside `const [x, setX] = useState(...)`, return
 * the value identifier name (`x`). Returns null when the LHS isn't a
 * destructured pair.
 */
function getDestructuredFirstName(
  call: TSESTree.CallExpression,
): string | null {
  const parent = call.parent;
  if (!parent || parent.type !== AST_NODE_TYPES.VariableDeclarator) return null;
  if (parent.id.type !== AST_NODE_TYPES.ArrayPattern) return null;
  const first = parent.id.elements[0];
  if (!first || first.type !== AST_NODE_TYPES.Identifier) return null;
  return first.name;
}

export default rule;
