/**
 * Tests for `prefer-tagged-union-state`.
 *
 * Enforces ADR-2026-05-19 Drift Pattern 1: parallel-state shapes
 * (`useState<boolean>` + `useState<Error | null>` + `useState<T | null>`)
 * encode impossible combinations like `isLoading=true && error=Error &&
 * data=Data`. The fix is a discriminated-union state driven by
 * `useReducer`. This rule flags the parallel shape so reviewers and
 * authors don't ship it.
 *
 * These cases ARE the spec — the implementation is driven by making
 * them pass (outside-in TDD).
 */
import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";

import { rule } from "../src/rules/prefer-tagged-union-state.js";

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

const DEFAULT_OPTIONS = [{}] as const;

ruleTester.run("prefer-tagged-union-state", rule, {
  valid: [
    // valid 1: useReducer-shaped state — exemplar of the right way.
    {
      name: "useReducer with tagged-union state — clean",
      code: `
        function Component() {
          const [state, dispatch] = useReducer(reducer, { phase: 'idle' });
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 2: only one useState in the component — no parallel shape.
    {
      name: "single useState<boolean> — no parallel shape",
      code: `
        function Component() {
          const [open, setOpen] = useState<boolean>(false);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 3: two useStates but neither is a fallible / null shape — clean.
    {
      name: "two booleans, no error/null variant — outside rule's scope",
      code: `
        function Component() {
          const [open, setOpen] = useState<boolean>(false);
          const [pinned, setPinned] = useState<boolean>(false);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 4: useStates in DIFFERENT components — must not cross-pollinate.
    {
      name: "useStates split across two components — not parallel",
      code: `
        function CompA() {
          const [open, setOpen] = useState<boolean>(false);
          return null;
        }
        function CompB() {
          const [data, setData] = useState<Data | null>(null);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
  ],
  invalid: [
    // invalid 1: classic isLoading + error + data triplet — flagged.
    {
      name: "boolean + Error|null + T|null triplet — flagged",
      code: `
        function Component() {
          const [isLoading, setIsLoading] = useState<boolean>(false);
          const [error, setError] = useState<Error | null>(null);
          const [data, setData] = useState<Data | null>(null);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "preferTaggedUnion" }],
    },
    // invalid 2: boolean + Error|null pair — flagged.
    {
      name: "boolean + Error|null pair — flagged",
      code: `
        function Component() {
          const [busy, setBusy] = useState<boolean>(false);
          const [err, setErr] = useState<Error | null>(null);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "preferTaggedUnion" }],
    },
    // invalid 3: inferred boolean useState(false) + Data|null — flagged.
    {
      name: "inferred useState(false) + Data|null — flagged",
      code: `
        function Component() {
          const [loading, setLoading] = useState(false);
          const [data, setData] = useState<Data | null>(null);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "preferTaggedUnion" }],
    },
  ],
});
