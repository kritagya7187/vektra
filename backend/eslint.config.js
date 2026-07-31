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
// then explicitly relaxed only for the files where startup actually
// happens (src/config, src/server.ts), see the override below.
module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
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
    files: ['src/config/**/*.ts', 'src/server.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  eslintConfigPrettier,
);
