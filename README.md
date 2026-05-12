# eslint-plugin-effect-locality

> **Working name.** This plugin's permanent name is unsettled. Candidates so
> far: `eslint-plugin-effect-locality` (current), `eslint-plugin-effect-locality`,
> `eslint-plugin-purity-by-policy`. The shipped name should reflect that this
> is a *policy enforcement* plugin where the project supplies the catalogue,
> not a fixed set of "FP rules". Open to suggestions; see the GitHub issues.

## Purpose

`eslint-plugin-effect-locality` enforces functional-programming discipline
around effectful APIs in TypeScript codebases. Specifically, it catches
violations that arise when resource-mediated effects (one-shot OS dialogs,
shared persistent storage, system settings panels) are invoked from more
than one module — the kind of bug that's invisible in code review but
manifests as ordering-dependent behaviour at runtime.

The catalogue of effectful symbols is **supplied by the consuming project**.
There is no built-in list. The plugin is useless without a catalogue, and
that's intentional: the catalogue is the project's policy declaration, the
record of which APIs the team has decided to treat as ownership-restricted.

## Background and citations

This plugin draws on three threads of FP literature, all of which converge
on the same insight: effects are dangerous when they're invisible.

- **Hughes, "Why Functional Programming Matters" (1990).** The case for
  separating computation from effect, and for making effect propagation
  explicit. <https://www.cs.kent.ac.uk/people/staff/dat/miranda/whyfp90.pdf>
- **Meyer, "Object-Oriented Software Construction" (1988), §23.1.** The
  command-query separation principle: a function either returns a value
  *or* mutates state, never both. Violations make reasoning about call
  order brittle.
- **"Single source of truth" (SSOT)** as it appears in distributed-systems
  literature and in Redux/Flux design (Abramov, 2015). One canonical
  authority for a piece of state; every other reader is a derived view.
  <https://redux.js.org/understanding/thinking-in-redux/three-principles>

