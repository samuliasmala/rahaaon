import js from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import nodePlugin from "eslint-plugin-n";
import playwright from "eslint-plugin-playwright";
import prettierPlugin from "eslint-plugin-prettier";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import security from "eslint-plugin-security";
import turbo from "eslint-plugin-turbo";
import unicorn from "eslint-plugin-unicorn";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

const WEB_SRC = "apps/web/src/**/*.{ts,tsx}";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/blob-report/**",
      "**/*.gen.ts",
      "**/routeTree.gen.ts",
      "apps/web/src/api/**",
    ],
  },

  // 01 — base layer: core correctness, import hygiene, unused code, Node compat, Prettier
  js.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    plugins: {
      "import-x": importX,
      n: nodePlugin,
      prettier: prettierPlugin,
      turbo,
      unicorn,
      "unused-imports": unusedImports,
    },
    settings: {
      "import-x/internal-regex": "^@rahaaon/",
      "import-x/resolver-next": [createTypeScriptImportResolver()],
      n: { version: ">=24.0.0" },
    },
    rules: {
      "prefer-const": "warn",
      "no-debugger": "warn",
      "no-console": "warn",
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "object-shorthand": "warn",
      "no-unneeded-ternary": "warn",

      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            ["parent", "sibling", "index"],
            "object",
            "type",
          ],
          "newlines-between": "never",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/newline-after-import": "warn",
      "import-x/first": "warn",
      "import-x/no-duplicates": "warn",
      "import-x/no-useless-path-segments": "warn",
      "import-x/no-dynamic-require": "error",
      "import-x/no-absolute-path": "error",
      "import-x/no-self-import": "error",
      "import-x/no-cycle": ["warn", { maxDepth: 3 }],

      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "warn",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      "n/no-unsupported-features/es-syntax": ["error", { ignores: ["modules", "dynamicImport"] }],
      "n/no-deprecated-api": "error",
      "n/prefer-node-protocol": "warn",

      "prettier/prettier": "warn",

      "turbo/no-undeclared-env-vars": "warn",

      "unicorn/no-abusive-eslint-disable": "error",
      "unicorn/throw-new-error": "warn",
      "unicorn/no-useless-promise-resolve-reject": "warn",
    },
  },

  // 02 — TypeScript, type-aware, scoped to TS files
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ["**/*.{ts,tsx}"],
  })),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false, arguments: false } },
      ],
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/consistent-type-imports": ["warn", { fixStyle: "inline-type-imports" }],
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/require-await": "warn",
      "@typescript-eslint/restrict-plus-operands": "warn",
      // unused-imports/no-unused-vars owns unused-code reporting (auto-fixable imports)
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // 03 — React (Vite SPA): core, hooks, a11y, fast refresh
  {
    files: [WEB_SRC],
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      "react/jsx-key": ["warn", { checkFragmentShorthand: true }],
      "react/no-unstable-nested-components": "warn",
      "react/self-closing-comp": "warn",
      "react/jsx-no-useless-fragment": ["warn", { allowExpressions: true }],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: [WEB_SRC],
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // Dialogs focus their first field on purpose — expected behaviour there.
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    ...reactRefresh.configs.vite,
    files: [WEB_SRC],
    rules: {
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },

  // 06 — Tailwind CSS class-string hygiene
  {
    files: [WEB_SRC],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        entryPoint: `${import.meta.dirname}/apps/web/src/styles/globals.css`,
      },
    },
    rules: {
      ...betterTailwindcss.configs.recommended.rules,
      "better-tailwindcss/no-unknown-classes": "warn",
      "better-tailwindcss/no-conflicting-classes": "warn",
      // multiline class wrapping fights Prettier; formatting stays Prettier's job
      "better-tailwindcss/enforce-consistent-line-wrapping": "off",
    },
  },

  // 05 — Node backend: security lint
  {
    ...security.configs.recommended,
    files: ["apps/api/src/**/*.ts"],
    rules: {
      ...security.configs.recommended.rules,
      "security/detect-eval-with-expression": "error",
      // Flags every computed key (`arr[i]`, `col[field]`) — all hits here are
      // TS-typed loop indices or static-map lookups, never user-controlled.
      "security/detect-object-injection": "off",
    },
  },

  // 07 — testing: Playwright (e2e)
  {
    ...playwright.configs["flat/recommended"],
    files: ["apps/web/e2e/**/*.ts"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      // loginAsAdmin asserts the admin heading — count it as an assertion.
      "playwright/expect-expect": ["warn", { assertFunctionNames: ["loginAsAdmin"] }],
    },
  },

  // 07 — testing: Vitest (unit)
  {
    files: ["**/*.test.{ts,tsx}", "apps/web/src/test/**/*.{ts,tsx}"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/expect-expect": "warn",
    },
  },

  {
    // TanStack Router uses `throw redirect(...)` / `throw notFound()` as control
    // flow in route loaders — these are framework signals, not Error objects.
    // File routes export only `Route` and keep components local, so the
    // react-refresh heuristic can never pass; the router's own Vite plugin
    // handles HMR for these files.
    files: ["apps/web/src/routes/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/only-throw-error": "off",
      "react-refresh/only-export-components": "off",
    },
  },
  {
    // CLI entry points log to the console by design.
    files: [
      "apps/api/src/db/seed.ts",
      "apps/api/src/db/migrate.ts",
      "apps/api/src/db/set-admin-password.ts",
      "apps/api/src/openapi-export.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Config / script files run without the full type-checked program.
    files: ["**/*.config.{js,ts}", "**/*.config.*.{js,ts}"],
    ...tseslint.configs.disableTypeChecked,
  },

  // Prettier last — disables conflicting formatting rules
  prettierConfig,
);
