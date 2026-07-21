/**
 * Verifies the static Next.js Pages Router compatibility module in an actual esbuild artifact.
 * The fixture intentionally has no Next bootstrap or RouterContext, matching a pinned preview.
 */
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewNextPagesRouterRuntimeSource } from '../../../src/adapters/esbuild/previewNextPagesRouterRuntimeSource';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('Next Pages Router preview runtime', () => {
  /** Replaces the throwing package hook with one stable router at the selected candidate path. */
  it('serves pathname, query, singleton events, and bounded local navigation without a provider', async () => {
    const result = await build({
      absWorkingDir: PROJECT_ROOT,
      bundle: true,
      define: { 'process.env.NODE_ENV': '"test"' },
      format: 'iife',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [createPreviewRouterBridgePlugin({ enabled: false, projectRoot: PROJECT_ROOT })],
      stdin: {
        contents: [
          "import Router, { RouterContext, useRouter } from 'next/router';",
          'const first = Router;',
          "let completed = '';",
          "Router.events.on('routeChangeComplete', (url) => { completed = url; });",
          "const navigation = first.replace('/appointments?tab=upcoming');",
          "const objectNavigation = first.push({ pathname: '/profile', query: { page: 2, tab: 'saved' }, hash: '#top' });",
          'globalThis.__nextRouterResult = {',
          '  asPath: first.asPath,',
          '  completed,',
          '  contextAvailable: RouterContext?.Provider !== undefined,',
          '  hookType: typeof useRouter,',
          '  isPromise: typeof navigation?.then === "function",',
          '  objectPromise: typeof objectNavigation?.then === "function",',
          '  isPreview: first.isPreview,',
          '  isReady: first.isReady,',
          '  pathname: first.pathname,',
          '  query: first.query,',
          '  sameRouter: first === Router,',
          '};',
        ].join('\n'),
        loader: 'js',
        resolveDir: PROJECT_ROOT,
        sourcefile: '<next-pages-router-preview>',
      },
      target: 'es2022',
      write: false,
    });
    const javascript = result.outputFiles[0]?.text;
    if (javascript === undefined) throw new Error('Expected a bundled Pages Router fixture.');

    const location = { hash: '', pathname: '/callBlock', search: '?page=1' };
    const sandbox: Record<string, unknown> = {
      console,
      history: {
        state: undefined,
        pushState(_state: unknown, _title: string, url: string): void {
          const parsed = new URL(url, 'https://preview.invalid');
          location.hash = parsed.hash;
          location.pathname = parsed.pathname;
          location.search = parsed.search;
        },
        replaceState(_state: unknown, _title: string, url: string): void {
          const parsed = new URL(url, 'https://preview.invalid');
          location.hash = parsed.hash;
          location.pathname = parsed.pathname;
          location.search = parsed.search;
        },
      },
      location,
      URL,
      URLSearchParams,
    };
    sandbox.globalThis = sandbox;
    sandbox[
      Symbol.for('newdlops.react-file-preview.next-pages-router-state') as unknown as string
    ] = {
      pathname: '/callBlock/driverId',
      pattern: '/callBlock/[driverId]',
    };
    const context = createContext(sandbox);
    runInContext(javascript, context, { timeout: 10_000 });

    expect(context.__nextRouterResult).toEqual({
      asPath: '/profile?page=2&tab=saved#top',
      completed: '/profile?page=2&tab=saved#top',
      contextAvailable: true,
      hookType: 'function',
      isPromise: true,
      isPreview: false,
      isReady: true,
      objectPromise: true,
      pathname: '/callBlock/[driverId]',
      query: { driverId: 'driverId', page: '2', tab: 'saved' },
      sameRouter: true,
    });
  });

  /** Keeps the generated boundary browser-only and independent of Next application internals. */
  it('does not import Next bootstrap modules or perform backend requests', () => {
    const source = createPreviewNextPagesRouterRuntimeSource();

    expect(source).toContain("import * as React from 'react';");
    expect(source).not.toContain("from 'next/dist/client");
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('XMLHttpRequest');
  });
});
