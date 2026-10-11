// ESLint de backend y shared (el frontend usa `next lint` con su propia configuración).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'frontend/**', 'backend/scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['backend/src/**/*.ts', 'shared/src/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      // Un catch vacío esconde fallos (auditoría 10/10, B2): si se ignora a propósito, se dice por qué en un comentario.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // `any` prohibido salvo en boundaries de API externa (CLAUDE.md): ahí se marca con eslint-disable y motivo.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // Las consultas a Supabase viven en lib/db (CLAUDE.md). Aviso hasta la Ola 6, que las mueve.
    files: ['backend/src/routes/**/*.ts', 'backend/src/lib/**/*.ts'],
    ignores: ['backend/src/lib/db/**'],
    rules: {
      'no-restricted-syntax': ['warn', { selector: "CallExpression[callee.property.name='from'][callee.object.name!=/^(Array|Buffer|Object)$/][arguments.0.type='Literal']", message: 'Consulta a Supabase fuera de lib/db.' }],
    },
  },
  {
    files: ['**/__tests__/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
