/**
 * Verifies optional project TanStack/React Query resolution and the generated QueryClient boundary.
 * Behaviors execute from a real esbuild bundle in a VM with fake project packages, proving package
 * identity, preview option precedence, mount-scoped client freshness, and opt-out semantics.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewReactQueryBridgePlugin } from '../../../src/adapters/esbuild/previewReactQueryBridgePlugin';
import {
  FAKE_REACT_QUERY_MARKER,
  installFakeReactQueryPackage,
} from './support/fakeReactQueryPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewReactQueryBridgePlugin', () => {
  /** Leaves ordinary React projects unchanged when they do not install a Query package. */
  it('provides an identity wrapper when the project has no Query package', async () => {
    const projectRoot = await createTemporaryProject('react-query-absent-preview-');
    try {
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement, readPreviewRuntimeStatus } from 'react-preview:react-query';",
          "const child = { marker: 'PLAIN_REACT_ELEMENT' };",
          'globalThis.__result = {',
          '  same: createReactQueryPreviewElement(child, { configuration: undefined }) === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        same: true,
        status:
          'unavailable: neither @tanstack/react-query nor react-query was resolved from the target project',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Uses the Provider exported by the target project's exact Query package instance. */
  it('wraps the tree with the project-owned QueryClientProvider', async () => {
    const projectRoot = await createTemporaryProject('react-query-project-package-preview-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'tanstack');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement, readPreviewRuntimeStatus } from 'react-preview:react-query';",
          "import { QueryClient, QueryClientProvider } from '@tanstack/react-query';",
          "const element = createReactQueryPreviewElement('target', { configuration: undefined });",
          'const [{ client, namespace }] = element.props.createClients();',
          'globalThis.__result = {',
          '  child: element.props.children,',
          '  clientIsProjectClass: client instanceof QueryClient,',
          '  marker: namespace.QueryClientProvider.projectMarker,',
          '  packageNames: [...element.props.packageNames],',
          '  sameProvider: namespace.QueryClientProvider === QueryClientProvider,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        child: 'target',
        clientIsProjectClass: true,
        marker: `${FAKE_REACT_QUERY_MARKER}:@tanstack/react-query`,
        packageNames: ['@tanstack/react-query'],
        sameProvider: true,
        status:
          'active: memory-only QueryClient per preview mount (@tanstack/react-query); data edits invalidate queries; retries, polling, and focus/reconnect refetches disabled; requests use the preview data boundary',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps authored per-query retry and polling from delaying or re-running preview requests. */
  it('applies preview option precedence after authored query and mutation options', async () => {
    const projectRoot = await createTemporaryProject('react-query-options-preview-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'tanstack');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement } from 'react-preview:react-query';",
          "const element = createReactQueryPreviewElement('target', {});",
          'const [{ client }] = element.props.createClients();',
          'const query = client.defaultQueryOptions({',
          "  networkMode: 'online', queryKey: ['skus'], refetchInterval: 1000,",
          '  refetchOnWindowFocus: true, retry: 3, staleTime: 30000,',
          '});',
          'const redefaulted = client.defaultQueryOptions(query);',
          'redefaulted._optimisticResults = "optimistic";',
          'const mutation = client.defaultMutationOptions({ retry: 2 });',
          'globalThis.__result = {',
          '  mutationRetry: mutation.retry,',
          '  networkMode: query.networkMode,',
          '  queryKey: query.queryKey,',
          '  redefaultedIsCopy: redefaulted !== query,',
          '  refetchInterval: query.refetchInterval,',
          '  refetchOnReconnect: query.refetchOnReconnect,',
          '  refetchOnWindowFocus: query.refetchOnWindowFocus,',
          '  retry: query.retry,',
          '  staleTime: query.staleTime,',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        mutationRetry: false,
        networkMode: 'always',
        queryKey: ['skus'],
        redefaultedIsCopy: true,
        refetchInterval: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 30000,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Gives every boundary mount fresh clients and normalizes the Inspector revision reader. */
  it('creates fresh clients per mount and normalizes the revision reader', async () => {
    const projectRoot = await createTemporaryProject('react-query-revision-preview-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'tanstack');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement } from 'react-preview:react-query';",
          'let revision = 4;',
          'const listeners = [];',
          "const element = createReactQueryPreviewElement('target', {",
          '  readDataRevision: () => revision,',
          '  subscribeDataRevision: (listener) => { listeners.push(listener); return () => {}; },',
          '});',
          'const { createClients, freshness } = element.props;',
          'const firstMount = createClients();',
          'const secondMount = createClients();',
          'const first = freshness.readDataRevision();',
          "revision = 'invalid';",
          'const unsubscribe = freshness.subscribe(() => undefined);',
          'globalThis.__result = {',
          '  first,',
          '  freshPerMount: firstMount[0].client !== secondMount[0].client,',
          '  invalidRevision: freshness.readDataRevision(),',
          '  subscribed: listeners.length === 1,',
          "  unsubscribe: typeof unsubscribe === 'function',",
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        first: 4,
        freshPerMount: true,
        invalidRevision: 0,
        subscribed: true,
        unsubscribe: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** An authored Provider's own client must also be refreshed when preview data changes. */
  it('tracks project-owned clients that mount, excluding the boundary clients', async () => {
    const projectRoot = await createTemporaryProject('react-query-project-client-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'tanstack');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { QueryClient } from '@tanstack/react-query';",
          "import { createReactQueryPreviewElement, readPreviewTrackedProjectQueryClientCount } from 'react-preview:react-query';",
          "const element = createReactQueryPreviewElement('target', {});",
          'const before = readPreviewTrackedProjectQueryClientCount();',
          'const projectClient = new QueryClient();',
          'projectClient.mount();',
          'projectClient.mount();',
          'const afterProject = readPreviewTrackedProjectQueryClientCount();',
          'element.props.createClients()[0].client.mount();',
          'globalThis.__result = {',
          '  afterPreview: readPreviewTrackedProjectQueryClientCount(),',
          '  afterProject,',
          '  before,',
          '  mountStillRuns: projectClient.mountCount === 2,',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        afterPreview: 1,
        afterProject: 1,
        before: 0,
        mountStillRuns: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Lets an explicit setup opt out, e.g. when PreviewProviders owns a configured client. */
  it('returns children unchanged when setup disables the boundary', async () => {
    const projectRoot = await createTemporaryProject('react-query-disabled-preview-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'tanstack');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement, readPreviewRuntimeStatus } from 'react-preview:react-query';",
          "const child = { marker: 'SETUP_OWNED' };",
          'globalThis.__result = {',
          '  same: createReactQueryPreviewElement(child, { configuration: false }) === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        same: true,
        status: 'disabled by setup (reactQueryPreview=false)',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** React Query v2 hooks need no Provider, so its provider-less surface stays unwrapped. */
  it('leaves a provider-less React Query v2 package unwrapped', async () => {
    const projectRoot = await createTemporaryProject('react-query-v2-preview-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'legacy-v2');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement, readPreviewRuntimeStatus } from 'react-preview:react-query';",
          "const child = 'target';",
          'globalThis.__result = {',
          '  same: createReactQueryPreviewElement(child, {}) === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        same: true,
        status:
          'unavailable: installed Query package lacks QueryClient and QueryClientProvider (React Query v2 needs no provider)',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Supports migrations where TanStack and legacy v3 packages coexist in one project. */
  it('wraps every installed Query package with its own client, TanStack innermost', async () => {
    const projectRoot = await createTemporaryProject('react-query-both-preview-');
    try {
      await installFakeReactQueryPackage(projectRoot, 'tanstack');
      await installFakeReactQueryPackage(projectRoot, 'v3');
      const context = await executeReactQueryBridgeFixture(
        projectRoot,
        [
          "import { createReactQueryPreviewElement } from 'react-preview:react-query';",
          "const element = createReactQueryPreviewElement('target', {});",
          'const clients = element.props.createClients();',
          'globalThis.__result = {',
          '  clientCount: clients.length,',
          '  distinctClients: clients[0].client !== clients[1].client,',
          '  packageNames: [...element.props.packageNames],',
          '};',
        ].join('\n'),
      );

      expect(context.__result).toEqual({
        clientCount: 2,
        distinctClients: true,
        packageNames: ['@tanstack/react-query', 'react-query'],
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates an isolated nearest-package boundary beneath the repository's React installation. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/**
 * Bundles and executes one private Query bridge fixture in a browser-like VM global.
 *
 * @param projectRoot Nearest package root used by the bridge's optional dependency lookup.
 * @param source JavaScript fixture that records serializable assertions on `globalThis`.
 * @returns Context containing values committed by the generated fixture.
 */
async function executeReactQueryBridgeFixture(
  projectRoot: string,
  source: string,
): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'ReactQueryPreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [createPreviewReactQueryBridgePlugin({ projectRoot })],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<react-query-bridge-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The React Query bridge fixture emitted no JavaScript.');
  }
  const sandbox: Record<string, unknown> = { clearTimeout, console, queueMicrotask, setTimeout };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  return context;
}
