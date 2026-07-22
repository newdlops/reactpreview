/**
 * Verifies that the App Router navigation facade is an explicit Page Inspector capability.
 * Both specifiers are exercised because Next itself and packages such as nuqs may request the
 * public module with or without its emitted `.js` suffix. Keeping this test at the esbuild-plugin
 * boundary also proves that projects do not need a locally installed Next package for previews.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createContext, runInContext, type Context } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const NEXT_APP_NAVIGATION_SPECIFIERS = ['next/navigation', 'next/navigation.js'] as const;

describe('Next App Router navigation bridge', () => {
  /**
   * Resolves both source and emitted-package spellings through the same bounded facade.
   * The fixture checks the stable public surface without invoking hooks outside React render.
   */
  it.each(NEXT_APP_NAVIGATION_SPECIFIERS)(
    'provides the static navigation facade for %s when App Router context is selected',
    async (specifier) => {
      const projectRoot = await createTemporaryProject('next-app-navigation-enabled-');

      try {
        const context = await executeNavigationFixture(projectRoot, specifier, true);

        expect(context.__nextAppNavigationResult).toEqual({
          PreviewLayoutSegmentsContext: 'object',
          ServerInsertedHTMLContext: 'object',
          notFound: 'function',
          permanentRedirect: 'function',
          redirect: 'function',
          unstable_isUnrecognizedActionError: 'function',
          unstable_rootParams: 'function',
          useParams: 'function',
          usePathname: 'function',
          useRouter: 'function',
          useSearchParams: 'function',
          useSelectedLayoutSegment: 'function',
          useSelectedLayoutSegments: 'function',
          useServerInsertedHTML: 'function',
        });
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    },
  );

  /** Hook values remain referentially stable and respect the calling layout's segment boundary. */
  it('preserves hook identity and layout-relative segment context', async () => {
    const projectRoot = await createTemporaryProject('next-app-navigation-hooks-');

    try {
      const context = await executeNavigationHookFixture(projectRoot);

      expect(context.__nextAppHookResult).toEqual({
        firstSegment: 'company',
        keyedSegments: 'modal',
        paramsStable: true,
        searchStable: true,
        segments: 'company/acme/profile',
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });

  /**
   * Leaves unrelated previews honest: without proven App Router context, neither spelling is
   * captured, so a project that does not install Next receives esbuild's actionable resolution
   * error instead of an ambient framework shim.
   */
  it.each(NEXT_APP_NAVIGATION_SPECIFIERS)(
    'does not capture %s when App Router context is not selected',
    async (specifier) => {
      const projectRoot = await createTemporaryProject('next-app-navigation-disabled-');

      try {
        await expect(executeNavigationFixture(projectRoot, specifier, false)).rejects.toThrow(
          `Could not resolve \"${specifier}\"`,
        );
      } finally {
        await rm(projectRoot, { force: true, recursive: true });
      }
    },
  );

  /** Next control helpers must stop guarded source instead of leaking undefined into later reads. */
  it.each([
    ['notFound', 'notFound()'],
    ['redirect', "redirect('/login')"],
    ['permanentRedirect', "permanentRedirect('/moved')"],
  ])('preserves never-returning control flow for %s', async (_name, invocation) => {
    const projectRoot = await createTemporaryProject('next-app-navigation-control-');

    try {
      const context = await executeNavigationControlFixture(projectRoot, invocation);

      expect(context.__nextAppControlResult).toEqual({
        continued: false,
        errorName: 'ReactPreviewNextNavigationSignal',
        hasControlSignal: true,
      });
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Creates an isolated package boundary with no Next dependency available. */
async function createTemporaryProject(prefix: string): Promise<string> {
  const projectRoot = await mkdtemp(path.join(PROJECT_ROOT, `test/fixtures/${prefix}`));
  await writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8');
  return projectRoot;
}

/**
 * Bundles one public navigation spelling through the router bridge and evaluates its export shape.
 *
 * @param projectRoot Nearest target-project package boundary.
 * @param specifier Public Next App Router module spelling used by the fixture.
 * @param nextAppEnabled Whether static page evidence selected the facade for this compilation.
 * @returns Browser-like VM context containing the fixture's serializable observation.
 */
async function executeNavigationFixture(
  projectRoot: string,
  specifier: (typeof NEXT_APP_NAVIGATION_SPECIFIERS)[number],
  nextAppEnabled: boolean,
): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'NextAppNavigationFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      createPreviewRouterBridgePlugin({
        enabled: false,
        nextAppEnabled,
        projectRoot,
      }),
    ],
    stdin: {
      contents: [
        `import {`,
        '  PreviewLayoutSegmentsContext,',
        '  ServerInsertedHTMLContext,',
        '  notFound,',
        '  permanentRedirect,',
        '  redirect,',
        '  unstable_isUnrecognizedActionError,',
        '  unstable_rootParams,',
        '  useParams,',
        '  usePathname,',
        '  useRouter,',
        '  useSearchParams,',
        '  useSelectedLayoutSegment,',
        '  useSelectedLayoutSegments,',
        '  useServerInsertedHTML,',
        `} from ${JSON.stringify(specifier)};`,
        'globalThis.__nextAppNavigationResult = {',
        '  PreviewLayoutSegmentsContext: typeof PreviewLayoutSegmentsContext,',
        '  ServerInsertedHTMLContext: typeof ServerInsertedHTMLContext,',
        '  notFound: typeof notFound,',
        '  permanentRedirect: typeof permanentRedirect,',
        '  redirect: typeof redirect,',
        '  unstable_isUnrecognizedActionError: typeof unstable_isUnrecognizedActionError,',
        '  unstable_rootParams: typeof unstable_rootParams,',
        '  useParams: typeof useParams,',
        '  usePathname: typeof usePathname,',
        '  useRouter: typeof useRouter,',
        '  useSearchParams: typeof useSearchParams,',
        '  useSelectedLayoutSegment: typeof useSelectedLayoutSegment,',
        '  useSelectedLayoutSegments: typeof useSelectedLayoutSegments,',
        '  useServerInsertedHTML: typeof useServerInsertedHTML,',
        '};',
      ].join('\n'),
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<next-app-navigation-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The Next App Router navigation fixture emitted no JavaScript.');
  }

  const sandbox: Record<string, unknown> = {
    console,
    URL,
    URLSearchParams,
  };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  return context;
}

/** Renders the public hooks once under a generated layout segment context. */
async function executeNavigationHookFixture(projectRoot: string): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'NextAppNavigationHookFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      createPreviewRouterBridgePlugin({
        enabled: false,
        nextAppEnabled: true,
        projectRoot,
      }),
    ],
    stdin: {
      contents: [
        "import * as React from 'react';",
        "import { renderToStaticMarkup } from 'react-dom/server';",
        'import { PreviewLayoutSegmentsContext, useParams, useSearchParams, useSelectedLayoutSegment, useSelectedLayoutSegments } from "next/navigation";',
        "const routeSymbol = Symbol.for('newdlops.react-file-preview.next-app-route');",
        'globalThis[routeSymbol] = { params: Object.freeze({ companyId: "acme" }), pathname: "/company/acme/profile", revision: 1, searchParams: Object.freeze({ tab: "details" }) };',
        'function Probe() {',
        '  const firstParams = useParams();',
        '  const secondParams = useParams();',
        '  const firstSearch = useSearchParams();',
        '  const secondSearch = useSearchParams();',
        '  globalThis.__nextAppHookResult = {',
        '    firstSegment: useSelectedLayoutSegment(),',
        '    keyedSegments: useSelectedLayoutSegments("drawer").join("/"),',
        '    paramsStable: firstParams === secondParams,',
        '    searchStable: firstSearch === secondSearch,',
        '    segments: useSelectedLayoutSegments().join("/"),',
        '  };',
        '  return React.createElement("main");',
        '}',
        'renderToStaticMarkup(React.createElement(',
        '  PreviewLayoutSegmentsContext.Provider,',
        '  { value: { segments: ["company", "acme", "profile"], slots: { drawer: ["modal"] } } },',
        '  React.createElement(Probe),',
        '));',
      ].join('\n'),
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<next-app-navigation-hook-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The Next App Router hook fixture emitted no JavaScript.');
  }

  const sandbox: Record<string, unknown> = {
    clearTimeout,
    console,
    MessageChannel,
    performance,
    setTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
  };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  return context;
}

