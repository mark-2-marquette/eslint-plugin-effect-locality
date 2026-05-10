// Self-linting configuration for eslint-plugin-fp-discipline.
//
// Two layers:
//   1. typescript-eslint's recommended-typed config for general TS hygiene.
//   2. The plugin's own `single-owner-effectful-symbol` rule, applied to the
//      plugin's source. The catalogue is empty here because the plugin itself
//      has no resource-mediated APIs to police; this is a smoke test that the
//      rule loads and runs cleanly against its own code.
// Note: this config imports the built plugin from `./dist`. Run `npm run build`
// (which `npm run lint` does for you) before invoking eslint directly.
import tseslint from "typescript-eslint";
import fpDiscipline from "./dist/index.js";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    plugins: {
      "fp-discipline": fpDiscipline,
    },
    rules: {
      "fp-discipline/single-owner-effectful-symbol": [
        "error",
        {
          // The plugin source has no project-internal effectful symbols to
          // single-source. This empty catalogue is the smoke test: the rule
          // loads, runs, and produces zero warnings against itself.
          effectfulSymbols: [],
        },
      ],
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
      },
    },
    rules: {
      // Test files routinely use type assertions and unused vars in fixture code.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
