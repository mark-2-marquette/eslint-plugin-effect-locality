# Changelog

All notable changes to `eslint-plugin-effect-locality` will be documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0]

### Added

Three new rules enforcing the React state-discipline ADR
(mtm/docs/decisions/2026-05-19-frontend-state-discipline-is-idiomatic-react.md).
Each is a structural lint for one drift pattern; together they
foreclose the parallel-state / imperative-effect-trigger / screen-
local-phase shapes that combine to produce silent-fail UI bugs
(motivating case: mtm's 09_onboarding CreditScreen "Let's go!"
silent-fail on 2026-05-19).

- `no-screen-local-phase-state` (Drift Pattern 3): forbids
  `useState<boolean|string|number>` and `useRef<boolean>(...)` in
  flow-bearing screen files. Phase belongs to a parent reducer
  machine; the screen renders as a match over machine state.
  Catches both explicit `useState<boolean>(false)` and the
  literal-inferred `useState(false)`. Input-bound state is
  allow-listed via dataflow: identifiers referenced as the
  expression of a JSX `value` / `defaultValue` attribute are
  treated as input bindings and not flagged. Per-line opt-out via
  `// eslint-disable-next-line ... -- <reason>`; the rule's own
  comment scan reports `missingDisableReason` on bare disables to
  enforce the reason discipline.

  Options: `inputBindingAttrs?: string[]` (default
  `["value","defaultValue"]`), `forbiddenStateTypes?: string[]`
  (default `["boolean","string","number"]`),
  `forbiddenRefTypes?: string[]` (default `["boolean"]`).

  Consumer scopes the rule via flat-config `files:` globs (one
  block for `src/screens/**`, etc.); the rule itself does not
  hardcode any project layout.

- `prefer-tagged-union-state` (Drift Pattern 1): flags the
  parallel-state shape — a component containing
  `useState<boolean>` AND `useState<Error | null>` AND/OR
  `useState<T | null>(null)`. Suggests refactor to a `useReducer`
  with a `{ phase: 'idle' | 'loading' | 'error' | 'success' }`
  tagged-union state. Heuristic shape-detection, not
  type-checker-driven: false positives are addressed via
  per-line disable comment + reason.

  Options: `errorTypeNames?: string[]` (default `["Error"]`).

- `no-imperative-effect-trigger` (Drift Pattern 2): flags JSX
  event-handler attributes (matching `^on[A-Z]` by default) whose
  inline function body contains `await` OR a `.then(...)` chain on
  an async call. Dispatch-only handlers, sync handlers, and
  identifier-bound handlers (out of scope; reviewed at definition
  site) are silent.

  Options: `handlerNamePattern?: string` (default `"^on[A-Z]"`).

  Suggested refactor: `onPress={() => dispatch({type:'X_TAPPED'})}`
  + `useEffect(() => { if (state.phase === 'X-ing') { ... } },
  [state.phase, ...])`.

### Notes

- Each new rule is independently configurable; consumers can adopt
  one without the others. Severity is the consumer's decision —
  ADR-2026-05-19 calls for ERROR, but during the per-surface
  extract phase the ADR explicitly tolerates WARN until the
  existing-code violations are driven to zero. The flip to ERROR
  is a follow-up pebble.

- Index now exports five rules (alphabetised:
  no-imperative-effect-trigger, no-orphan-fallible-effect,
  no-screen-local-phase-state, prefer-tagged-union-state,
  single-owner-effectful-symbol).

## [0.2.0]

### Added

- `no-orphan-fallible-effect` rule: catches the fire-and-forget
  `useEffect(() => { f().then(setX) }, [])` antipattern when the state
  has a `failed` / `error` variant and no other code path in the
  component can write to the setter. Drives the stuck-on-failure class
  of bugs (motivating case: `mobile/App.tsx:148-178` `ConfigGate` in
  mtm-mobile, where a `/pricing` network blip permanently strands the
  app on the failure screen).

  Heuristic, name-pattern matching:
  - `useEffect` with exactly two args, second being `[]`.
  - Setter is the destructured second element of a `useState<T>(...)`.
  - `T`'s top-level type-reference name is in `errorTagCatalogue`
    (default `["RemoteData"]`).
  - Setter has zero references outside the effect's callback.

  Options: `errorTagCatalogue: string[]`,
  `setterPattern: string` (regex, default `"^set[A-Z]"`),
  `retryTriggers: string[]` (reserved for forward-compat).

  No type-checker dependency; works without `parserOptions.project`.

### Changed (BREAKING — pre-1.0)

- `allowList` is now a *positive ownership declaration*: listed files
  occupy ownership slots up-front and never warn, regardless of ESLint's
  file-visitation order. Non-listed callers of the symbol compete for
  whatever slots remain (typically zero when `maxOwners` defaults to 1).
  The previous semantic — listed files were "exempt from the check" but
  did not consume a slot — turned `allowList` into a no-op for the
  common case where the goal is to designate a single canonical owner
  and warn on everyone else. The new semantic is what consumers
  intuitively expect from "this file is allowed to do this."
- Widened peer dependency to include ESLint 10.x; added `prepare`
  script and `default` exports condition so the plugin installs and
  loads cleanly via `github:`-style installs from a CommonJS config.

### Added (in this delta)

- New test case "allowList ownership is order-independent" verifies a
  sanctioned owner stays silent even when ESLint visits a non-owner
  first and pollutes the registry.

## [0.1.0] — 2026-05-10

Initial release.

### Added

- `single-owner-effectful-symbol` rule: warns when more than `maxOwners`
  distinct files in an ESLint run call a configured effectful symbol.
  Supports qualified-name patterns of the form `AsyncStorage.setItem`,
  `messaging().requestPermission`, `firebase().auth().signInAnonymously`.
  Per-pattern `maxOwners` (default 1) and `allowList` (absolute file paths
  exempt from the count).
- Project scaffolding: TypeScript strict mode, vitest, self-linting via
  the plugin's own rule against its own source, MIT license.
- Roadmap for deferred rules (`single-source-of-truth-for-state`,
  `command-query-separation`, `referential-transparency`, `idempotency`,
  `no-hidden-mutation`) documented in the README.

### Known limitations

- Cross-file aggregation is order-dependent: whichever file ESLint visits
  first becomes the sanctioned owner. Use `allowList` to pin ownership.
- The registry is process-local; ESLint's parallel workers each have their
  own copy. A companion project-level CLI is planned.
- Editor integrations that re-lint a single buffer will not see warnings
  from competing owners on disk; run a full project lint.

[0.3.0]: https://example.invalid/eslint-plugin-effect-locality/releases/tag/v0.3.0
[0.2.0]: https://example.invalid/eslint-plugin-effect-locality/releases/tag/v0.2.0
[0.1.0]: https://example.invalid/eslint-plugin-effect-locality/releases/tag/v0.1.0
