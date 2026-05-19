/**
 * Rule: no-screen-local-phase-state
 *
 * Enforces ADR-2026-05-19 Drift Pattern 3 — screen-local phase state
 * (`useState<boolean|string|number>`, `useRef<boolean>(false)`) is
 * forbidden in flow-bearing screens. Phase belongs to a parent
 * reducer machine; the screen renders as a match over machine state.
 *
 * Configuration model
 * -------------------
 * The rule does NOT hardcode `mobile/src/screens/` — the consumer
 * scopes the rule via flat-config `files:` globs (one config block
 * for screens, another for non-screen surfaces where the rule does
 * not apply). This matches how the rest of the plugin is configured
 * and keeps the rule reusable across codebases.
 *
 * Detection
 * ---------
 * 1. `useState` call with destructured `[value, setter]` LHS.
 * 2. Determine primitive type — explicit `useState<T>()` typeArguments
 *    take precedence; otherwise the initial argument's literal type
 *    is inferred (`true|false` → boolean, `'..'` → string, `0..` →
 *    number). Catches both `useState<boolean>(false)` and the
 *    inferred `useState(false)`.
 * 3. Allow-list: if the value identifier is referenced as the
 *    expression of a JSX attribute named `value` (or any name in
 *    `inputBindingAttrs`), the binding is input-bound and not a
 *    phase flag. Skip.
 * 4. Otherwise: report `screenLocalPhaseState`.
 *
 * `useRef<boolean>(false)` is detected separately on the
 * `screenLocalPhaseRef` message — refs of non-primitive types
 * (View, HTMLDivElement, etc.) are not matched because their
 * typeArguments are not in `forbiddenRefTypes`.
 *
 * Disable-reason discipline
 * -------------------------
 * Per task spec, the opt-out is `// eslint-disable-next-line
 * effect-locality/no-screen-local-phase-state -- <reason>` with a
 * mandatory `-- <reason>` clause. ESLint's own disable processing
 * doesn't enforce the reason — so the rule scans all line/block
 * comments at Program time and reports `missingDisableReason` on
 * any disable directive referring to this rule that lacks a
 * `-- <non-whitespace>` tail. The disable comment still suppresses
 * the primary violation (that's ESLint's built-in behaviour); the
 * extra report fires on the comment line so the reason discipline
 * is itself enforced.
 */
import { ESLintUtils, AST_NODE_TYPES, type TSESTree } from "@typescript-eslint/utils";

export interface RuleOptions {
  /** JSX attribute names that indicate input-bound state. */
  inputBindingAttrs?: string[];
  /** Primitive type names forbidden as `useState<T>`. */
  forbiddenStateTypes?: string[];
  /** Primitive type names forbidden as `useRef<T>`. */
  forbiddenRefTypes?: string[];
}

type MessageIds =
  | "screenLocalPhaseState"
  | "screenLocalPhaseRef"
  | "missingDisableReason";

const DEFAULT_INPUT_BINDING_ATTRS: readonly string[] = [
  "value",
  "defaultValue",
];
const DEFAULT_FORBIDDEN_STATE_TYPES: readonly string[] = [
  "boolean",
  "string",
  "number",
];
const DEFAULT_FORBIDDEN_REF_TYPES: readonly string[] = ["boolean"];

const RULE_NAME = "no-screen-local-phase-state";
const QUALIFIED_NAME = `effect-locality/${RULE_NAME}`;

const createRule = ESLintUtils.RuleCreator(
  () => "https://github.com/mark-2-marquette/eslint-plugin-effect-locality",
);