/** Bundles one control helper and records whether source following the call was reachable. */
async function executeNavigationControlFixture(
  projectRoot: string,
  invocation: string,
): Promise<Context> {
  const result = await build({
    absWorkingDir: projectRoot,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"test"' },
    format: 'iife',
    globalName: 'NextAppNavigationControlFixture',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      createPreviewRouterBridgePlugin({
        enabled: false,
        nextAppEnabled: true,
        projectRoot,
      }),
    ],
    stdin: {
      contents: [
        "import { notFound, permanentRedirect, redirect } from 'next/navigation';",
        'let continued = false;',
        'let caught;',
        'try {',
        `  ${invocation};`,
        '  continued = true;',
        '} catch (error) { caught = error; }',
        'globalThis.__nextAppControlResult = {',
        '  continued,',
        "  errorName: caught?.name ?? '',",
        '  hasControlSignal: Object.getOwnPropertySymbols(caught ?? {}).some(',
        "    (symbol) => Symbol.keyFor(symbol) === 'newdlops.react-file-preview.next-app-control-signal',",
        '  ),',
        '};',
      ].join('\n'),
      loader: 'js',
      resolveDir: projectRoot,
      sourcefile: '<next-app-navigation-control-fixture>',
    },
    target: 'es2022',
    write: false,
  });
  const javascript = result.outputFiles[0]?.text;
  if (javascript === undefined) {
    throw new Error('The Next App Router control fixture emitted no JavaScript.');
  }

  const sandbox: Record<string, unknown> = { console, URL, URLSearchParams };
  sandbox.globalThis = sandbox;
  const context = createContext(sandbox);
  runInContext(javascript, context, { timeout: 10_000 });
  return context;
}
