/**
 * Installs tiny project-owned TanStack/React Query packages for optional bridge fixtures.
 * The fake client reproduces only the option-merging and cache-clearing contract the preview
 * boundary relies on, so tests observe package identity without adding Query to the extension.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Marker embedded into each fake package so tests can identify the resolved instance. */
export const FAKE_REACT_QUERY_MARKER = 'PROJECT_OWNED_REACT_QUERY_MARKER';

/** Package layout variants exercised by the bridge tests. */
export type FakeReactQueryPackageKind = 'legacy-v2' | 'tanstack' | 'v3';

/**
 * Writes a minimal ESM Query package beneath an isolated target project.
 *
 * @param projectRoot Temporary package root that should own the package.
 * @param kind TanStack v4/v5 name, legacy v3 name, or a provider-less v2 surface.
 * @returns Promise resolved after the fake package files have been written.
 */
export async function installFakeReactQueryPackage(
  projectRoot: string,
  kind: FakeReactQueryPackageKind,
): Promise<void> {
  const packageName = kind === 'tanstack' ? '@tanstack/react-query' : 'react-query';
  const packageDirectory = path.join(projectRoot, 'node_modules', ...packageName.split('/'));
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        exports: './index.js',
        module: './index.js',
        name: packageName,
        type: 'module',
      }),
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      kind === 'legacy-v2' ? createProviderlessSource() : createClientSource(packageName),
      'utf8',
    ),
  ]);
}

/**
 * Creates a v3+-shaped surface: a QueryClient that merges defaults like the real package and a
 * Provider that returns its children, which is enough for element-level identity assertions.
 */
function createClientSource(packageName: string): string {
  return [
    `export const projectMarker = ${JSON.stringify(`${FAKE_REACT_QUERY_MARKER}:${packageName}`)};`,
    'export class QueryClient {',
    '  constructor(config = {}) {',
    '    this.config = config;',
    '    this.clearCount = 0;',
    '  }',
    '  defaultQueryOptions(options) {',
    '    if (options?._defaulted) return options;',
    '    return { ...this.config.defaultOptions?.queries, ...options, _defaulted: true };',
    '  }',
    '  defaultMutationOptions(options) {',
    '    return { ...this.config.defaultOptions?.mutations, ...options, _defaulted: true };',
    '  }',
    '  clear() {',
    '    this.clearCount += 1;',
    '  }',
    '  mount() {',
    '    this.mountCount = (this.mountCount ?? 0) + 1;',
    '  }',
    '}',
    '/** Returns children unchanged; the preview only needs Provider identity here. */',
    'export function QueryClientProvider({ children }) {',
    '  return children;',
    '}',
    'QueryClientProvider.projectMarker = projectMarker;',
  ].join('\n');
}

/** Creates the React Query v2 surface, which has hooks but no QueryClient/Provider pair. */
function createProviderlessSource(): string {
  return [
    `export const projectMarker = ${JSON.stringify(FAKE_REACT_QUERY_MARKER)};`,
    'export function useQuery() {',
    "  return { status: 'idle' };",
    '}',
  ].join('\n');
}