export const rule = createRule<[RuleOptions], MessageIds>({
  name: RULE_NAME,
  meta: {
    type: "problem",
    docs: {
      description:
        "Forbid screen-local phase state (useState<boolean|string|number>, useRef<boolean>) in flow-bearing screens. Phase belongs to a parent reducer machine.",
    },
    schema: [
      {
        type: "object",
        properties: {
          inputBindingAttrs: { type: "array", items: { type: "string" } },
          forbiddenStateTypes: { type: "array", items: { type: "string" } },
          forbiddenRefTypes: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      screenLocalPhaseState:
        "Screen-local `useState<{{typeName}}>` for `{{varName}}` looks like phase state. Per ADR-2026-05-19, screens render as a match over a parent machine's state. Lift the phase into a `useReducer` tagged-union state, or opt out with `// eslint-disable-next-line effect-locality/no-screen-local-phase-state -- <reason>` if this is genuinely input/UI-only state.",
      screenLocalPhaseRef:
        "Screen-local `useRef<{{typeName}}>(...)` for `{{varName}}` looks like a phase guard. Per ADR-2026-05-19, the screen should react to a parent machine's state rather than tracking 'are we currently doing X' in a ref. Move the guard into the reducer.",
      missingDisableReason:
        "Disable directive for `effect-locality/no-screen-local-phase-state` is missing a `-- <reason>` clause. Reason discipline: a bare disable hides the architectural intent. Use `// eslint-disable-next-line effect-locality/no-screen-local-phase-state -- <reason>`.",
    },
  },
  defaultOptions: [{}],
  create(context, [options]) {
    const inputBindingAttrs =
      options.inputBindingAttrs ?? DEFAULT_INPUT_BINDING_ATTRS;
    const forbiddenStateTypes =
      options.forbiddenStateTypes ?? DEFAULT_FORBIDDEN_STATE_TYPES;
    const forbiddenRefTypes =
      options.forbiddenRefTypes ?? DEFAULT_FORBIDDEN_REF_TYPES;

    return {
      Program(programNode): void {
        // Disable-directive reason discipline. ESLint suppresses the
        // primary violation when a matching disable directive is
        // present (built-in behaviour). We piggyback on the comment
        // scan to flag bare disables — the disable comment line still
        // gets a report, even when the underlying useState is
        // suppressed.
        const comments = context.sourceCode.getAllComments();
        for (const comment of comments) {
          if (comment.type !== "Line" && comment.type !== "Block") continue;
          const text = comment.value;
          // Match the disable directive shape — both `disable-next-line`
          // and `disable-line` apply (and `disable` block-scoped, but
          // for the rule's own report we only care about whether the
          // rule is mentioned).
          if (!/eslint-disable(-next-line|-line)?\b/.test(text)) continue;
          if (!text.includes(QUALIFIED_NAME) && !text.includes(RULE_NAME)) {
            continue;
          }
          // Require ` -- <non-whitespace>` somewhere in the comment
          // (per @eslint-community/eslint-comments convention).
          if (/\s--\s+\S/.test(text)) continue;
          context.report({
            node: comment as unknown as TSESTree.Node,
            messageId: "missingDisableReason",
          });
        }

        // Walk JSX once to build the set of identifier names used as
        // input-binding attribute expressions. Identifiers are matched
        // by name (cheap heuristic) — the rule is intentionally
        // conservative: if the name appears as a value-binding
        // somewhere in the file, we treat the matching useState as
        // input-bound. This errs on the side of not flagging, per the
        // task's allow-list intent.
        const inputBoundNames = collectInputBoundIdentifiers(
          programNode,
          inputBindingAttrs,
        );

        // Traverse for useState / useRef calls.
        walkForHookCalls(programNode, (call) => {
          handleHookCall({
            call,
            context,
            inputBoundNames,
            forbiddenStateTypes,
            forbiddenRefTypes,
          });
        });
      },
    };
  },
});

interface HandleArgs {
  call: TSESTree.CallExpression;
  context: Parameters<typeof rule.create>[0];
  inputBoundNames: ReadonlySet<string>;
  forbiddenStateTypes: readonly string[];
  forbiddenRefTypes: readonly string[];
}

function handleHookCall(args: HandleArgs): void {
  const { call, context, inputBoundNames, forbiddenStateTypes, forbiddenRefTypes } = args;
  if (call.callee.type !== AST_NODE_TYPES.Identifier) return;
  const calleeName = call.callee.name;
  if (calleeName !== "useState" && calleeName !== "useRef") return;

  // LHS must be a destructured array `[value, setter]` for useState, or
  // a plain identifier for useRef.
  const declarator = findParentVariableDeclarator(call);
  if (!declarator) return;

  if (calleeName === "useState") {
    if (declarator.id.type !== AST_NODE_TYPES.ArrayPattern) return;
    const first = declarator.id.elements[0];
    if (!first || first.type !== AST_NODE_TYPES.Identifier) return;
    const valueName = first.name;
    const typeName = resolveStateTypeName(call);
    if (typeName === null) return;
    if (!forbiddenStateTypes.includes(typeName)) return;
    if (inputBoundNames.has(valueName)) return;
    context.report({
      node: call,
      messageId: "screenLocalPhaseState",
      data: { typeName, varName: valueName },
    });
    return;
  }

  // useRef: only the explicit typeArguments shape is forbidden — a
  // ref's "type" is not meaningfully inferred from `false` because
  // `useRef(false)` is rare; the documented phase-guard antipattern
  // is `useRef<boolean>(false)`.
  if (declarator.id.type !== AST_NODE_TYPES.Identifier) return;
  const refName = declarator.id.name;
  const typeName = explicitTypeArgName(call);
  if (typeName === null) return;
  if (!forbiddenRefTypes.includes(typeName)) return;
  context.report({
    node: call,
    messageId: "screenLocalPhaseRef",
    data: { typeName, varName: refName },
  });
}

/**
 * Walk `node` and yield every CallExpression. ESLint's selector visitor
 * already exposes CallExpression as a top-level key, but we drive the
 * scan from `Program:enter` because we need to gather JSX-bound
 * identifiers first (a single AST traversal isn't sufficient with the
 * selector-API event ordering).
 */
function walkForHookCalls(
  root: TSESTree.Node,
  visit: (node: TSESTree.CallExpression) => void,
): void {
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === AST_NODE_TYPES.CallExpression) {
      visit(node);
    }
    for (const child of childNodes(node)) {
      stack.push(child);
    }
  }
}

