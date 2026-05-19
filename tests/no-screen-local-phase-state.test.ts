/**
 * Tests for `no-screen-local-phase-state`.
 *
 * Enforces ADR-2026-05-19 Drift Pattern 3: screens MUST NOT carry
 * `useState<boolean|string|number>` or `useRef<boolean>` tracking
 * flow/phase position. Phase belongs to a parent reducer machine; the
 * screen renders as a match over machine state. Input-bound state
 * (TextInput value) is allow-listed by dataflow analysis.
 *
 * These cases ARE the spec — the implementation is driven by making
 * them pass (outside-in TDD).
 */
import { Linter } from "eslint";
import { RuleTester } from "@typescript-eslint/rule-tester";
import tseslintParser from "@typescript-eslint/parser";
import { afterAll, describe, it, expect } from "vitest";

import { rule } from "../src/rules/no-screen-local-phase-state.js";

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

ruleTester.run("no-screen-local-phase-state", rule, {
  valid: [
    // valid 1: text-input bound string state is allow-listed via dataflow —
    // the variable flows into a JSX `value` attribute.
    {
      name: "useState<string> bound to TextInput value — allowed",
      filename: "/proj/src/screens/SearchScreen.tsx",
      code: `
        function SearchScreen() {
          const [query, setQuery] = useState<string>('');
          return <TextInput value={query} onChangeText={setQuery} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 2: useState with non-primitive type — passes.
    {
      name: "useState<MyEnum> — non-primitive, not phase-shaped",
      filename: "/proj/src/screens/Component.tsx",
      code: `
        function Component() {
          const [view, setView] = useState<View | null>(null);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 3: useRef with non-boolean type — passes.
    {
      name: "useRef<View> — DOM-like ref, allowed",
      filename: "/proj/src/screens/Component.tsx",
      code: `
        function Component() {
          const ref = useRef<View>(null);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 5: inferred string useState used as input value — allowed.
    {
      name: "inferred useState('') bound to TextInput.defaultValue — allowed",
      filename: "/proj/src/screens/Form.tsx",
      code: `
        function Form() {
          const [name, setName] = useState('');
          return <TextInput defaultValue={name} onChangeText={setName} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
  ],
  invalid: [
    // invalid 1: explicit useState<boolean> — flagged.
    {
      name: "useState<boolean> phase flag — flagged",
      filename: "/proj/src/screens/CreditScreen.tsx",
      code: `
        function CreditScreen() {
          const [inFlight, setInFlight] = useState<boolean>(false);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "screenLocalPhaseState" }],
    },
    // invalid 2: inferred boolean useState — flagged.
    {
      name: "useState(false) inferred boolean — flagged",
      filename: "/proj/src/screens/CreditScreen.tsx",
      code: `
        function CreditScreen() {
          const [inFlight, setInFlight] = useState(false);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "screenLocalPhaseState" }],
    },
    // invalid 3: useRef<boolean>(false) phase flag — flagged.
    {
      name: "useRef<boolean>(false) phase guard — flagged",
      filename: "/proj/src/screens/CreditScreen.tsx",
      code: `
        function CreditScreen() {
          const guarded = useRef<boolean>(false);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "screenLocalPhaseRef" }],
    },
    // invalid 4: string useState NOT used as input value — flagged.
    {
      name: "useState<string> not bound to input — flagged",
      filename: "/proj/src/screens/Component.tsx",
      code: `
        function Component() {
          const [phase, setPhase] = useState<string>('idle');
          return <Text>{phase}</Text>;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "screenLocalPhaseState" }],
    },
    // invalid 6: number useState — flagged.
    {
      name: "useState<number> counter-shaped phase — flagged",
      filename: "/proj/src/screens/Component.tsx",
      code: `
        function Component() {
          const [step, setStep] = useState<number>(0);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [{ messageId: "screenLocalPhaseState" }],
    },
  ],
});

/**
 * Disable-comment reason discipline. Driven through ESLint's `Linter`
 * directly because RuleTester registers the rule under `@rule-tester/*`,
 * which breaks disable-directive resolution. Linter lets us register
 * the rule under its production-qualified name (`effect-locality/*`)
 * so the disable comments parse correctly.
 */
describe("no-screen-local-phase-state — disable-comment reason discipline", () => {
  function lint(code: string): Linter.LintMessage[] {
    const linter = new Linter({ cwd: "/proj" });
    const config: Linter.Config = {
      files: ["**/*.tsx", "**/*.ts"],
      languageOptions: {
        // The parser cast routes around a typing mismatch between
        // ESLint's `Linter.Parser` shape and the @typescript-eslint
        // parser's export; runtime behaviour is unaffected.
        parser: tseslintParser as unknown as Linter.Config["languageOptions"] extends { parser?: infer P } ? P : never,
        parserOptions: {
          ecmaVersion: 2022,
          sourceType: "module",
          ecmaFeatures: { jsx: true },
        },
      },
      plugins: {
        "effect-locality": {
          rules: { "no-screen-local-phase-state": rule as never },
        },
      },
      rules: {
        "effect-locality/no-screen-local-phase-state": ["error", {}],
      },
    };
    return linter.verify(code, [config], "/proj/src/screens/X.tsx");
  }

  it("disable comment with `-- reason` is silent", () => {
    const code = `
      function Component() {
        // eslint-disable-next-line effect-locality/no-screen-local-phase-state -- bridging legacy boolean toggle; tracked in pebble mtm-foo
        const [open, setOpen] = useState<boolean>(false);
        return null;
      }
    `;
    const msgs = lint(code);
    expect(msgs, "reasoned disable suppresses primary + passes reason scan").toEqual([]);
  });

  it("bare disable (no reason) fires missingDisableReason on the comment", () => {
    const code = `
      function Component() {
        // eslint-disable-next-line effect-locality/no-screen-local-phase-state
        const [open, setOpen] = useState<boolean>(false);
        return null;
      }
    `;
    const msgs = lint(code);
    // ESLint suppresses the primary screenLocalPhaseState; the
    // rule's own comment scan emits missingDisableReason on the
    // disable line.
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.messageId).toBe("missingDisableReason");
  });
});
