import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        // Type-aware linting: let typescript-eslint resolve each file's program
        // from the nearest tsconfig so rules like `no-floating-promises` work.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Test files: relax two type-checked rules that fire almost exclusively on
    // idiomatic test constructs and carry no correctness signal there:
    // - `require-await`: Vitest/Testing-Library mocks are written `async () => …`
    //   to match the async wrapper's signature even when the body has no `await`.
    // - `no-unsafe-*`: reading `mock.calls[i]` (typed `any`) to assert on captured
    //   arguments is standard and safe. Production code keeps both rules strict.
    files: ['src/**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // The flat-config file itself is plain JS outside the TS program; disable the
    // type-checked rules for it so the whole lint run stays type-aware elsewhere.
    files: ['eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
  },
)
