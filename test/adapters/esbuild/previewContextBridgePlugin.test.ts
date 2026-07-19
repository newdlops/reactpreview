/**
 * Verifies the generic project Context bridge through real esbuild bundles executed in a VM.
 * A tiny project-owned React fixture exposes observable Context tokens and external-store
 * subscriptions without requiring a DOM renderer or executing any application Provider component.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewContextBridgePlugin } from '../../../src/adapters/esbuild/previewContextBridgePlugin';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROJECT_REACT_MARKER = 'PROJECT_OWNED_CONTEXT_REACT';

describe('createPreviewContextBridgePlugin', () => {
  /** Resolves React from the target project and retains a boundary for future lazy registrations. */
  it('uses the project React instance and creates a subscription boundary before requirements exist', async () => {
    const projectRoot = await createTemporaryProject('context-project-react-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContextPreviewElement, readPreviewRuntimeStatus } from 'react-preview:context';",
          "import { projectMarker } from 'react';",
          "const child = { marker: 'TARGET' };",
          'const boundary = createContextPreviewElement(child);',
          'const rendered = boundary.type(boundary.props);',
          'globalThis.__contextBridgeResult = {',
          '  boundaryFromProjectReact: boundary.projectMarker === projectMarker,',
          '  childPreserved: rendered === child,',
          `  exactMarker: projectMarker === ${JSON.stringify(PROJECT_REACT_MARKER)},`,
          '  status: readPreviewRuntimeStatus(),',
          '  subscriberInstalled: globalThis.__contextPreviewSubscriptionCount === 1,',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        boundaryFromProjectReact: true,
        childPreserved: true,
        exactMarker: true,
        status: 'inactive: no valid project Context requirements were registered',
        subscriberInstalled: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Merges requirements from multiple hooks sharing the exact Context without retaining callbacks. */
  it('merges frozen demand shapes into one stable raw Context provider value', async () => {
    const projectRoot = await createTemporaryProject('context-merge-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContext } from 'react';",
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement, readPreviewRuntimeStatus } from 'react-preview:context';",
          'const AppContext = createContext(null);',
          'function useAppContext() {}',
          'function useSessionContext() {}',
          'const authoredCallback = Object.freeze(() => "authored-side-effect");',
          'const firstFallback = Object.freeze({ user: Object.freeze({}) });',
          'const secondFallback = Object.freeze({',
          '  actions: Object.freeze({ save: authoredCallback }),',
          '  user: Object.freeze({ profile: Object.freeze({}) }),',
          '});',
          'registerPreviewContextIdentity(useAppContext, AppContext);',
          'registerPreviewContextIdentity(useSessionContext, AppContext);',
          'registerPreviewContextRequirement(useAppContext, firstFallback);',
          'registerPreviewContextRequirement(useSessionContext, secondFallback);',
          "const child = { marker: 'TARGET' };",
          'const boundary = createContextPreviewElement(child);',
          'const providerElement = boundary.type(boundary.props);',
          'const value = providerElement.props.value;',
          'const duplicateBoundary = createContextPreviewElement(child);',
          'const duplicateProviderElement = duplicateBoundary.type(duplicateBoundary.props);',
          'globalThis.__contextBridgeResult = {',
          '  callableIsInert: value.actions.save() === undefined,',
          '  callableWasCopied: value.actions.save !== authoredCallback,',
          '  childPreserved: providerElement.props.children === child,',
          '  contextProviderIdentity: providerElement.type === AppContext.Provider,',
          '  frozenActions: Object.isFrozen(value.actions),',
          '  frozenCallable: Object.isFrozen(value.actions.save),',
          '  frozenProfile: Object.isFrozen(value.user.profile),',
          '  frozenRoot: Object.isFrozen(value),',
          '  frozenUser: Object.isFrozen(value.user),',
          '  stableValue: duplicateProviderElement.props.value === value,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        callableIsInert: true,
        callableWasCopied: true,
        childPreserved: true,
        contextProviderIdentity: true,
        frozenActions: true,
        frozenCallable: true,
        frozenProfile: true,
        frozenRoot: true,
        frozenUser: true,
        stableValue: true,
        status: 'active: 1 static project Context provider(s) with demand-shaped neutral values',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /**
   * Treats a statically called array method as a unique container answer instead of asking the user
   * to replace a generated `{ map() {} }` object after the next sibling calls `filter()`.
   */
  it('materializes array-method demand as a neutral frozen array automatically', async () => {
    const projectRoot = await createTemporaryProject('context-array-shape-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContext } from 'react';",
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement } from 'react-preview:context';",
          'const AppContext = createContext(null);',
          'function useAppContext() {}',
          'registerPreviewContextIdentity(useAppContext, AppContext);',
          'registerPreviewContextRequirement(',
          '  useAppContext,',
          '  Object.freeze({ companies: Object.freeze({ map: Object.freeze(() => undefined) }) }),',
          ');',
          'const boundary = createContextPreviewElement({ marker: "TARGET" });',
          'const providerElement = boundary.type(boundary.props);',
          'const companies = providerElement.props.value.companies;',
          'globalThis.__contextBridgeResult = {',
          '  filterWorks: companies.filter(() => true).length === 0,',
          '  frozen: Object.isFrozen(companies),',
          '  isArray: Array.isArray(companies),',
          '  mapWorks: companies.map(() => "never").length === 0,',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        filterWorks: true,
        frozen: true,
        isArray: true,
        mapWorks: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Leaves a real or type-guided non-nullish Context default closer to authored semantics. */
  it('does not shadow an existing non-nullish Context default with an outer fallback', async () => {
    const projectRoot = await createTemporaryProject('context-existing-default-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContext } from 'react';",
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement, readPreviewRuntimeStatus } from 'react-preview:context';",
          'const existingDefault = Object.freeze({ user: Object.freeze({ authored: true }) });',
          'const AppContext = createContext(existingDefault);',
          'function useAppContext() {}',
          'registerPreviewContextIdentity(useAppContext, AppContext);',
          'registerPreviewContextRequirement(',
          '  useAppContext,',
          '  Object.freeze({ user: Object.freeze({}) }),',
          ');',
          "const child = { marker: 'TARGET' };",
          'const boundary = createContextPreviewElement(child);',
          'const rendered = boundary.type(boundary.props);',
          'globalThis.__contextBridgeResult = {',
          '  childPreserved: rendered === child,',
          '  defaultPreserved: AppContext._currentValue === existingDefault,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        childPreserved: true,
        defaultPreserved: true,
        status: 'inactive: 1 Context requirement(s) preserved an existing non-nullish default',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Keeps valid Contexts active while omitting only a Context with an object/callable conflict. */
  it('fails closed per exact Context identity when merged fallback kinds conflict', async () => {
    const projectRoot = await createTemporaryProject('context-conflict-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContext } from 'react';",
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement, readPreviewRuntimeStatus } from 'react-preview:context';",
          'const ConflictingContext = createContext(null);',
          'const ValidContext = createContext(null);',
          'function useConflictObject() {}',
          'function useConflictCallable() {}',
          'function useValidContext() {}',
          'registerPreviewContextIdentity(useConflictObject, ConflictingContext);',
          'registerPreviewContextIdentity(useConflictCallable, ConflictingContext);',
          'registerPreviewContextIdentity(useValidContext, ValidContext);',
          'registerPreviewContextRequirement(',
          '  useConflictObject,',
          '  Object.freeze({ service: Object.freeze({}) }),',
          ');',
          'registerPreviewContextRequirement(',
          '  useConflictCallable,',
          '  Object.freeze({ service: Object.freeze(() => undefined) }),',
          ');',
          'registerPreviewContextRequirement(',
          '  useValidContext,',
          '  Object.freeze({ session: Object.freeze({}) }),',
          ');',
          "const child = { marker: 'TARGET' };",
          'const boundary = createContextPreviewElement(child);',
          'const providerElement = boundary.type(boundary.props);',
          'globalThis.__contextBridgeResult = {',
          '  conflictProviderOmitted: providerElement.type !== ConflictingContext.Provider,',
          '  validProviderRetained: providerElement.type === ValidContext.Provider,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        conflictProviderOmitted: true,
        status:
          'active: 1 static project Context provider(s) with demand-shaped neutral values; 1 conflicting Context shape(s) omitted',
        validProviderRetained: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Proves `useSyncExternalStore` observes an identity supplied after the first boundary render. */
  it('publishes late lazy Context registrations through the subscription boundary', async () => {
    const projectRoot = await createTemporaryProject('context-late-registration-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContext } from 'react';",
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement } from 'react-preview:context';",
          'const LazyContext = createContext(null);',
          'function useLazyContext() {}',
          'registerPreviewContextRequirement(',
          '  useLazyContext,',
          '  Object.freeze({ lazyState: Object.freeze({}) }),',
          ');',
          "const child = { marker: 'TARGET' };",
          'const boundary = createContextPreviewElement(child);',
          'const beforeIdentity = boundary.type(boundary.props);',
          'const notificationsBeforeIdentity = globalThis.__contextPreviewNotificationCount ?? 0;',
          'registerPreviewContextIdentity(useLazyContext, LazyContext);',
          'const afterIdentity = boundary.type(boundary.props);',
          'globalThis.__contextBridgeResult = {',
          '  initiallyPending: beforeIdentity === child,',
          '  lateProviderAdded: afterIdentity.type === LazyContext.Provider,',
          '  notificationPublished:',
          '    globalThis.__contextPreviewNotificationCount > notificationsBeforeIdentity,',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        initiallyPending: true,
        lateProviderAdded: true,
        notificationPublished: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Rejects malformed values and forged function Providers without evaluating their logic. */
  it('accepts only deeply frozen shapes and raw React-owned Context provider tokens', async () => {
    const projectRoot = await createTemporaryProject('context-validation-');
    try {
      await installFakeReactPackage(projectRoot);
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContext } from 'react';",
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement, readPreviewRuntimeStatus } from 'react-preview:context';",
          'let authoredProviderCalls = 0;',
          'function AuthoredProvider({ children }) { authoredProviderCalls += 1; return children; }',
          'const forgedContext = {',
          "  $$typeof: Symbol.for('react.context'),",
          '  Provider: AuthoredProvider,',
          '};',
          'const RealContext = createContext(null);',
          'function useForged() {}',
          'function useInvalidShape() {}',
          'registerPreviewContextIdentity(useForged, forgedContext);',
          'registerPreviewContextIdentity(useInvalidShape, RealContext);',
          'registerPreviewContextRequirement(useForged, Object.freeze({ safe: Object.freeze({}) }));',
          'registerPreviewContextRequirement(',
          '  useInvalidShape,',
          '  Object.freeze({ nested: {} }),',
          ');',
          "const child = { marker: 'TARGET' };",
          'const boundary = createContextPreviewElement(child);',
          'const rendered = boundary.type(boundary.props);',
          'globalThis.__contextBridgeResult = {',
          '  authoredProviderCalls,',
          '  childPreserved: rendered === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        authoredProviderCalls: 0,
        childPreserved: true,
        status: 'inactive: 1 hook requirement(s) awaiting Context identity',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Does not fall back to the extension's React when no package is resolvable from the project. */
  it('provides the complete no-op contract when project React is absent', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-context-absent-'));
    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
      const context = await executeContextBridgeFixture(
        projectRoot,
        [
          "import { createContextPreviewElement, registerPreviewContextIdentity, registerPreviewContextRequirement, readPreviewRuntimeStatus } from 'react-preview:context';",
          'function useMissingContext() {}',
          'registerPreviewContextIdentity(useMissingContext, {});',
          'registerPreviewContextRequirement(useMissingContext, Object.freeze({}));',
          "const child = { marker: 'TARGET' };",
          'globalThis.__contextBridgeResult = {',
          '  childPreserved: createContextPreviewElement(child) === child,',
          '  status: readPreviewRuntimeStatus(),',
          '};',
        ].join('\n'),
      );

      expect(context.__contextBridgeResult).toEqual({
        childPreserved: true,
        status: 'unavailable: react was not resolved from the target project',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates one isolated package beneath the repository and writes only its manifest. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(REPOSITORY_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/** Installs a dependency-free React compatibility package owned by the temporary target project. */
async function installFakeReactPackage(projectRoot: string): Promise<void> {
  const packageDirectory = path.join(projectRoot, 'node_modules', 'react');
  await mkdir(packageDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(packageDirectory, 'package.json'),
      JSON.stringify({
        exports: './index.js',
        module: './index.js',
        name: 'react',
        type: 'module',
      }),
      'utf8',
    ),
    writeFile(path.join(packageDirectory, 'index.js'), createFakeReactSource(), 'utf8'),
  ]);
}

/**
 * Creates observable React Context tokens and hook/subscription primitives for runtime tests.
 * Raw Providers are data objects, matching React internals closely enough to prove the bridge never
 * substitutes or calls an authored Provider function.
 */
function createFakeReactSource(): string {
  return [
    `export const projectMarker = ${JSON.stringify(PROJECT_REACT_MARKER)};`,
    '',
    '/** Creates a small element record while marking the exact React module that produced it. */',
    'export function createElement(type, props, ...children) {',
    '  return {',
    '    projectMarker,',
    '    props: {',
    '      ...(props ?? {}),',
    '      children: children.length <= 1 ? children[0] : children,',
    '    },',
    '    type,',
    '  };',
    '}',
    '',
    '/** Creates React 18-shaped raw Context and Provider identity objects. */',
    'export function createContext(defaultValue) {',
    '  const context = {',
    "    $$typeof: Symbol.for('react.context'),",
    '    _currentValue: defaultValue,',
    '  };',
    '  const Provider = {',
    "    $$typeof: Symbol.for('react.provider'),",
    '    _context: context,',
    '  };',
    '  context.Provider = Provider;',
    '  return context;',
    '}',
    '',
    '/** Installs an observable external-store listener and returns the current scalar revision. */',
    'export function useSyncExternalStore(subscribe, getSnapshot, _getServerSnapshot) {',
    '  globalThis.__contextPreviewSubscriptionCount =',
    '    (globalThis.__contextPreviewSubscriptionCount ?? 0) + 1;',
    '  subscribe(() => {',
    '    globalThis.__contextPreviewNotificationCount =',
    '      (globalThis.__contextPreviewNotificationCount ?? 0) + 1;',
    '  });',
    '  return getSnapshot();',
    '}',
  ].join('\n');
}

/** Bundles and evaluates one Context bridge fixture in a browser-like VM global. */
async function executeContextBridgeFixture(projectRoot: string, source: string): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'ContextPreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [createPreviewContextBridgePlugin({ projectRoot })],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<context-bridge-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The Context bridge fixture emitted no JavaScript.');
  }

  const sandbox: Record<string, unknown> = {
    clearTimeout,
    console,
    queueMicrotask,
    setTimeout,
  };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  return context;
}