The qualified-name matching mechanism is inspired by
[`react-x/purity`](https://www.eslint-react.xyz/docs/rules/purity)
([source](https://github.com/Rel1cx/eslint-react/blob/main/plugins/eslint-plugin-react-x/src/rules/purity/lib.ts),
MIT). We share their basic idea — match callees by structural-name patterns
like `Math.random` or `messaging().requestPermission` — but the
implementation here is independent and the catalogue is rule options, not a
hardcoded list. `react-x/purity` is scoped to the React render context;
this plugin is scoped to general TypeScript codebases.

## Not Power-of-10

This plugin is **not** a Power-of-10 / aspergillus rule. Power-of-10
([Holzmann, NASA/JPL, 2006](https://spinroot.com/gerard/pdf/P10.pdf)) and
its descendants address safety-critical embedded code: bounded loops, no
recursion, no dynamic allocation after init. Those rules are appropriate
when the cost of a bug is a deorbit. They are inappropriate for UI
applications where the cost of over-restriction is feature paralysis.

This plugin addresses a different problem class: *resource ownership
in UI/application code*. The motivating bug is the iOS notification
permission dialog, which the OS only presents once per install. If three
unrelated React components all call `messaging().requestPermission()`,
exactly one wins and the other two become silent no-ops. That's not a
memory-safety issue; it's a coordination issue. Power-of-10 would not
catch it. This plugin will.

## Motivating case

The mtm-mobile codebase had three peer call sites all invoking
`initializeNotifee()` (which transitively calls
`messaging().requestPermission()`):

- `mobile/App.tsx:92` — boot useEffect.
- `mobile/src/screens/onboarding/NotificationPermissionScreen.tsx:48` —
  the dedicated permission-grant screen.
- `mobile/src/components/panels/SettingsPanel.tsx:993` — Settings toggle.

iOS only honours the first `requestPermission` per install. At app boot,
Maestro's tap-through dismisses the dialog before the user reaches the
permission screen; by the time they get there, the system has cached
"denied". The dialog never appears in the place the UX was designed to
present it, and the Settings toggle silently does nothing.

This is a class of bug, not a one-off. `single-owner-effectful-symbol`
catches the whole class.

## Install

```sh
npm install --save-dev eslint-plugin-effect-locality
```

Peer dependency: `eslint` ^8.57.0 || ^9.0.0.

## Configure

ESLint flat config (`eslint.config.js`):

```js
import fpDiscipline from "eslint-plugin-effect-locality";

export default [
  {
    plugins: { "effect-locality": fpDiscipline },
    rules: {
      "effect-locality/single-owner-effectful-symbol": ["error", {
        effectfulSymbols: [
          {
            // The mtm-mobile motivating case, verbatim.
            pattern: "messaging().requestPermission",
            // Only one module should own the iOS permission dialog.
            maxOwners: 1,
            // The module designated to own it.
            allowList: [
              "/abs/path/to/mobile/src/screens/onboarding/NotificationPermissionScreen.tsx",
            ],
          },
          {
            pattern: "Linking.openSettings",
            maxOwners: 1,
          },
          {
            pattern: "AsyncStorage.setItem",
            // SSOT-by-key would be a separate rule; this catches sprawl
            // at the call-site level only. See roadmap.
            maxOwners: 3,
          },
        ],
      }],
    },
  },
];
```

The `allowList` entries are the absolute paths of files that are the
*sanctioned owners* of the symbol — typically resolved via your project's
build tooling. Listed files occupy ownership slots up-front, so they
never warn regardless of ESLint's file-visitation order. Files that are
*not* listed compete for whatever slots remain (typically zero, when
`maxOwners` defaults to 1 and the allowList names the one owner) and
are reported in visitation order once the budget is exhausted.

`allowList` is a positive ownership declaration, not a get-out-of-jail
card. Naming a file in the allowList is how the team declares "this is
the canonical place this effect lives"; everyone else becomes a
violation.

## Rules

### `no-orphan-fallible-effect`

Catches the fire-and-forget `useEffect(() => { f().then(setX) }, [])`
antipattern when the state has a `failed` / `error` variant and no other
code path in the component can write to the setter.

**Motivating case** (`mobile/App.tsx:148-178` in mtm-mobile):

```tsx
function ConfigGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<
    RemoteData<AppConfig, ConfigError>
  >({ status: 'loading' });

  useEffect(() => {
    let mounted = true;
    bootstrapConfig().then((result) => {
      if (!mounted) return;
      setState(result);
    });
    return () => { mounted = false; };
  }, []);

  if (state.status === 'failed') return <ConfigLoadFailedScreen />;
  // ...
}
```

When `bootstrapConfig()` fails (transient network blip, server hiccup),
`state` settles on `{ status: 'failed', ... }`. The empty-deps `useEffect`
ran exactly once at mount and will never re-run. Backgrounding +
foregrounding the app does not retry, because the `AppState` listener
lives on the success branch. The user is stuck on the failure screen
until full process kill — a class of stuck-state bugs that is invisible
in code review but reproduces under any flaky network.

**The rule fires when ALL of the following hold:**

1. `useEffect(callback, [])` — exactly two arguments, second is an empty
   array literal.
2. Inside the callback, the setter half of a `useState` destructuring is
   referenced (called directly, or passed to `.then` / `.catch`, or used
   inside an `await`-form IIFE).
3. The setter's `useState<T>(...)` type argument has a top-level type-
   reference name listed in `errorTagCatalogue` (default `["RemoteData"]`).
4. No reference to the setter exists *anywhere outside* the effect's
   callback within the same component — no event-handler `setX(...)`, no
   focus / foreground hook callback, no prop drill that ends in a call.

**Options:**

```ts
type Options = {
  // Type-reference names treated as fallible. The check is on the bare
  // top-level name; generic args are ignored. Default ["RemoteData"].
  errorTagCatalogue?: string[];
  // Regex (as a string) identifying setter names. Default "^set[A-Z]".
  setterPattern?: string;
  // Hook names that count as a retry trigger. Reserved for forward-compat;
  // v1 treats ANY non-effect writer as a retry path. Default:
  // ["useAppStateBecameActive", "useFocusEffect", "useInterval"].
  retryTriggers?: string[];
};
```

**Configure:**

```js
"effect-locality/no-orphan-fallible-effect": ["warn", {
  // Add project-specific async-result type names.
  errorTagCatalogue: ["RemoteData", "AsyncResult", "Loadable"],
}],
```

**Severity ramp.** Land at `warn`, drive existing violations to zero in
follow-up PRs, then flip to `error`. This matches the flow
`single-owner-effectful-symbol` followed.

**Out of scope for v1.** Type-aware analysis via `@typescript-eslint`'s
type checker is a deliberate non-goal: the rule matches type *names*, not
type *shapes*. A type-aware variant that walks the actual union members
of the state type (looking for `status: 'failed' | 'error' | 'errored'`)
is a follow-up; the name-pattern heuristic is sufficient to catch the
motivating case and similar shapes without depending on `parserOptions.project`.

### `single-owner-effectful-symbol`

Warns at every call site of a catalogued effectful symbol after the first
`maxOwners` distinct files have been seen during an ESLint run.

**Options:**

```ts
type SymbolSpec = {
  pattern: string;       // qualified-name pattern (see below)
  maxOwners?: number;    // default 1
  allowList?: string[];  // absolute file paths of sanctioned owners
                         // (occupy slots up-front; never warn)
};
type Options = { effectfulSymbols: SymbolSpec[] };
```

**Pattern syntax.** A pattern is a dot-joined sequence of segments. Each
segment is either:

- An identifier (`AsyncStorage`, `requestPermission`).
- An identifier followed by `()` to denote a call (`messaging()`).

The pattern matches the *callee* of a `CallExpression`. Examples:

| Pattern                              | Matches                                                |
|--------------------------------------|--------------------------------------------------------|
| `Math.random`                        | `Math.random(...)`                                     |
| `AsyncStorage.setItem`               | `AsyncStorage.setItem(...)`                            |
| `messaging().requestPermission`      | `messaging().requestPermission(...)`                   |
| `firebase().auth().signInAnonymously`| `firebase().auth().signInAnonymously(...)`             |

Callees that don't fit one of those shapes (computed property access,
optional chaining, `this.x()`, dynamic dispatch) won't match any pattern
and are silently ignored. That's by design: this rule polices declared
catalogue entries, not arbitrary indirection.

**Cross-file aggregation: limitation.** ESLint runs per file. The rule
maintains a process-level registry of `pattern -> ordered set of files`,
so within a single `eslint .` invocation it can report later owners.
But:

1. **Order-dependent in the absence of an `allowList`.** Whichever file
   ESLint visits first becomes the sanctioned owner. To pin ownership
   independent of visitation order, name the canonical file in
   `allowList` — listed files occupy slots up-front.
2. **Editor-integration blind spot.** When an editor re-lints a single
   open buffer, the registry only sees that one file. The rule will not
   fire even if other competing owners exist on disk. Run a full project
   lint (`eslint .`) to catch cross-file violations.
3. **Process-bound.** The registry lives in Node process memory. If you
   run ESLint with parallelism (`--concurrency`), each worker has its own
   registry; cross-file detection across workers is currently best-effort.

A future enhancement is a companion CLI tool that performs a true
project-wide pass and merges per-worker registries. For now, document and
ship.

## Roadmap (deferred rules)

These rules were identified in the design discussion but are deferred to
later cycles. They will need deeper machinery (effect annotations,
subscription bookkeeping, type-level analysis) and are intentionally not
shipped in 0.1.0.

### `single-source-of-truth-for-state`

Warn when more than one module *writes* to the same identified state key.
The motivating shape is AsyncStorage with a string key (`mtm_notifications_enabled`)
that gets written from settings, onboarding, and migration logic. The
violation is "this key has multiple authoritative writers and they will
race". Distinct from `single-owner-effectful-symbol` because the criterion
is the *key* (a string argument), not the call site.

### `command-query-separation`

Warn when a function has a non-`void` return type *and* its body contains
a call to a catalogue-listed effectful symbol. Implements Meyer's CQS at
the function-declaration level. Defers because it requires type
information (the typed-eslint flavour of rule, not just AST).

### `referential-transparency`

Warn when a function declared as `pure` (via JSDoc annotation, naming
convention, or directory placement) calls a catalogue-listed effectful
symbol. The hard part is what counts as "declared pure"; the easy part is
the call detection.

### `idempotency`

Warn when a function declared as `idempotent` calls a non-idempotent
effectful symbol. Requires the catalogue entries to declare their own
idempotency, which is a meaningful expansion of the schema.

### `no-hidden-mutation`

Warn when a function takes a parameter and mutates it (and that parameter
isn't typed `Mutable<T>` or similar). Fundamentally a type-system rule;
the AST signal is too noisy without type information.

## Development

```sh
npm install
npm run build       # tsc -> dist/
npm test            # vitest
npm run lint        # builds, then self-lints
npm run typecheck   # tsc --noEmit on src + tests
```

Outside-in TDD: tests at `tests/` are the spec. The rule
implementation is driven by making them pass.

## License

MIT.
