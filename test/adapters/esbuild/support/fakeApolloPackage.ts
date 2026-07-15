/**
 * Installs a tiny project-owned Apollo package for bridge and runtime integration fixtures.
 * The implementation models only the public surface used by the generated static boundary, while
 * its Provider and hook expose the exact missing-context behavior reported by Apollo Client.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes an isolated ESM package under a temporary target project.
 *
 * @param projectRoot Temporary package root that should own the Apollo dependency.
 * @returns Promise resolved after package metadata and implementation are durable.
 */
export async function installFakeApolloPackage(projectRoot: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules', '@apollo', 'client');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({ module: './index.js', name: '@apollo/client', type: 'module' }),
      'utf8',
    ),
    writeFile(
      path.join(packageDirectory, 'index.js'),
      [
        "export const projectMarker = 'PROJECT_OWNED_APOLLO_MARKER';",
        'let currentClient;',
        'export class ApolloClient {',
        '  constructor(options) { Object.assign(this, options); this.marker = projectMarker; }',
        '}',
        'export class ApolloLink {',
        '  constructor(request) { this.request = request; }',
        '}',
        'export class InMemoryCache {',
        '  constructor(options) { this.options = options; }',
        '  restore(state) { this.state = state; return this; }',
        '}',
        'export class Observable {',
        '  constructor(subscriber) { this.subscriber = subscriber; }',
        '  subscribe(observer) {',
        '    const cleanup = this.subscriber(observer);',
        '    return { unsubscribe: typeof cleanup === "function" ? cleanup : () => undefined };',
        '  }',
        '}',
        'export function ApolloProvider({ children, client }) {',
        '  currentClient = client;',
        '  return children;',
        '}',
        'export function useApolloClient() {',
        '  if (currentClient === undefined) {',
        "    throw new Error('Apollo client context is missing');",
        '  }',
        '  return currentClient;',
        '}',
      ].join('\n'),
      'utf8',
    ),
  ]);
}
