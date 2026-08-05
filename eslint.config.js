import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'data', 'coverage', 'work'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: { document: 'readonly', window: 'readonly', localStorage: 'readonly' } },
  },
  {
    files: ['server/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
