/**
 * Installs a tiny project-owned react-redux package for optional bridge fixtures.
 * Module-scoped store state makes Provider identity observable without adding Redux or React Redux
 * to the extension's own dependency graph.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Marker embedded into the fake Provider so tests can identify the resolved package instance. */
export const FAKE_REACT_REDUX_MARKER = 'PROJECT_OWNED_REACT_REDUX_MARKER';

/**
 * Writes a minimal ESM React Redux package beneath an isolated target project.
 * Provider and hooks share one current store, reproducing the package-identity requirement that
 * the real React Redux context imposes while remaining independent from a DOM renderer.
 *
 * @param projectRoot Temporary package root that should own react-redux.
 * @returns Promise resolved after the fake package files have been written.
 */
export async function installFakeReactReduxPackage(projectRoot: string): Promise<void> {
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
    writeFile(path.join(packageDirectory, 'index.js'), createFakePackageSource(), 'utf8'),
  ]);
}

/**
 * Creates the dependency-free browser module used by Redux bridge and runtime tests.
 * The fake Provider returns its children directly because the surrounding lightweight renderer
 * needs only Provider ordering and shared store behavior, not React's actual context machinery.
 *
 * @returns JavaScript module source for the fake react-redux entry.
 */
function createFakePackageSource(): string {
  return [
    `export const projectMarker = ${JSON.stringify(FAKE_REACT_REDUX_MARKER)};`,
    'let currentStore;',
    '',
    '/** Captures the supplied store for descendant fake hooks and returns children unchanged. */',
    'export function Provider({ children, store }) {',
    '  currentStore = store;',
    '  globalThis.__fakeReactReduxProviderRenders =',
    '    (globalThis.__fakeReactReduxProviderRenders ?? 0) + 1;',
    '  return children;',
    '}',
    'Provider.projectMarker = projectMarker;',
    '',
    '/** Returns the active fake store or reproduces React Redux missing-context behavior. */',
    'export function useStore() {',
    '  if (currentStore === undefined) {',
    "    throw new Error('could not find react-redux context value');",
    '  }',
    '  return currentStore;',
    '}',
    '',
    '/** Selects synchronously from the static store supplied by the preview boundary. */',
    'export function useSelector(selector) {',
    '  return selector(useStore().getState());',
    '}',
    '',
    '/** Returns the same inert dispatch function exposed by the static preview store. */',
    'export function useDispatch() {',
    '  return useStore().dispatch;',
    '}',
  ].join('\n');
}
