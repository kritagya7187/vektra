const tseslint = require('typescript-eslint');
const eslintConfigPrettier = require('eslint-config-prettier');

// Flat ESLint config (ESLint 9 / typescript-eslint 8).
//
// Type-aware rules (recommendedTypeChecked) require parserOptions.project,
// which only resolves files actually covered by tsconfig.json's "include"
// (src/**/*.ts). They are therefore applied via `extends` inside a block
// scoped with `files: ['src/**/*.ts']`, rather than spread at the top
// level — spreading them unscoped would apply type-aware parsing to root
// tooling config files like this one, which aren't part of the TS project
// and have no type information to check.
//
// `no-console: 'error'` implements the project rule "no console.log
// throughout the application except during startup" as a linted
// constraint rather than a convention that has to be remembered — it is
// then explicitly relaxed only for src/config, see the override below.
// src/server.ts is deliberately NOT exempted (Server Bootstrap
// subsystem): that exemption was written in Foundation, before the
// Logging subsystem existed, anticipating a chicken-and-egg problem with
// the logger that no longer exists — rootLogger is fully constructed and
// usable the instant server.ts runs, so it uses rootLogger for every
// startup/shutdown line like everything else in this codebase.
module.exports = tseslint.config(
  {
    // Ambient .d.ts files declare third-party surface (e.g. the untyped
    // @google/earthengine package) using patterns (unknown escape hatches,
    // no runtime code) that are normal for declaration files but would
    // otherwise trip the same rules application code is held to.
    ignores: ['dist/**', 'node_modules/**', '**/*.d.ts'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'warn',
    },
  },
  {
    // Environment validation must fail before the structured logger can be
    // constructed (its own log level comes from this validated config), so
    // this is the one place console output is legitimate outside startup.
    files: ['src/config/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // tests/ was previously outside eslint's file scope entirely (only
    // src/**/*.ts was covered) — added in the Testing subsystem, once
    // tests/ itself became a real deliverable needing "real verification:
    // TypeScript compilation, ESLint, Formatting" applied to it too.
    // Points at tsconfig.test.json (src + tests) rather than
    // tsconfig.json, which deliberately excludes tests/ from the
    // production build.
    files: ['tests/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Fixture/helper functions and inline test assertions are not held
      // to the same explicit-return-type discipline as application code
      // — the test itself is the specification, not a durable public API.
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    // supertest/superagent types Response.body as `any` by design (it
    // cannot know the shape of an arbitrary HTTP response body) — every
    // src/ file keeps the full no-unsafe-* ruleset unchanged; this is
    // scoped only to the one place in this codebase that legitimately
    // inspects an untyped HTTP response body.
    files: ['tests/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  eslintConfigPrettier,
);
