import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewDependencyResolutionHintPlugin } from '../../../src/adapters/esbuild/previewDependencyResolutionHintPlugin';
import { PreviewDependencyResolutionNeuralModel } from '../../../src/adapters/esbuild/previewDependencyResolutionNeuralModel';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('createPreviewDependencyResolutionHintPlugin', () => {
  /** Applies one exact compiler hint before absent server packages enter the browser graph. */
  it('loads an explicit server source as a named-import-compatible execution contract', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-neural-hint-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    await Promise.all([
      writeFile(
        entryPath,
        [
          'import { loadSecret } from "./server";',
          'const result = loadSecret();',
          'export const value = String(result);',
          'export const mapped = result.items.map((item) => item);',
          'export const filtered = result.items.filter((item) => item);',
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; import { Client } from "missing-server-sdk"; export const loadSecret = () => new Client();',
        'utf8',
      ),
    ]);

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [serverPath],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
      'neural dependency hint',
    );
    expect(result.outputFiles[0]?.text).toContain('ReactPreviewServerContract');
    expect(result.outputFiles[0]?.text).not.toContain('missing-server-sdk');
    const outputText = result.outputFiles[0]?.text;
    if (outputText === undefined) throw new Error('The facade fixture did not emit JavaScript.');
    const executed = (await import(
      `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    )) as {
      readonly filtered?: unknown;
      readonly mapped?: unknown;
      readonly value?: unknown;
    };
    expect(executed.value).toBe('Preview value');
    expect(executed.mapped).toEqual([]);
    expect(executed.filtered).toEqual([]);
  });

  /** Retains every runtime export introduced by a server factory destructuring declaration. */
  it('exposes destructured named exports from an explicit server module', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-neural-destructure-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    await Promise.all([
      writeFile(
        entryPath,
        'import { auth } from "./server"; export const value = String(auth());',
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; const createServer = () => ({ auth() {}, handlers: {} }); export const { auth, handlers } = createServer();',
        'utf8',
      ),
    ]);

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [serverPath],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    expect(result.errors).toEqual([]);
    expect(result.outputFiles[0]?.text).toContain('var auth = contract;');
    expect(result.outputFiles[0]?.text).not.toContain('createServer');
  });

  /** Replays complete adjacent-test defaults while leaving unproven exports on the neutral proxy. */
  it('embeds learned return values in an explicit server execution contract', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-learned-contract-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    const evidencePath = path.join(rootPath, 'entry.test.ts');
    await Promise.all([
      writeFile(
        entryPath,
        [
          'import { getTheme, isPublished, loadRows, unknownValue } from "./server";',
          'export async function readContract() {',
          '  return {',
          '    rows: await loadRows(),',
          '    theme: await getTheme(),',
          '    published: isPublished(),',
          '    unknown: String(unknownValue()),',
          '  };',
          '}',
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; import db from "missing-db"; export const loadRows = () => db.rows(); export const getTheme = () => db.theme(); export const isPublished = () => db.published(); export const unknownValue = () => db.unknown();',
        'utf8',
      ),
      writeFile(evidencePath, '// adjacent test evidence', 'utf8'),
    ]);
    const score = new PreviewDependencyResolutionNeuralModel().score(
      'facade-server-contract',
      {
        declaredPackageRatio: 1,
        errorDensity: 0.1,
        explicitServerBoundary: 1,
        frameworkRuntime: 0,
        jsxConsumer: 0,
        packageCoreRuntime: 0,
        packageServerAffinity: 1,
        packageUiAffinity: 0,
        styleConsumer: 0,
        targetModule: 0,
        useServerDirective: 0,
      },
      0.99,
    );

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeHints: [
            {
              contractExamples: [
                {
                  evidenceSourcePath: evidencePath,
                  exportName: 'loadRows',
                  mode: 'resolved',
                  sourcePath: serverPath,
                  value: [],
                },
                {
                  evidenceSourcePath: evidencePath,
                  exportName: 'getTheme',
                  mode: 'resolved',
                  sourcePath: serverPath,
                  value: { preset: 'minimal' },
                },
                {
                  evidenceSourcePath: evidencePath,
                  exportName: 'isPublished',
                  mode: 'returned',
                  sourcePath: serverPath,
                  value: false,
                },
              ],
              evidenceSourcePaths: [evidencePath],
              score,
              sourcePath: serverPath,
            },
          ],
          facadeSourcePaths: [serverPath],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    const outputText = result.outputFiles[0]?.text;
    if (outputText === undefined) throw new Error('The learned contract did not emit JavaScript.');
    const executed = (await import(
      `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    )) as { readonly readContract: () => Promise<unknown> };
    await expect(executed.readContract()).resolves.toEqual({
      published: false,
      rows: [],
      theme: { preset: 'minimal' },
      unknown: 'Preview value',
    });
    expect(result.outputFiles[0]?.text).not.toContain('missing-db');
  });

  /** Revalidates the authored marker so a stale model cannot facade an edited browser module. */
  it('declines a stale hint after the explicit server boundary disappears', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-stale-hint-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    await Promise.all([
      writeFile(entryPath, 'import { value } from "./server"; export { value };', 'utf8'),
      writeFile(
        serverPath,
        'import { Client } from "missing-server-sdk"; export const value = new Client();',
        'utf8',
      ),
    ]);

    const failure: unknown = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [serverPath],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );
    const errors =
      typeof failure === 'object' && failure !== null && 'errors' in failure
        ? (failure as { readonly errors?: unknown }).errors
        : undefined;
    expect(Array.isArray(errors)).toBe(true);
    expect(
      (errors as readonly unknown[]).some(
        (error) =>
          typeof error === 'object' &&
          error !== null &&
          'text' in error &&
          error.text === 'Could not resolve "missing-server-sdk"',
      ),
    ).toBe(true);
  });

  /** Keeps a wrapper intact and reports its exact fallback for build-verified training. */
  it('cooperates on an exact pino edge and reports the applied contract', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-package-hint-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const loggerPath = path.join(rootPath, 'logger.ts');
    await Promise.all([
      writeFile(
        entryPath,
        'import { logger, validLevels } from "./logger"; logger.warn("preview"); export { validLevels };',
        'utf8',
      ),
      writeFile(
        loggerPath,
        'import pino from "pino"; export const validLevels = Object.keys(pino.levels.values); export const logger = pino({ level: process.env.LOG_LEVEL });',
        'utf8',
      ),
    ]);
    const model = new PreviewDependencyResolutionNeuralModel();
    const score = model.score(
      'facade-package-contract',
      {
        declaredPackageRatio: 1,
        errorDensity: 0.1,
        explicitServerBoundary: 0,
        frameworkRuntime: 0,
        jsxConsumer: 0,
        packageCoreRuntime: 0,
        packageServerAffinity: 1,
        packageUiAffinity: 0,
        styleConsumer: 0,
        targetModule: 0,
        useServerDirective: 0,
      },
      0.98,
    );
    const onHintApplied = vi.fn();

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          onHintApplied,
          packageContractHints: [{ moduleSpecifier: 'pino', score, sourcePath: loggerPath }],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
      'cooperating deterministic and neural dependency hints',
    );
    expect(result.outputFiles[0]?.text).toContain('validLevels');
    expect(result.outputFiles[0]?.text).toContain('neutral dependency contract');
    expect(onHintApplied).toHaveBeenCalledOnce();
    expect(onHintApplied).toHaveBeenCalledWith(score);
  });

  /** Treats a neural contract as a fallback, never as a replacement for a real package graph. */
  it('keeps a normally resolvable package and does not report a fallback application', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-package-connected-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const loggerPath = path.join(rootPath, 'logger.ts');
    const packageRoot = path.join(rootPath, 'node_modules', 'connected-server-runtime');
    await mkdir(packageRoot, { recursive: true });
    await Promise.all([
      writeFile(entryPath, 'export { label } from "./logger";', 'utf8'),
      writeFile(
        loggerPath,
        'import runtime from "connected-server-runtime"; export const label = runtime.label;',
        'utf8',
      ),
      writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ main: './index.js', name: 'connected-server-runtime' }),
        'utf8',
      ),
      writeFile(path.join(packageRoot, 'index.js'), 'module.exports = { label: "real" };', 'utf8'),
    ]);
    const model = new PreviewDependencyResolutionNeuralModel();
    const score = model.score(
      'facade-package-contract',
      {
        declaredPackageRatio: 1,
        errorDensity: 0.1,
        explicitServerBoundary: 0,
        frameworkRuntime: 0,
        jsxConsumer: 0,
        packageCoreRuntime: 0,
        packageServerAffinity: 1,
        packageUiAffinity: 0,
        styleConsumer: 0,
        targetModule: 0,
        useServerDirective: 0,
      },
      0.9,
    );
    const onHintApplied = vi.fn();

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      format: 'esm',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          onHintApplied,
          packageContractHints: [
            { moduleSpecifier: 'connected-server-runtime', score, sourcePath: loggerPath },
          ],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    expect(result.warnings).toEqual([]);
    expect(result.outputFiles[0]?.text).toContain('real');
    expect(result.outputFiles[0]?.text).not.toContain('neutral dependency contract');
    expect(onHintApplied).not.toHaveBeenCalled();
  });

  /** Converts only the exact failed CSS edge to a render-only contract. */
  it('supplies an empty style contract after ordinary package resolution fails', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-style-hint-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.js');
    const stylePath = path.join(rootPath, 'styles.css');
    await Promise.all([
      writeFile(entryPath, 'import "./styles.css";', 'utf8'),
      writeFile(stylePath, '@import "missing-theme";\n.rendered { color: rebeccapurple; }', 'utf8'),
    ]);

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      logLevel: 'silent',
      outdir: path.join(rootPath, 'out'),
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          styleHints: [{ moduleSpecifier: 'missing-theme', sourcePath: stylePath }],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings.map((warning) => warning.text).join('\n')).toContain(
      'empty render-only stylesheet contract',
    );
    expect(result.outputFiles.map((file) => file.text).join('\n')).toContain(
      'color: rebeccapurple',
    );
  });

  /** Preserves full style fidelity whenever the hinted package can actually be connected. */
  it('prefers a resolvable style package over the fallback contract', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-style-connected-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.js');
    const stylePath = path.join(rootPath, 'styles.css');
    const packageRoot = path.join(rootPath, 'node_modules', 'connected-theme');
    await mkdir(packageRoot, { recursive: true });
    await Promise.all([
      writeFile(entryPath, 'import "./styles.css";', 'utf8'),
      writeFile(stylePath, '@import "connected-theme";', 'utf8'),
      writeFile(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ exports: './theme.css', main: './theme.css', name: 'connected-theme' }),
        'utf8',
      ),
      writeFile(path.join(packageRoot, 'theme.css'), '.connected { display: grid; }', 'utf8'),
    ]);

    const result = await build({
      absWorkingDir: rootPath,
      bundle: true,
      entryPoints: [entryPath],
      logLevel: 'silent',
      outdir: path.join(rootPath, 'out'),
      plugins: [
        createPreviewDependencyResolutionHintPlugin({
          facadeSourcePaths: [],
          styleHints: [{ moduleSpecifier: 'connected-theme', sourcePath: stylePath }],
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    expect(result.warnings).toEqual([]);
    expect(result.outputFiles.map((file) => file.text).join('\n')).toContain('display: grid');
  });
});