/**
 * Yield AST children of `node`. Handles arrays and single-node
 * properties uniformly. Skips non-node properties like type / range /
 * loc / parent.
 */
function childNodes(node: TSESTree.Node): TSESTree.Node[] {
  const out: TSESTree.Node[] = [];
  for (const key of Object.keys(node)) {
    if (key === "parent" || key === "type" || key === "loc" || key === "range") {
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

/**
 * Resolve the effective state type. Explicit typeArguments take
 * precedence (`useState<boolean>(true)`); otherwise infer from the
 * initial argument's literal type (`useState(false)` → boolean,
 * `useState('')` → string, `useState(0)` → number). Returns null when
 * the type can't be determined.
 */
function resolveStateTypeName(call: TSESTree.CallExpression): string | null {
  const explicit = explicitTypeArgName(call);
  if (explicit !== null) return explicit;
  if (call.arguments.length === 0) return null;
  const arg = call.arguments[0];
  if (!arg) return null;
  if (arg.type !== AST_NODE_TYPES.Literal) return null;
  if (typeof arg.value === "boolean") return "boolean";
  if (typeof arg.value === "string") return "string";
  if (typeof arg.value === "number") return "number";
  return null;
}

/**
 * For `hook<T>(...)`, return T's top-level name if T is a single
 * primitive-typed type-keyword (boolean / string / number) or a
 * TypeReference whose name is one of those.
 */
function explicitTypeArgName(call: TSESTree.CallExpression): string | null {
  const typeArgs = call.typeArguments;
  if (!typeArgs) return null;
  if (typeArgs.params.length === 0) return null;
  const first = typeArgs.params[0];
  if (!first) return null;
  switch (first.type) {
    case AST_NODE_TYPES.TSBooleanKeyword:
      return "boolean";
    case AST_NODE_TYPES.TSStringKeyword:
      return "string";
    case AST_NODE_TYPES.TSNumberKeyword:
      return "number";
    case AST_NODE_TYPES.TSTypeReference: {
      const tn = first.typeName;
      if (tn.type === AST_NODE_TYPES.Identifier) return tn.name;
      return null;
    }
    default:
      return null;
  }
}

/**
 * Walk up the parent chain to find the `VariableDeclarator` enclosing
 * a CallExpression init. Returns null if the call isn't in a
 * declarator (e.g. it's an expression statement or argument).
 */
function findParentVariableDeclarator(
  call: TSESTree.CallExpression,
): TSESTree.VariableDeclarator | null {
  let cur: TSESTree.Node | undefined = call.parent;
  while (cur) {
    if (cur.type === AST_NODE_TYPES.VariableDeclarator) return cur;
    cur = cur.parent;
  }
  return null;
}

/**
 * Find every identifier name used as the expression of a JSX attribute
 * whose name is in `inputBindingAttrs`. e.g. `<TextInput value={query} />`
 * adds `"query"` to the set.
 */
function collectInputBoundIdentifiers(
  root: TSESTree.Node,
  inputBindingAttrs: readonly string[],
): Set<string> {
  const names = new Set<string>();
  const attrSet = new Set(inputBindingAttrs);
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.type === AST_NODE_TYPES.JSXAttribute) {
      const attrName = node.name;
      const name =
        attrName.type === AST_NODE_TYPES.JSXIdentifier ? attrName.name : null;
      if (name && attrSet.has(name) && node.value) {
        collectIdentifierNames(node.value, names);
      }
    }
    for (const child of childNodes(node)) {
      stack.push(child);
    }
  }
  return names;
}

function collectIdentifierNames(
  node: TSESTree.Node,
  out: Set<string>,
): void {
  const stack: TSESTree.Node[] = [node];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === AST_NODE_TYPES.Identifier) {
      out.add(cur.name);
    }
    for (const child of childNodes(cur)) {
      stack.push(child);
    }
  }
}

export default rule;
