# Changelog

All notable changes to `eslint-plugin-effect-locality` will be documented in
this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://example.invalid/eslint-plugin-effect-locality/releases/tag/v0.1.0
