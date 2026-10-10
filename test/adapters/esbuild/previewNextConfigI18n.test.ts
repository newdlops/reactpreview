/** Verifies static `next.config.*` i18n reading and the locale exposed by the static Pages Router. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  parsePreviewNextI18nConfig,
  readPreviewNextI18nConfig,
} from '../../../src/adapters/esbuild/previewNextConfigI18n';
import { createPreviewRouterBridgePlugin } from '../../../src/adapters/esbuild/previewRouterBridgePlugin';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('parsePreviewNextI18nConfig', () => {
  /** CommonJS and typed configs both expose a literal `i18n` object. */
  it('reads literal locales and keeps the default locale listed', () => {
    expect(
      parsePreviewNextI18nConfig(
        "module.exports = { reactStrictMode: true, i18n: { locales: ['ko', 'en'], defaultLocale: 'ko' } };",
      ),
    ).toEqual({ defaultLocale: 'ko', locales: ['ko', 'en'] });
    expect(
      parsePreviewNextI18nConfig(
        [
          "import type { NextConfig } from 'next';",
          "const config: NextConfig = { i18n: { defaultLocale: 'en', locales: ['en-US', 'fr'] } };",
          'export default config;',
        ].join('\n'),
        'next.config.ts',
      ),
    ).toEqual({ defaultLocale: 'en', locales: ['en', 'en-US', 'fr'] });
  });

  /** Computed or malformed values are never guessed; the router keeps Next's `undefined`. */
  it('ignores computed and malformed locale values', () => {
    expect(
      parsePreviewNextI18nConfig(
        'module.exports = { i18n: { defaultLocale: process.env.LOCALE, locales: [] } };',
      ),
    ).toBeUndefined();
    expect(
      parsePreviewNextI18nConfig("module.exports = { i18n: { defaultLocale: 'ko\\u0027;x' } };"),
    ).toBeUndefined();
    expect(parsePreviewNextI18nConfig('module.exports = { images: {} };')).toBeUndefined();
  });

  /** The project file is read from disk without being executed. */
  it('reads the first config file found in the project root', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'react-preview-next-i18n-'));
    try {
      await expect(readPreviewNextI18nConfig(workspace)).resolves.toBeUndefined();
      await writeFile(
        path.join(workspace, 'next.config.js'),
        "throw new Error('must not run'); module.exports = { i18n: { defaultLocale: 'ja', locales: ['ja'] } };",
      );

      await expect(readPreviewNextI18nConfig(workspace)).resolves.toEqual({
        defaultLocale: 'ja',
        locales: ['ja'],
      });
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});

describe('static Pages Router locale', () => {
  /** `useRouter().locale` feeds i18n libraries; it must be the configured default, not a guess. */
  it('exposes the configured default locale and locales', async () => {
    const result = await build({
      absWorkingDir: PROJECT_ROOT,
      bundle: true,
      define: { 'process.env.NODE_ENV': '"test"' },
      format: 'iife',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewRouterBridgePlugin({
          enabled: false,
          nextPagesI18n: { defaultLocale: 'ko', locales: ['ko', 'en'] },
          projectRoot: PROJECT_ROOT,
        }),
      ],
      stdin: {
        contents: [
          "import Router from 'next/router';",
          'globalThis.__locale = {',
          '  defaultLocale: Router.defaultLocale,',
          '  locale: Router.locale,',
          '  locales: Router.locales,',
          '};',
        ].join('\n'),
        loader: 'js',
        resolveDir: PROJECT_ROOT,
        sourcefile: '<next-pages-router-locale>',
      },
      target: 'es2022',
      write: false,
    });
    const sandbox: Record<string, unknown> = {
      console,
      location: { hash: '', pathname: '/', search: '' },
      URL,
      URLSearchParams,
    };
    sandbox.globalThis = sandbox;
    const context = createContext(sandbox);
    runInContext(result.outputFiles[0]?.text ?? '', context, { timeout: 10_000 });

    expect(context.__locale).toEqual({ defaultLocale: 'ko', locale: 'ko', locales: ['ko', 'en'] });
  });
});
