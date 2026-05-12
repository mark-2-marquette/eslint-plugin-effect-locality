/**
 * Rule: no-orphan-fallible-effect
 *
 * Catches the fire-and-forget `useEffect(() => { f().then(setX) }, [])`
 * antipattern when:
 *
 *   1. The effect has empty deps (`[]`) — so it runs exactly once, at mount.
 *   2. The effect writes to a state setter (`setX`) whose useState hook
 *      declares a *fallible* state type (a `RemoteData`-shaped union, or any
 *      type whose name is listed in the `errorTagCatalogue` option).
 *   3. No OTHER code in the enclosing component writes to `setX` — no event
 *      handler, no focus hook, no AppState listener.
 *
 * The failure mode this catches: when the async work fails, the component is
 * left in `{ status: 'failed', ... }` and there is no path back to a retry.
 * Backgrounding / foregrounding the app does not re-trigger the mount effect.
 * The user is stuck until full process kill.
 *
 * Motivating case: `mobile/App.tsx:148-178` (`ConfigGate`) in mtm-mobile.
 * On `/pricing` network failure during bootstrap, the app permanently renders
 * the "Config load failed" screen with no in-app recovery.
 *
 * Heuristic, not type-aware
 * -------------------------
 * v1 matches on the *name* of the useState type argument (e.g. `RemoteData`).
 * A type-aware version that inspects the actual union members of the state
 * type (looking for a `status: 'failed'` variant) is deliberately deferred —
 * see pebble `mtm-eslint-no-orphan-fallible-effect` §"Out of scope".
 *
 * Mechanism
 * ---------
 * - A `useEffect` call site is "orphan-shaped" when it has two arguments, the
 *   second is `[]`, and the first is a function expression.
 * - For each orphan-shaped effect, we use ESLint scope analysis to find every
 *   variable in the enclosing function scope (and its non-function block
 *   scopes) whose name matches `setterPattern` and which is defined as the
 *   setter half of a `useState` destructuring (`const [_, setX] = useState<T>()`).
 * - For each such variable, we read the type argument of the `useState` call
 *   and compare its name against `errorTagCatalogue`. No type-checker access.
 * - Finally, we walk `variable.references`. The variable counts as having an
 *   "other writer" iff a call-style reference (`setX(...)`) exists somewhere
 *   that is NOT a descendant of the orphan effect's callback. If there is no
 *   other writer and at least one writer inside the effect, we report.
 */
import {
  ESLintUtils,
  AST_NODE_TYPES,
  type TSESTree,
  type TSESLint,
} from "@typescript-eslint/utils";

export interface RuleOptions {
  /**
   * Type-name catalogue. A useState whose declared type's top-level name is
   * in this list is treated as fallible. Default: `["RemoteData"]`.
   *
   * Add project-specific async-result type names here (e.g. `AsyncResult`,
   * `Loadable`). The check is on the bare type-reference name; generic args
   * are ignored.
   */
  errorTagCatalogue?: string[];

  /**
   * Regex (as a string) matching setter identifiers. Default: `"^set[A-Z]"`.
   * This is the React community convention for `useState` setters.
   */
  setterPattern?: string;

  /**
   * Names of hooks whose callbacks count as a retry trigger when they invoke
   * the same setter elsewhere in the component. Default:
   * `["useAppStateBecameActive", "useFocusEffect", "useInterval"]`.
   *
   * Note: in v1 we don't actually special-case these — ANY other writer of
   * the setter (event handler, hook callback, prop call site) is sufficient
   * to mark the effect as having a retry path. This option is reserved so
   * that a future "the only writers are retry triggers; warn anyway" or
   * "require at least one specific trigger" variant can be added without an
   * options-schema change. Listed here for forward-compat and documentation.
   */
  retryTriggers?: string[];
}

type MessageIds = "orphanFallibleEffect";

const DEFAULT_ERROR_TAG_CATALOGUE: readonly string[] = ["RemoteData"];
const DEFAULT_SETTER_PATTERN = "^set[A-Z]";
const DEFAULT_RETRY_TRIGGERS: readonly string[] = [
  "useAppStateBecameActive",
  "useFocusEffect",
  "useInterval",
];

const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/mark-2-marquette/eslint-plugin-effect-locality",
);

