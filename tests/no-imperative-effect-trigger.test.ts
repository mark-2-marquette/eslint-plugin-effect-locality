/**
 * Tests for `no-imperative-effect-trigger`.
 *
 * Enforces ADR-2026-05-19 Drift Pattern 2: event handlers (onPress,
 * onClick, onSubmit) must NOT orchestrate async side effects directly
 * (`await api.X()`, `.then(...)` chains). Handler dispatches an event;
 * the effect reacts to the resulting state phase. This is the React-
 * docs prescription for "You Might Not Need an Effect" applied to
 * async work — the only way to enter the side-effecting phase is to
 * dispatch the event, so tap-but-no-fire is unrepresentable.
 *
 * These cases ARE the spec — the implementation is driven by making
 * them pass (outside-in TDD).
 */
import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";

import { rule } from "../src/rules/no-imperative-effect-trigger.js";

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

ruleTester.run("no-imperative-effect-trigger", rule, {
  valid: [
    // valid 1: dispatch-only handler — exemplar of the right way.
    {
      name: "onPress dispatches an event — clean",
      code: `
        function Component() {
          return <Button onPress={() => dispatch({ type: 'CREDIT_TAPPED' })} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 2: sync onClick — no async work, no flag.
    {
      name: "onClick sync handler — clean",
      code: `
        function Component() {
          return <Button onClick={() => { setOpen(true); }} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 3: handler is a bare identifier reference (NOT inline arrow) —
    // outside scope; rule only inspects inline function expressions.
    {
      name: "onPress bound to identifier — outside rule's scope",
      code: `
        function Component() {
          return <Button onPress={handlePress} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 4: handler with multiple dispatch calls — still no async.
    {
      name: "onPress dispatches multiple events — clean",
      code: `
        function Component() {
          return <Button onPress={() => {
            dispatch({ type: 'A' });
            dispatch({ type: 'B' });
          }} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
  ],
  invalid: [
    // invalid 1: async onPress with await api.x() — flagged.
    {
      name: "async onPress with await api.creditOnboarding — flagged",
      code: `
        function Component() {
          return <Button onPress={async () => {
            const result = await api.creditOnboarding(wallet, deviceId);
          }} />;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "imperativeEffectTrigger" }],
    },
    // invalid 2: onPress with .then() chain — flagged.
    {
      name: "onPress with .then() chain — flagged",
      code: `
        function Component() {
          return <Button onPress={() => {
            api.creditOnboarding(wallet).then((r) => setData(r));
          }} />;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "imperativeEffectTrigger" }],
    },
    // invalid 3: onSubmit with await + setState — flagged.
    {
      name: "onSubmit doing async setState — flagged",
      code: `
        function Component() {
          return <Form onSubmit={async () => {
            setBusy(true);
            await api.submit();
            setBusy(false);
          }} />;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "imperativeEffectTrigger" }],
    },
  ],
});
