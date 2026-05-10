/**
 * Tests for `single-owner-effectful-symbol`.
 *
 * The rule's spec is cross-file: it warns at the second (and later) call site
 * of a configured effectful symbol within an ESLint run. RuleTester evaluates
 * each test case in isolation, so cross-file behaviour is exercised directly
 * with the ESLint Linter API in addition to single-file RuleTester cases.
 *
 * Outside-in: these cases ARE the spec. The rule implementation is driven by
 * making them pass.
 */
import { Linter } from "eslint";
import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, beforeEach, describe, it, expect } from "vitest";

import {
  rule,
  resetRegistryForTests,
} from "../src/rules/single-owner-effectful-symbol.js";

// `@typescript-eslint/rule-tester` expects test-runner globals to be wired up.
RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

const ruleTester = new RuleTester();

const NOTIFEE_CATALOG = [
  { pattern: "messaging().requestPermission" },
];

// Reset registry before every test in this file, so RuleTester cases don't
// leak state into one another.
beforeEach(() => {
  resetRegistryForTests();
});

describe("single-owner-effectful-symbol — single-file matching", () => {
  ruleTester.run("single-owner-effectful-symbol", rule, {
    valid: [
      {
        name: "no catalogued call — clean",
        code: `import { messaging } from 'fake'; const x = 1; void x;`,
        options: [{ effectfulSymbols: NOTIFEE_CATALOG }],
      },
      {
        name: "single owner — clean",
        code: `import { messaging } from 'fake'; messaging().requestPermission();`,
        filename: "/proj/src/only-owner.ts",
        options: [{ effectfulSymbols: NOTIFEE_CATALOG }],
      },
      {
        name: "empty catalog — no-op",
        code: `import { messaging } from 'fake'; messaging().requestPermission();`,
        options: [{ effectfulSymbols: [] }],
      },
      {
        name: "AsyncStorage.setItem single owner — clean",
        code: `import AsyncStorage from 'fake'; AsyncStorage.setItem('k', 'v');`,
        filename: "/proj/src/store-owner.ts",
        options: [
          { effectfulSymbols: [{ pattern: "AsyncStorage.setItem" }] },
        ],
      },
    ],
    invalid: [],
  });
});

/**
 * Cross-file behaviour. Uses `Linter` directly because RuleTester treats each
 * case as an isolated lint, but the rule's whole point is order-of-files
 * aggregation.
 */
describe("single-owner-effectful-symbol — cross-file aggregation", () => {
  function lint(
    linter: Linter,
    code: string,
    filename: string,
    options: unknown,
  ): Linter.LintMessage[] {
    const config: Linter.Config = {
      files: ["**/*.ts", "**/*.js"],
      plugins: {
        "fp-discipline": {
          // The rule object is structurally compatible with eslint's Rule.RuleModule.
          rules: { "single-owner-effectful-symbol": rule as never },
        },
      },
      languageOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      rules: {
        "fp-discipline/single-owner-effectful-symbol": ["error", options],
      },
    };
    return linter.verify(code, [config], filename);
  }

  function makeLinter(): Linter {
    return new Linter({ cwd: "/proj" });
  }

  it("first owner is clean, second owner is warned", () => {
    const linter = makeLinter();
    const opts = { effectfulSymbols: NOTIFEE_CATALOG };

    const a = lint(
      linter,
      `import { messaging } from 'fake'; messaging().requestPermission();`,
      "/proj/src/A.ts",
      opts,
    );
    expect(a, "first owner should be clean").toEqual([]);

    const b = lint(
      linter,
      `import { messaging } from 'fake'; messaging().requestPermission();`,
      "/proj/src/B.ts",
      opts,
    );
    expect(b).toHaveLength(1);
    expect(b[0]?.messageId).toBe("tooManyOwners");
    expect(b[0]?.message).toContain("messaging().requestPermission");
  });

  it("allowList exempts a file from being a competing owner", () => {
    const linter = makeLinter();
    const opts = {
      effectfulSymbols: [
        {
          pattern: "messaging().requestPermission",
          allowList: ["/proj/src/B.ts"],
        },
      ],
    };

    const a = lint(
      linter,
      `import { messaging } from 'fake'; messaging().requestPermission();`,
      "/proj/src/A.ts",
      opts,
    );
    expect(a).toEqual([]);

    const b = lint(
      linter,
      `import { messaging } from 'fake'; messaging().requestPermission();`,
      "/proj/src/B.ts",
      opts,
    );
    expect(b, "allow-listed file should not be warned").toEqual([]);
  });

  it("maxOwners: 2 permits two owners and warns at the third", () => {
    const linter = makeLinter();
    const opts = {
      effectfulSymbols: [
        { pattern: "messaging().requestPermission", maxOwners: 2 },
      ],
    };

    for (const path of ["/proj/src/A.ts", "/proj/src/B.ts"]) {
      const msgs = lint(
        linter,
        `import { messaging } from 'fake'; messaging().requestPermission();`,
        path,
        opts,
      );
      expect(msgs, `owner ${path} should be permitted`).toEqual([]);
    }

    const c = lint(
      linter,
      `import { messaging } from 'fake'; messaging().requestPermission();`,
      "/proj/src/C.ts",
      opts,
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.messageId).toBe("tooManyOwners");
  });

  it("multiple call sites within the same file count as one owner", () => {
    const linter = makeLinter();
    const opts = { effectfulSymbols: NOTIFEE_CATALOG };

    const a = lint(
      linter,
      `import { messaging } from 'fake';
       messaging().requestPermission();
       messaging().requestPermission();`,
      "/proj/src/A.ts",
      opts,
    );
    expect(a, "same-file repeats are not flagged by this rule").toEqual([]);
  });

  it("AsyncStorage.setItem pattern matches plain MemberExpression callees across files", () => {
    const linter = makeLinter();
    const opts = {
      effectfulSymbols: [{ pattern: "AsyncStorage.setItem" }],
    };

    const a = lint(
      linter,
      `import AsyncStorage from 'fake'; AsyncStorage.setItem('k', 'v');`,
      "/proj/src/A.ts",
      opts,
    );
    expect(a).toEqual([]);

    const b = lint(
      linter,
      `import AsyncStorage from 'fake'; AsyncStorage.setItem('k', 'v2');`,
      "/proj/src/B.ts",
      opts,
    );
    expect(b).toHaveLength(1);
    expect(b[0]?.messageId).toBe("tooManyOwners");
  });

  it("unrelated calls don't pollute the registry", () => {
    const linter = makeLinter();
    const opts = { effectfulSymbols: NOTIFEE_CATALOG };

    const a = lint(
      linter,
      `console.log('hi'); Math.random();`,
      "/proj/src/A.ts",
      opts,
    );
    expect(a).toEqual([]);

    const b = lint(
      linter,
      `import { messaging } from 'fake'; messaging().requestPermission();`,
      "/proj/src/B.ts",
      opts,
    );
    expect(b, "B is now the first owner").toEqual([]);
  });
});