export const rule = createRule<[RuleOptions], MessageIds>({
  name: "no-orphan-fallible-effect",
  meta: {
    type: "problem",
    docs: {
      description:
        "Catch fire-and-forget `useEffect(() => { f().then(setX) }, [])` when `setX` holds a fallible state and nothing else in the component can retry.",
    },
    schema: [
      {
        type: "object",
        properties: {
          errorTagCatalogue: {
            type: "array",
            items: { type: "string" },
          },
          setterPattern: { type: "string" },
          retryTriggers: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      orphanFallibleEffect:
        "Fire-and-forget useEffect with empty deps writes to `{{setterName}}`, which holds a fallible state (`{{stateTypeName}}`). On failure, the component is stuck — no event handler, focus hook, or AppState listener can retry this setter. Either add a retry trigger (e.g. `useAppStateBecameActive`) elsewhere in this component, or move the effect into a hook that re-runs on foreground.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const errorTagCatalogue =
      options.errorTagCatalogue ?? DEFAULT_ERROR_TAG_CATALOGUE;
    const setterPattern = new RegExp(
      options.setterPattern ?? DEFAULT_SETTER_PATTERN,
    );
    // `retryTriggers` is reserved (see RuleOptions doc); the v1 detection
    // treats every non-effect writer as a retry path.
    void DEFAULT_RETRY_TRIGGERS;
    void options.retryTriggers;

    // Collect orphan-shaped useEffect call sites during the first traversal,
    // then process them on Program:exit so scope analysis is fully populated.
    const orphanEffects: {
      effect: TSESTree.CallExpression;
      callback: TSESTree.ArrowFunctionExpression | TSESTree.FunctionExpression;
    }[] = [];

    return {
      CallExpression(node) {
        if (!isOrphanShapedUseEffect(node)) return;
        const [callbackArg] = node.arguments;
        if (!callbackArg) return;
        if (
          callbackArg.type !== AST_NODE_TYPES.ArrowFunctionExpression &&
          callbackArg.type !== AST_NODE_TYPES.FunctionExpression
        ) {
          return;
        }
        orphanEffects.push({ effect: node, callback: callbackArg });
      },

      "Program:exit"(): void {
        for (const { effect, callback } of orphanEffects) {
          handleOrphanEffect({
            context,
            effect,
            callback,
            errorTagCatalogue,
            setterPattern,
          });
        }
      },
    };
  },
});

/**
 * `useEffect(callback, [])` with exactly two arguments and an empty array
 * literal as the second. Doesn't yet require the callback to be a function
 * (caller checks).
 */
function isOrphanShapedUseEffect(node: TSESTree.CallExpression): boolean {
  if (node.callee.type !== AST_NODE_TYPES.Identifier) return false;
  if (node.callee.name !== "useEffect") return false;
  if (node.arguments.length !== 2) return false;
  const deps = node.arguments[1];
  if (!deps || deps.type !== AST_NODE_TYPES.ArrayExpression) return false;
  if (deps.elements.length !== 0) return false;
  return true;
}

interface HandleArgs {
  context: Readonly<TSESLint.RuleContext<MessageIds, [RuleOptions]>>;
  effect: TSESTree.CallExpression;
  callback:
    | TSESTree.ArrowFunctionExpression
    | TSESTree.FunctionExpression;
  errorTagCatalogue: readonly string[];
  setterPattern: RegExp;
}

function handleOrphanEffect(args: HandleArgs): void {
  const { context, effect, callback, errorTagCatalogue, setterPattern } = args;

  // The enclosing component is the closest function scope OUTSIDE the
  // effect's own callback. The callback itself introduces its own function
  // scope; we want the one above it.
  const callbackScope = context.sourceCode.getScope(callback);
  const componentScope = findEnclosingComponentScope(callbackScope);
  if (!componentScope) return;

  // Each unique setter is reported at most once per effect site, even if it
  // is called multiple times inside the callback.
  const reported = new Set<string>();

  for (const variable of enumerateNonFunctionChildVariables(componentScope)) {
    if (reported.has(variable.name)) continue;
    if (!setterPattern.test(variable.name)) continue;

    const def = variable.defs[0];
    if (!def) continue;
    if (def.type !== "Variable") continue;
    if (def.node.type !== AST_NODE_TYPES.VariableDeclarator) continue;

    const declarator = def.node;
    // Must be a destructured useState: `const [_, setX] = useState<T>(...)`.
    if (declarator.id.type !== AST_NODE_TYPES.ArrayPattern) continue;
    if (
      !declarator.init ||
      declarator.init.type !== AST_NODE_TYPES.CallExpression
    ) {
      continue;
    }
    const initCall = declarator.init;
    if (
      initCall.callee.type !== AST_NODE_TYPES.Identifier ||
      initCall.callee.name !== "useState"
    ) {
      continue;
    }

    // Extract the top-level type name from the useState type argument, if any.
    const typeName = extractUseStateTypeName(initCall);
    if (typeName === null) continue;
    if (!errorTagCatalogue.includes(typeName)) continue;

    // Walk the variable's references. We count ANY reference (not just
    // direct calls) because the canonical orphan shape `f().then(setX)`
    // passes the setter as an argument — there is no CallExpression with
    // `setX` as callee, yet `.then` will invoke it. Symmetrically, any
    // reference outside the effect (event handler, retry hook, prop drill)
    // is a possible retry path; treating it as a "writer" errs on the side
    // of not reporting, which the pebble's "no false positives" acceptance
    // criterion demands.
    //
    // We need at least one reference inside the effect's callback AND zero
    // references outside it.
    let usedInsideEffect = false;
    let usedOutsideEffect = false;
    for (const ref of variable.references) {
      // The destructuring LHS (`const [_, setState] = ...`) registers a
      // write-reference with `init=true` at the definition site. That is
      // not a USE — skip it, otherwise the rule would never fire because
      // every setter "has a writer outside the effect" (itself).
      if (ref.init === true) continue;
      if (isDescendantOf(ref.identifier, callback)) {
        usedInsideEffect = true;
      } else {
        usedOutsideEffect = true;
      }
      if (usedInsideEffect && usedOutsideEffect) break;
    }

    if (!usedInsideEffect) continue;
    if (usedOutsideEffect) continue;

    context.report({
      node: effect,
      messageId: "orphanFallibleEffect",
      data: {
        setterName: variable.name,
        stateTypeName: typeName,
      },
    });
    reported.add(variable.name);
  }
}

/**
 * Walk up the scope chain to find the closest function scope strictly above
 * the callback's own function scope. That is the enclosing component.
 *
 * Note: the callback's scope is itself a "function" scope (since callbacks
 * are functions), so we skip the first match if it's the callback's own
 * scope and find the next one up.
 */
function findEnclosingComponentScope(
  callbackScope: TSESLint.Scope.Scope,
): TSESLint.Scope.Scope | null {
  // The callback IS a function scope. Skip it and find the next function
  // scope above.
  let scope: TSESLint.Scope.Scope | null = callbackScope.upper;
  while (scope) {
    if (scope.type === "function") return scope;
    scope = scope.upper;
  }
  return null;
}

/**
 * Yield every variable defined in `scope` or in any nested block-shaped child
 * scope (block, switch, for, catch). Stops at child function scopes — those
 * are unrelated closures whose setters do not satisfy "OTHER writer in the
 * same component".
 */
function* enumerateNonFunctionChildVariables(
  scope: TSESLint.Scope.Scope,
): Generator<TSESLint.Scope.Variable> {
  for (const v of scope.variables) yield v;
  for (const child of scope.childScopes) {
    if (child.type === "function") continue;
    yield* enumerateNonFunctionChildVariables(child);
  }
}

/**
 * For `useState<T>(...)`, return the top-level type-reference name of `T`,
 * or `null` if T is missing, primitive, or otherwise un-named.
 */
function extractUseStateTypeName(call: TSESTree.CallExpression): string | null {
  const typeArgs = call.typeArguments;
  if (!typeArgs) return null;
  if (typeArgs.params.length === 0) return null;
  const first = typeArgs.params[0];
  if (!first) return null;
  return topLevelTypeName(first);
}

function topLevelTypeName(t: TSESTree.TypeNode): string | null {
  if (t.type === AST_NODE_TYPES.TSTypeReference) {
    const tn = t.typeName;
    if (tn.type === AST_NODE_TYPES.Identifier) return tn.name;
    if (tn.type === AST_NODE_TYPES.TSQualifiedName) {
      // For `a.b.RemoteData`, return the rightmost name.
      return tn.right.name;
    }
    return null;
  }
  // Primitive keywords (TSBooleanKeyword, TSStringKeyword, TSNumberKeyword, etc.)
  // and other non-reference types are deliberately not in any catalogue.
  return null;
}

/**
 * True when `node` is `ancestor` or any descendant of it. Uses the parent
 * link, which TSESTree populates on every node.
 */
function isDescendantOf(
  node: TSESTree.Node,
  ancestor: TSESTree.Node,
): boolean {
  let cur: TSESTree.Node | undefined = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = cur.parent;
  }
  return false;
}

export default rule;
