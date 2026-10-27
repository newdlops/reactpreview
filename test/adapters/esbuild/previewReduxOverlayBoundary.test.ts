/**
 * Verifies the Redux overlay boundary that shows absent-receiver fields over an application's own
 * store in page-authentic previews, using a Context-backed react-redux and real React rendering.
 */
import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewReduxBridgePlugin } from '../../../src/adapters/esbuild/previewReduxBridgePlugin';
import type { PreviewReduxStaticState } from '../../../src/adapters/esbuild/previewReduxRuntimeSource';
import { createPreviewSampleDateApiExpression } from '../../../src/adapters/esbuild/previewSampleDateRuntimeSource';
import { installFakeContextReactReduxPackage } from './support/fakeContextReactReduxPackage';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OVERLAY: PreviewReduxStaticState = {
  driveReport: { getDriveReportResult: { currentYearMonth: { month: 1, year: 2026 } } },
};

/** Shared fixture prelude: an application store whose reducer may leave the API result absent. */
const STORE_SOURCE = [
  "import * as React from 'react';",
  "import { renderToString } from 'react-dom/server';",
  "import { Provider, useSelector, useStore } from 'react-redux';",
  "import { createReduxPreviewElement, readPreviewReduxOverlayStatus, wrapPreviewReduxOverlayElement } from 'react-preview:redux';",
  'const dispatched = [];',
  'function createAppStore(state) {',
  '  return { getState: () => state, subscribe: () => () => {}, dispatch: (action) => { dispatched.push(action.type); return action; } };',
  '}',
  'function YearMonth() {',
  '  const value = useSelector((state) => state.driveReport.getDriveReportResult?.currentYearMonth);',
  '  const store = useStore();',
  "  store.dispatch({ type: 'probe' });",
  "  return React.createElement('p', null, JSON.stringify(value ?? null));",
  '}',
].join('\n');

/**
 * Bundles one fixture with the bridge plugin and runs it in a VM.
 *
 * @param body Fixture statements appended to the shared store prelude; they set `__result`.
 * @param overlay Absent-receiver overlay given to the bridge, or undefined for none.
 * @returns The `__result` value the fixture recorded.
 */
async function runOverlayFixture(
  body: string,
  overlay?: PreviewReduxStaticState,
): Promise<unknown> {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-redux-overlay-'));
  try {
    await installFakeContextReactReduxPackage(projectRoot);
    await writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture","private":true}');
    const result = await build({
      absWorkingDir: projectRoot,
      bundle: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      format: 'iife',
      logLevel: 'silent',
      nodePaths: [path.join(PROJECT_ROOT, 'node_modules')],
      platform: 'browser',
      plugins: [
        createPreviewReduxBridgePlugin({
          ...(overlay === undefined ? {} : { absentReceiverOverlay: overlay }),
          projectRoot,
        }),
      ],
      stdin: { contents: `${STORE_SOURCE}\n${body}`, loader: 'js', resolveDir: projectRoot },
      target: 'es2022',
      write: false,
    });
    const sandbox: Record<string, unknown> = {
      MessageChannel,
      TextDecoder,
      TextEncoder,
      clearTimeout,
      console,
      queueMicrotask,
      setTimeout,
    };
    sandbox.globalThis = sandbox;
    const context = createContext(sandbox);
    runInContext(
      `${createPreviewSampleDateApiExpression()}.baseOverride = new Date(2027, 2, 6, 12);`,
      context,
    );
    runInContext(result.outputFiles[0]?.text ?? '', context);
    return JSON.parse(JSON.stringify(sandbox.__result)) as unknown;
  } finally {
    await rm(projectRoot, { force: true, recursive: true });
  }
}

describe('Redux overlay boundary', () => {
  /** Absent fields appear on today's calendar; the real store keeps its state and gets dispatches. */
  it('fills an absent receiver below an application Provider without changing the store', async () => {
    const result = await runOverlayFixture(
      [
        'const store = createAppStore({ driveReport: { isReady: false } });',
        'const html = renderToString(React.createElement(Provider, { store }, wrapPreviewReduxOverlayElement(React.createElement(YearMonth))));',
        'globalThis.__result = { html, real: store.getState(), dispatched, status: readPreviewReduxOverlayStatus() };',
      ].join('\n'),
      OVERLAY,
    );

    expect(result).toEqual({
      dispatched: ['probe'],
      html: '<p>{&quot;month&quot;:3,&quot;year&quot;:2027}</p>',
      real: { driveReport: { isReady: false } },
      status: 'active: absent receiver fields shown over the application store',
    });
  });

  /** A value the application store already holds is never replaced. */
  it('keeps real application values', async () => {
    const result = await runOverlayFixture(
      [
        'const store = createAppStore({ driveReport: { getDriveReportResult: { currentYearMonth: { month: 5, year: 2020 } } } });',
        'globalThis.__result = renderToString(React.createElement(Provider, { store }, wrapPreviewReduxOverlayElement(React.createElement(YearMonth))));',
      ].join('\n'),
      OVERLAY,
    );

    expect(result).toBe('<p>{&quot;month&quot;:5,&quot;year&quot;:2020}</p>');
  });

  /** Nested boundaries below one Provider fill once; the inner one passes the overlay store through. */
  it('passes an outer overlay store through a nested boundary', async () => {
    const result = await runOverlayFixture(
      [
        'const store = createAppStore({ driveReport: {} });',
        'const inner = wrapPreviewReduxOverlayElement(React.createElement(YearMonth));',
        'const html = renderToString(React.createElement(Provider, { store }, wrapPreviewReduxOverlayElement(inner)));',
        'globalThis.__result = { html, status: readPreviewReduxOverlayStatus() };',
      ].join('\n'),
      OVERLAY,
    );

    expect(result).toEqual({
      html: '<p>{&quot;month&quot;:3,&quot;year&quot;:2027}</p>',
      status: 'active: absent receiver fields shown over the application store',
    });
  });

  /** The preview's own static store already holds the fields, and no Provider means nothing to wrap. */
  it('stays inactive below the preview static store or without any Provider', async () => {
    const result = await runOverlayFixture(
      [
        "const leaf = React.createElement('span', null, 'leaf');",
        'renderToString(createReduxPreviewElement(wrapPreviewReduxOverlayElement(leaf), { configuration: undefined }));',
        'const underStatic = readPreviewReduxOverlayStatus();',
        'renderToString(wrapPreviewReduxOverlayElement(leaf));',
        'globalThis.__result = { underStatic, withoutProvider: readPreviewReduxOverlayStatus() };',
      ].join('\n'),
      OVERLAY,
    );

    expect(result).toEqual({
      underStatic: 'inactive: the page reads the preview static store',
      withoutProvider: 'inactive: no application Provider above the page',
    });
  });

  /** Without absent-receiver fields the element is returned unchanged, so the tree keeps its shape. */
  it('returns the element itself when there are no absent receiver fields', async () => {
    const result = await runOverlayFixture(
      [
        "const leaf = React.createElement('span', null, 'leaf');",
        "const installed = globalThis[Symbol.for('newdlops.react-file-preview.redux-overlay-element')];",
        'globalThis.__result = { same: wrapPreviewReduxOverlayElement(leaf) === leaf, installed: installed === wrapPreviewReduxOverlayElement, status: readPreviewReduxOverlayStatus() };',
      ].join('\n'),
    );

    expect(result).toEqual({
      installed: true,
      same: true,
      status: 'inactive: no absent receiver fields',
    });
  });
});
