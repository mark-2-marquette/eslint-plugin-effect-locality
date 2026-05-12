/**
 * Tests for `no-orphan-fallible-effect`.
 *
 * The rule catches the fire-and-forget `useEffect(() => { f().then(setX) }, [])`
 * antipattern when `setX` holds a fallible state (RemoteData-shaped or any state
 * whose type name appears in the configured `errorTagCatalogue`) AND nothing
 * else in the enclosing component writes to `setX`. The motivating case is
 * `mobile/App.tsx:148-178` (`ConfigGate`) in the mtm-mobile codebase: a mount-
 * once effect that, on failure, leaves the component permanently stuck because
 * no other code path can call `setState` to retry.
 *
 * These cases ARE the spec — the rule implementation is driven by making them
 * pass (outside-in TDD).
 */
import { RuleTester } from "@typescript-eslint/rule-tester";
import { afterAll, describe, it } from "vitest";

import { rule } from "../src/rules/no-orphan-fallible-effect.js";

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.describe = describe;

// We lint TSX-shaped React component fixtures, so JSX must be enabled.
const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: { jsx: true },
    },
  },
});

const DEFAULT_OPTIONS = [{}] as const;

ruleTester.run("no-orphan-fallible-effect", rule, {
  valid: [
    // valid 1: a retry trigger elsewhere in the component (useAppStateBecameActive)
    // writes the setter on foreground, so the effect is not an orphan.
    {
      name: "useAppStateBecameActive resets and re-runs — has a retry path",
      filename: "/proj/Component.tsx",
      code: `
        function Component() {
          const [state, setState] = useState<RemoteData<T, E>>({ status: 'loading' });
          useAppStateBecameActive(() => {
            setState({ status: 'loading' });
            f().then(setState);
          });
          useEffect(() => {
            f().then(setState);
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 2: state is a primitive boolean — no `failed`/`error` variant, not
    // a RemoteData-shaped type, so even though the effect is orphan-shaped it
    // doesn't have a stuck-on-failure failure mode.
    {
      name: "state type has no failed variant — not fallible",
      filename: "/proj/Component.tsx",
      code: `
        function Component() {
          const [ready, setReady] = useState<boolean>(false);
          useEffect(() => {
            f().then(setReady);
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 3: a Button onPress in the render writes the setter — a manual
    // retry path exists.
    {
      name: "JSX event handler writes the setter — manual retry exists",
      filename: "/proj/Component.tsx",
      code: `
        function Component() {
          const [state, setState] = useState<RemoteData<T, E>>({ status: 'loading' });
          useEffect(() => {
            f().then(setState);
          }, []);
          return <Button onPress={() => { setState({ status: 'loading' }); }} />;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // valid 4: non-empty deps — the effect WILL re-run when `trigger` changes.
    {
      name: "non-empty deps — effect can re-run",
      filename: "/proj/Component.tsx",
      code: `
        function Component({ trigger }: { trigger: number }) {
          const [state, setState] = useState<RemoteData<T, E>>({ status: 'loading' });
          useEffect(() => {
            f().then(setState);
          }, [trigger]);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // Additional valid: no useState — rule has nothing to bind to.
    {
      name: "setter is not a useState destructuring — out of scope",
      filename: "/proj/Component.tsx",
      code: `
        function Component({ setState }: { setState: (v: unknown) => void }) {
          useEffect(() => {
            f().then(setState);
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
    // Additional valid: useEffect with no setter call at all.
    {
      name: "useEffect without any setter call — out of scope",
      filename: "/proj/Component.tsx",
      code: `
        function Component() {
          useEffect(() => {
            console.log('mount');
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
    },
  ],
  invalid: [
    // invalid 1: the verbatim ConfigGate shape — useEffect(() => { f().then(setX) }, [])
    // with `setX` from useState<RemoteData<...>>.
    {
      name: "verbatim ConfigGate shape — direct .then(setState)",
      filename: "/proj/Component.tsx",
      code: `
        function Component() {
          const [state, setState] = useState<RemoteData<T, E>>({ status: 'loading' });
          useEffect(() => {
            f().then(setState);
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [
        {
          messageId: "orphanFallibleEffect",
          data: { setterName: "setState", stateTypeName: "RemoteData" },
        },
      ],
    },
    // invalid 2: await form — useEffect(() => { (async () => { setX(await f()) })() }, [])
    {
      name: "await form — IIFE inside useEffect awaits and writes setter",
      filename: "/proj/Component.tsx",
      code: `
        function Component() {
          const [state, setState] = useState<RemoteData<T, E>>({ status: 'loading' });
          useEffect(() => {
            (async () => {
              setState(await f());
            })();
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [
        {
          messageId: "orphanFallibleEffect",
          data: { setterName: "setState", stateTypeName: "RemoteData" },
        },
      ],
    },
    // Additional invalid: the REAL App.tsx:155 shape — .then with an inline
    // callback that calls setState (mounted-guarded). Semantically identical
    // orphan; acceptance criterion #4 in the pebble requires this to fire.
    {
      name: "mounted-guarded .then callback — App.tsx:155 shape",
      filename: "/proj/Component.tsx",
      code: `
        function ConfigGate({ children }: { children: React.ReactNode }) {
          const [state, setState] = useState<RemoteData<AppConfig, ConfigError>>({ status: 'loading' });
          useEffect(() => {
            let mounted = true;
            bootstrapConfig().then((result) => {
              if (!mounted) return;
              setState(result);
            });
            return () => { mounted = false; };
          }, []);
          return null;
        }
      `,
      options: DEFAULT_OPTIONS,
      errors: [
        {
          messageId: "orphanFallibleEffect",
          data: { setterName: "setState", stateTypeName: "RemoteData" },
        },
      ],
    },
  ],
});
