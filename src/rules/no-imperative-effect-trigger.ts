/**
 * Rule: no-imperative-effect-trigger
 *
 * Enforces ADR-2026-05-19 Drift Pattern 2 — JSX event handlers
 * (`onPress`, `onClick`, `onSubmit`, …) must NOT orchestrate async
 * work directly. Instead the handler dispatches an event and an
 * effect reacts to the resulting state phase.
 *
 *   WRONG
 *   <Button onPress={async () => {
 *     setBusy(true);
 *     const result = await api.creditOnboarding(wallet);
 *     ...
 *   }} />
 *
 *   RIGHT
 *   <Button onPress={() => dispatch({ type: 'CREDIT_TAPPED' })} />
 *   useEffect(() => {
 *     if (state.phase !== 'crediting') return;
 *     ...
 *   }, [state.phase, wallet]);
 *
 * Detection
 * ---------
 * 1. JSXAttribute whose name matches `handlerNamePattern` (default
 *    `^on[A-Z]`).
 * 2. The attribute's value is an inline ArrowFunctionExpression or
 *    FunctionExpression (handlers bound to identifiers are out of
 *    scope — the rule only reasons about inline shapes; identifier
 *    bindings are reviewed at their definition site).
 * 3. Walk the function body. Flag if we find:
 *      a. an AwaitExpression, OR
 *      b. a CallExpression whose callee is a MemberExpression with
 *         property name `then` and whose `then`-target is itself a
 *         CallExpression (the `.then` of an async call).
 *
 * Sync handlers, dispatch-only handlers, and identifier-bound
 * handlers are silent.
 */
import { ESLintUtils, AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

export interface RuleOptions {
  /** Regex (as string) matching handler attribute names. */
  handlerNamePattern?: string;
}

type MessageIds = "imperativeEffectTrigger";

const DEFAULT_HANDLER_NAME_PATTERN = "^on[A-Z]";

const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/mark-2-marquette/eslint-plugin-effect-locality",
);

export const rule = createRule<[RuleOptions], MessageIds>({
  name: "no-imperative-effect-trigger",
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid event handlers (onPress, onClick, ...) from orchestrating async side effects directly. Handler dispatches an event; effect reacts to state phase.",
    },
    schema: [
      {
        type: "object",
        properties: {
          handlerNamePattern: { type: "string" },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      imperativeEffectTrigger:
        "JSX handler `{{attrName}}` orchestrates async work directly ({{shape}}). Per ADR-2026-05-19 Drift Pattern 2, the handler should dispatch an event and a `useEffect` should react to the resulting state phase. This makes 'tap-but-no-fire' unrepresentable. Refactor to `onPress={() => dispatch({type:'X_TAPPED'})}` + `useEffect(() => { if (state.phase === 'X-ing') { ... } }, [state.phase, ...])`.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const handlerNamePattern = new RegExp(
      options.handlerNamePattern ?? DEFAULT_HANDLER_NAME_PATTERN,
    );

    return {
      JSXAttribute(node) {
        const name = node.name;
        if (name.type !== AST_NODE_TYPES.JSXIdentifier) return;
        if (!handlerNamePattern.test(name.name)) return;
        const value = node.value;
        if (!value) return;
        if (value.type !== AST_NODE_TYPES.JSXExpressionContainer) return;
        const expr = value.expression;
        if (
          expr.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          expr.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return;
        }
        const shape = detectAsyncShape(expr);
        if (shape === null) return;
        context.report({
          node: expr,
          messageId: "imperativeEffectTrigger",
          data: { attrName: name.name, shape },
        });
      },
    };
  },
});

/**
 * Walk the handler body looking for await or `.then()` chains.
 * Returns a description string identifying the offending shape, or
 * null if the body is sync.
 */
function detectAsyncShape(
  fn: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression,
): string | null {
  const body = fn.body;
  // ArrowFunction with expression body: the body IS a single
  // expression. Walk it as-is.
  const root: TSESTree.Node =
    body.type === AST_NODE_TYPES.BlockStatement ? body : body;
  let found: string | null = null;
  walk(root, (node) => {
    if (found !== null) return false;
    // Stop descent at nested function bodies — those are different
    // call frames; their async-ness is its own concern.
    if (
      node !== root &&
      (node.type === AST_NODE_TYPES.FunctionExpression ||
        node.type === AST_NODE_TYPES.ArrowFunctionExpression ||
        node.type === AST_NODE_TYPES.FunctionDeclaration)
    ) {
      return false;
    }
    if (node.type === AST_NODE_TYPES.AwaitExpression) {
      found = "`await` inside the handler body";
      return false;
    }
    if (
      node.type === AST_NODE_TYPES.CallExpression &&
      node.callee.type === AST_NODE_TYPES.MemberExpression &&
      !node.callee.computed &&
      node.callee.property.type === AST_NODE_TYPES.Identifier &&
      node.callee.property.name === "then" &&
      node.callee.object.type === AST_NODE_TYPES.CallExpression
    ) {
      found = "`.then(...)` chained on an async call";
      return false;
    }
    return true;
  });
  return found;
}

function walk(
  root: TSESTree.Node,
  visit: (node: TSESTree.Node) => boolean,
): void {
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    const descend = visit(node);
    if (!descend) continue;
    for (const child of childNodes(node)) {
      stack.push(child);
    }
  }
}

function childNodes(node: TSESTree.Node): TSESTree.Node[] {
  const out: TSESTree.Node[] = [];
  for (const key of Object.keys(node)) {
    if (
      key === "parent" ||
      key === "type" ||
      key === "loc" ||
      key === "range"
    ) {
      continue;
    }
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) out.push(item);
      }
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

function isNode(value: unknown): value is TSESTree.Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

export default rule;
