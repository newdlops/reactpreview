/**
 * Flat ESLint configuration that enforces readable TypeScript, documented public structure,
 * the 1,000-line hard limit, and dependency direction between architectural layers.
 */
import eslint from '@eslint/js';
import jsdoc from 'eslint-plugin-jsdoc';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const typescriptFiles = [
  'examples/**/*.tsx',
  'src/**/*.ts',
  'src/**/*.tsx',
  'test/**/*.ts',
  'test/**/*.tsx',
  'vitest.config.ts',
];

/**
 * Restricts a typescript-eslint shared config to TypeScript files so its type-aware rules do not
 * accidentally run against build scripts and other plain JavaScript configuration files.
 *
 * @param {import('eslint').Linter.Config} config Shared flat configuration to scope.
 * @returns {import('eslint').Linter.Config} Equivalent configuration with a TypeScript file glob.
 */
function scopeToTypeScript(config) {
  return { ...config, files: typescriptFiles };
}

export default tseslint.config(
  {
    ignores: ['.codeidx/**', '.tmp/**', 'coverage/**', 'dist/**', 'node_modules/**', '*.vsix'],
  },
  {
    ...eslint.configs.recommended,
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
      sourceType: 'module',
    },
    rules: {
      'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }],
    },
  },
  ...tseslint.configs.strictTypeChecked.map(scopeToTypeScript),
  ...tseslint.configs.stylisticTypeChecked.map(scopeToTypeScript),
  {
    files: typescriptFiles,
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      jsdoc,
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      'jsdoc/require-description': 'error',
      'jsdoc/require-jsdoc': [
        'error',
        {
          require: {
            ArrowFunctionExpression: false,
            ClassDeclaration: true,
            ClassExpression: true,
            FunctionDeclaration: true,
            FunctionExpression: false,
            MethodDefinition: true,
          },
        },
      ],
      'max-lines': ['error', { max: 1000, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['esbuild', 'vscode'],
          patterns: [
            {
              group: ['**/adapters/**', '**/application/**', '**/presentation/**'],
              message: 'Domain code must remain independent from outer architectural layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['esbuild', 'vscode'],
          patterns: [
            {
              group: ['**/adapters/**', '**/application/**', '**/domain/**', '**/presentation/**'],
              message: 'Shared utilities must remain independent from architectural layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['esbuild', 'vscode'],
          patterns: [
            {
              group: ['**/adapters/**', '**/presentation/**'],
              message: 'Application code may depend only on domain types and application ports.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/presentation/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/adapters/**'],
              message: 'Presentation code receives adapters through dependency injection.',
            },
          ],
        },
      ],
    },
  },
);
