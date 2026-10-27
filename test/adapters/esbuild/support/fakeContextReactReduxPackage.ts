/**
 * Installs a small project-owned react-redux package whose Provider and hooks use React Context.
 * Unlike the module-scoped fake, nested Providers resolve to the nearest store, which the Redux
 * overlay boundary relies on when it re-provides an application store below the app's Provider.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes the Context-backed fake beneath an isolated target project.
 *
 * @param projectRoot Temporary package root that should own react-redux.
 * @returns Promise resolved after the fake package files have been written.
 */
export async function installFakeContextReactReduxPackage(projectRoot: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules', 'react-redux');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        exports: './index.js',
        module: './index.js',
        name: 'react-redux',
        type: 'module',
      }),
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      [
        "import * as React from 'react';",
        '/** Context carrying the nearest store, as in React Redux. */',
        'export const ReactReduxContext = React.createContext(null);',
        '/** Provides one store to descendants through Context. */',
        'export function Provider({ children, store }) {',
        '  return React.createElement(ReactReduxContext.Provider, { value: { store } }, children);',
        '}',
        '/** Returns the nearest store or reproduces the missing-context error. */',
        'export function useStore() {',
        '  const context = React.useContext(ReactReduxContext);',
        "  if (context === null) throw new Error('could not find react-redux context value');",
        '  return context.store;',
        '}',
        '/** Selects from the nearest store state. */',
        'export function useSelector(selector) {',
        '  return selector(useStore().getState());',
        '}',
        '/** Returns the nearest store dispatch. */',
        'export function useDispatch() {',
        '  return useStore().dispatch;',
        '}',
      ].join('\n'),
      'utf8',
    ),
  ]);
}
