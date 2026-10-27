/**
 * Verifies typed server-contract exports: the type oracle describes an export's declared value
 * (unresolved package types stay marked), and the facade ranks learned mock values, then typed
 * functions, then bare-mock `undefined`, then the neutral proxy.
 */
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewDependencyResolutionHintPlugin } from '../../../src/adapters/esbuild/previewDependencyResolutionHintPlugin';
import { PreviewDependencyResolutionNeuralModel } from '../../../src/adapters/esbuild/previewDependencyResolutionNeuralModel';
import {
  PreviewTypeOracle,
  type PreviewTypedExportValue,
} from '../../../src/adapters/esbuild/typeOracle/previewTypeOracle';
import { createPreviewTypedFunctionExpression } from '../../../src/adapters/esbuild/typeOracle/previewTypedValueExpression';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIB = 1024 * 1024;
const ROOMY_HEAP = Object.freeze({ heap_size_limit: 4096 * MIB, used_heap_size: 64 * MIB });
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((rootPath) => rm(rootPath, { force: true, recursive: true })),
  );
});

describe('typed server exports', () => {
  /** Functions describe their resolved result; unresolved package types stay as markers. */
  it('reads the declared value of runtime exports only', async () => {
    const root = await mkdtemp(path.join(REPOSITORY_ROOT, 'test/fixtures/typed-server-export-'));
    temporaryRoots.push(root);
    const serverPath = path.join(root, 'src', 'server.ts');
    await mkdir(path.dirname(serverPath), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(root, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'esnext', moduleResolution: 'bundler', strict: true },
        }),
      ),
      writeFile(
        serverPath,
        [
          "import type { Membership } from 'missing-package';",
          'interface Organization { id: string; name: string }',
          'interface OrgContext { organization: Organization; membership: Membership; note?: string }',
          'export async function requireOrg(): Promise<OrgContext> { throw new Error(); }',
          'export async function getOrgSlug(): Promise<string | null> { return null; }',
          'export const LIMIT = 3;',
          'export type OnlyType = { value: string };',
          "export default function readLabel(): string { return ''; }",
        ].join('\n'),
      ),
    ]);
    const view = new PreviewTypeOracle(undefined, () => ROOMY_HEAP).createView({
      managedNodeModulesPaths: [],
      readSnapshot: () => undefined,
      rootPaths: [serverPath],
    });
    const readExport = (exportName: string): PreviewTypedExportValue | undefined =>
      view.readTypedExportValue({ exportName, requiredPaths: [], sourcePath: serverPath });
    const read = (exportName: string): unknown => readExport(exportName)?.value;

    expect(read('requireOrg')).toEqual({
      $previewTyped: 'function',
      returns: {
        $previewTyped: 'promise',
        value: {
          membership: { $previewTyped: 'unknown' },
          organization: { id: 'preview-id', name: 'Name' },
        },
      },
    });
    expect(read('default')).toEqual({ $previewTyped: 'function', returns: 'Preview' });
    expect(readExport('requireOrg')?.nullableResult).toBe(false);
    expect(readExport('getOrgSlug')?.nullableResult).toBe(true);
    expect(read('OnlyType')).toBeUndefined();
    expect(read('LIMIT')).toBe(3);
    expect(createPreviewTypedFunctionExpression(3)).toBeUndefined();
  });

  /** Learned values win; a typed function replaces the neutral proxy and non-nullable bare mocks. */
  it('ranks learned values, typed functions, bare mocks, then the neutral proxy', async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), 'react-preview-typed-contract-'));
    temporaryRoots.push(rootPath);
    const entryPath = path.join(rootPath, 'entry.ts');
    const serverPath = path.join(rootPath, 'server.ts');
    const evidencePath = path.join(rootPath, 'entry.test.ts');
    await Promise.all([
      writeFile(
        entryPath,
        [
          'import { getTheme, isPublished, loadRows, readCount, readSlug, unknownValue } from "./server";',
          'export async function readContract() {',
          '  const theme = await getTheme();',
          '  return {',
          '    rows: await loadRows(),',
          '    theme: { preset: theme.preset, extra: String(theme.extra) },',
          '    published: isPublished(),',
          '    count: readCount(),',
          '    slug: await readSlug(),',
          '    unknown: String(unknownValue()),',
          '  };',
          '}',
        ].join('\n'),
        'utf8',
      ),
      writeFile(
        serverPath,
        'import "server-only"; import db from "missing-db"; export const loadRows = () => db.rows(); export const getTheme = () => db.theme(); export const isPublished = () => db.published(); export const readCount = () => db.count(); export const readSlug = () => db.slug(); export const unknownValue = () => db.unknown();',
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
    const typedExpressions = new Map([
      ['loadRows', { expression: '() => Promise.resolve(["typed"])', nullableResult: false }],
      [
        'getTheme',
        {
          expression: '() => Promise.resolve({ preset: "typed", extra: contract })',
          nullableResult: false,
        },
      ],
      ['isPublished', { expression: '() => true', nullableResult: false }],
      ['readSlug', { expression: '() => Promise.resolve("slug")', nullableResult: true }],
    ]);
    const requestedExports: string[] = [];

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
                  mode: 'returned-undefined',
                  sourcePath: serverPath,
                },
                {
                  evidenceSourcePath: evidencePath,
                  exportName: 'readCount',
                  mode: 'returned-undefined',
                  sourcePath: serverPath,
                },
                {
                  evidenceSourcePath: evidencePath,
                  exportName: 'readSlug',
                  mode: 'returned-undefined',
                  sourcePath: serverPath,
                },
              ],
              evidenceSourcePaths: [evidencePath],
              score,
              sourcePath: serverPath,
            },
          ],
          facadeSourcePaths: [serverPath],
          readTypedExportExpression: (_sourcePath, exportName) => {
            requestedExports.push(exportName);
            return typedExpressions.get(exportName);
          },
          workspaceRoot: rootPath,
        }),
      ],
      write: false,
    });

    const outputText = result.outputFiles[0]?.text;
    if (outputText === undefined) throw new Error('The typed contract did not emit JavaScript.');
    const executed = (await import(
      `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    )) as { readonly readContract: () => Promise<unknown> };
    await expect(executed.readContract()).resolves.toEqual({
      count: undefined,
      published: true,
      rows: [],
      slug: undefined,
      theme: { extra: 'Preview value', preset: 'typed' },
      unknown: 'Preview value',
    });
    expect(requestedExports.sort()).toEqual([
      'getTheme',
      'isPublished',
      'readCount',
      'readSlug',
      'unknownValue',
    ]);
  });
});
