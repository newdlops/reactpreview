/**
 * Verifies optional project React Redux resolution and the generated inert static store.
 * Every behavior executes from a real esbuild bundle in a VM, avoiding extension-owned Redux
 * dependencies while proving Provider identity, state selection, and read-only dispatch semantics.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewReduxBridgePlugin } from '../../../src/adapters/esbuild/previewReduxBridgePlugin';
import {
  FAKE_REACT_REDUX_MARKER,
  installFakeReactReduxPackage,
} from './support/fakeReactReduxPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewReduxBridgePlugin', () => {
  /** Leaves ordinary React projects unchanged when they do not install React Redux. */
  it('provides an identity wrapper when the project has no react-redux package', async () => {
    const projectRoot = await createTemporaryProject('redux-absent-preview-');

    try {
      const context = await executeReduxBridgeFixture(
        projectRoot,
        [
          "import { createReduxPreviewElement } from 'react-preview:redux';",
          "const child = { marker: 'PLAIN_REACT_ELEMENT' };",
          'globalThis.__reduxBridgeResult =',
          '  createReduxPreviewElement(child, { configuration: undefined }) === child;',
        ].join('\n'),
      );

      expect(context.__reduxBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Uses the Provider exported by the target project's exact React Redux package instance. */
  it('uses the react-redux Provider owned by the target project', async () => {
    const projectRoot = await createTemporaryProject('redux-project-package-preview-');

    try {
      await installFakeReactReduxPackage(projectRoot);
      const context = await executeReduxBridgeFixture(
        projectRoot,
        [
          "import { createReduxPreviewElement } from 'react-preview:redux';",
          "import { Provider, projectMarker } from 'react-redux';",
          "const element = createReduxPreviewElement('target', { configuration: undefined });",
          'globalThis.__reduxBridgeResult = {',
          '  marker: element.type.projectMarker,',
          '  sameMarker: element.type.projectMarker === projectMarker,',
          '  sameProvider: element.type === Provider,',
          '};',
        ].join('\n'),
      );

      expect(context.__reduxBridgeResult).toEqual({
        marker: FAKE_REACT_REDUX_MARKER,
        sameMarker: true,
        sameProvider: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Supplies one stable, frozen, plain empty object when setup does not define state. */
  it('uses a frozen plain empty object as the default static state', async () => {
    const projectRoot = await createTemporaryProject('redux-default-state-preview-');

    try {
      await installFakeReactReduxPackage(projectRoot);
      const context = await executeReduxBridgeFixture(
        projectRoot,
        [
          "import { createReduxPreviewElement } from 'react-preview:redux';",
          "const first = createReduxPreviewElement('first', { configuration: undefined });",
          "const second = createReduxPreviewElement('second', { configuration: undefined });",
          'const state = first.props.store.getState();',
          'globalThis.__reduxBridgeResult = {',
          '  empty: Object.keys(state).length === 0,',
          '  frozen: Object.isFrozen(state),',
          '  plain: Object.getPrototypeOf(state) === Object.prototype,',
          '  stable: state === second.props.store.getState(),',
          '};',
        ].join('\n'),
      );

      expect(context.__reduxBridgeResult).toEqual({
        empty: true,
        frozen: true,
        plain: true,
        stable: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Preserves the exact application-shaped static state supplied through reduxPreview. */
  it('uses the exact state supplied through reduxPreview configuration', async () => {
    const projectRoot = await createTemporaryProject('redux-custom-state-preview-');

    try {
      await installFakeReactReduxPackage(projectRoot);
      const context = await executeReduxBridgeFixture(
        projectRoot,
        [
          "import { createReduxPreviewElement } from 'react-preview:redux';",
          'const configuredState = {',
          "  company: { identifier: 'preview-company' },",
          "  session: { role: 'owner' },",
          '};',
          "const element = createReduxPreviewElement('target', {",
          '  configuration: { state: configuredState },',
          '});',
          'globalThis.__reduxBridgeResult = {',
          '  exactReference: element.props.store.getState() === configuredState,',
          '  identifier: element.props.store.getState().company.identifier,',
          '};',
        ].join('\n'),
      );

      expect(context.__reduxBridgeResult).toEqual({
        exactReference: true,
        identifier: 'preview-company',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Honors explicit opt-out without creating a Provider or static store. */
  it('returns the original child when reduxPreview is false', async () => {
    const projectRoot = await createTemporaryProject('redux-disabled-preview-');

    try {
      await installFakeReactReduxPackage(projectRoot);
      const context = await executeReduxBridgeFixture(
        projectRoot,
        [
          "import { createReduxPreviewElement } from 'react-preview:redux';",
          "const child = { marker: 'DISABLED_REDUX_CHILD' };",
          'globalThis.__reduxBridgeResult =',
          '  createReduxPreviewElement(child, { configuration: false }) === child;',
        ].join('\n'),
      );

      expect(context.__reduxBridgeResult).toBe(true);
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /** Implements the synchronous Redux store surface while keeping preview state immutable. */
  it('exposes an inert store contract whose dispatch cannot change static state', async () => {
    const projectRoot = await createTemporaryProject('redux-store-contract-preview-');

    try {
      await installFakeReactReduxPackage(projectRoot);
      const context = await executeReduxBridgeFixture(
        projectRoot,
        [
          "import { createReduxPreviewElement } from 'react-preview:redux';",
          "const state = { counter: 7, label: 'static' };",
          "const element = createReduxPreviewElement('target', {",
          '  configuration: { state },',
          '});',
          'const store = element.props.store;',
          'let listenerCalls = 0;',
          'const unsubscribe = store.subscribe(() => { listenerCalls += 1; });',
          "const action = { payload: 8, type: 'counter/increment' };",
          'const dispatchResult = store.dispatch(action);',
          'const replaceResult = store.replaceReducer(() => ({ counter: 100 }));',
          'unsubscribe();',
          'globalThis.__reduxBridgeResult = {',
          '  dispatchIsFunction: typeof store.dispatch === "function",',
          '  dispatchReturnsAction: dispatchResult === action,',
          '  getStateIsFunction: typeof store.getState === "function",',
          '  listenerCalls,',
          '  replaceReducerIsFunction: typeof store.replaceReducer === "function",',
          '  replaceReturnsUndefined: replaceResult === undefined,',
          '  stateReferenceUnchanged: store.getState() === state,',
          '  stateValueUnchanged: store.getState().counter === 7,',
          '  subscribeIsFunction: typeof store.subscribe === "function",',
          '  unsubscribeIsFunction: typeof unsubscribe === "function",',
          '};',
        ].join('\n'),
      );

      expect(context.__reduxBridgeResult).toEqual({
        dispatchIsFunction: true,
        dispatchReturnsAction: true,
        getStateIsFunction: true,
        listenerCalls: 0,
        replaceReducerIsFunction: true,
        replaceReturnsUndefined: true,
        stateReferenceUnchanged: true,
        stateValueUnchanged: true,
        subscribeIsFunction: true,
        unsubscribeIsFunction: true,
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
 * Bundles and executes one private Redux bridge fixture in a browser-like VM global.
 *
 * @param projectRoot Nearest package root used by the bridge's optional dependency lookup.
 * @param source JavaScript fixture that records serializable assertions on `globalThis`.
 * @returns Context containing values committed by the generated fixture.
 */
async function executeReduxBridgeFixture(projectRoot: string, source: string): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'ReduxPreviewFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [createPreviewReduxBridgePlugin({ projectRoot })],
    stdin: {
      contents: source,
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<redux-bridge-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The Redux bridge fixture emitted no JavaScript.');
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
