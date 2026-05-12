# Changelog

All notable changes to `eslint-plugin-effect-locality` will be documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[0.2.0]: https://example.invalid/eslint-plugin-effect-locality/releases/tag/v0.2.0
[0.1.0]: https://example.invalid/eslint-plugin-effect-locality/releases/tag/v0.1.0
