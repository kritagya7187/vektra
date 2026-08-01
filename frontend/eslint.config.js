import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

// Flat ESLint config, mirroring backend/eslint.config.js's structure and
// severity choices exactly (same typescript-eslint/prettier versions,
// same `no-unused-vars` argsIgnorePattern convention) — this is a
// browser client, not a Node service, so `no-console` is not enforced
// the same way (there is no "startup logging" exemption concept here,
// and console.warn/error are the only diagnostic channel available in a
// browser without inventing a logging backend, which is out of scope).
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'warn',
    },
  },
  {
    files: ['tests/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.test.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  {
    files: ['*.config.ts', '*.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  eslintConfigPrettier,
);
