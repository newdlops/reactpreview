/**
 * Verifies bounded, non-executing discovery of import-backed application globals. The fixtures cover
 * the exact ambient/runtime split used by browser entry files while retaining fail-closed behavior
 * for ambiguity, unresolved stronger evidence, unsafe syntax, and source budgets.
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectPreviewImplicitGlobalEvidence } from '../../../src/adapters/esbuild/previewImplicitGlobalEvidence';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((temporaryRoot) => rm(temporaryRoot, { force: true, recursive: true })),
  );
});

describe('collectPreviewImplicitGlobalEvidence', () => {
  /**
   * Reproduces the common application contract: a declaration names a project wrapper while the
   * normal entry imports that wrapper and assigns it to a callable global with an `{}` fallback.
   */
  it('prefers a real imported runtime assignment over its ambient declaration', async () => {
    const projectRoot = await createTemporaryRoot();
    const sourceRoot = path.join(projectRoot, 'src');
    const declarationPath = path.join(sourceRoot, 'global.d.ts');
    const entryPath = path.join(sourceRoot, 'index.tsx');
    const wrapperPath = path.join(sourceRoot, 'common', 'utils', 'date.ts');
    await mkdir(path.dirname(wrapperPath), { recursive: true });
    await Promise.all([
      writeFile(
        declarationPath,
        [
          'declare global {',
          '  var dateTool: typeof import("common/utils/date").default;',
          '}',
          'export {};',
        ].join('\n'),
      ),
      writeFile(
        entryPath,
        [
          'import configuredDate from "common/utils/date";',
          '(globalThis as any).dateTool = configuredDate || {};',
          'throw new Error("static discovery must not execute this entry");',
        ].join('\n'),
      ),
      writeFile(wrapperPath, 'export default Object.assign(() => ({}), { locale: "static" });'),
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      resolveModule: (specifier) => (specifier === 'common/utils/date' ? wrapperPath : undefined),
      sourcePaths: [entryPath, declarationPath],
    });

    expect(result).toEqual({
      ambiguousGlobalNames: [],
      dependencyPaths: [entryPath, wrapperPath].sort(),
      evidence: [
        {
          evidenceKind: 'runtime-assignment',
          exportKind: 'default',
          globalName: 'dateTool',
          modulePath: wrapperPath,
          moduleSpecifier: 'common/utils/date',
          sourcePath: entryPath,
        },
      ],
      truncated: false,
      unresolvedGlobalNames: [],
    });
  });

  /** Supports global augmentations, script declarations, default exports, and named exports. */
  it('collects exact typeof-import members from ambient var declarations', async () => {
    const sources = new Map<string, string>([
      [
        '/workspace/src/global.d.ts',
        [
          'declare global {',
          '  var formatter: typeof import("@scope/format-runtime").format;',
          '}',
          'export {};',
        ].join('\n'),
      ],
      [
        '/workspace/src/script.d.ts',
        'declare var clock: typeof import("./clock-runtime").default;',
      ],
      [
        '/workspace/src/plain.ts',
        'declare var tokenReader: typeof import("./token-runtime").readToken;',
      ],
      [
        '/workspace/src/module.ts',
        [
          'export {};',
          'declare global {',
          '  var sessionClock: typeof import("./session-runtime").default;',
          '}',
        ].join('\n'),
      ],
    ]);
    const resolvedPaths = new Map([
      ['@scope/format-runtime', '/workspace/src/format-runtime.ts'],
      ['./clock-runtime', '/workspace/src/clock-runtime.ts'],
      ['./session-runtime', '/workspace/src/session-runtime.ts'],
      ['./token-runtime', '/workspace/src/token-runtime.ts'],
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (specifier) => resolvedPaths.get(specifier),
      sourcePaths: [...sources.keys()],
    });

    expect(result.evidence).toEqual([
      {
        evidenceKind: 'ambient-declaration',
        exportKind: 'default',
        globalName: 'clock',
        modulePath: '/workspace/src/clock-runtime.ts',
        moduleSpecifier: './clock-runtime',
        sourcePath: '/workspace/src/script.d.ts',
      },
      {
        evidenceKind: 'ambient-declaration',
        exportKind: 'named',
        exportName: 'format',
        globalName: 'formatter',
        modulePath: '/workspace/src/format-runtime.ts',
        moduleSpecifier: '@scope/format-runtime',
        sourcePath: '/workspace/src/global.d.ts',
      },
      {
        evidenceKind: 'ambient-declaration',
        exportKind: 'default',
        globalName: 'sessionClock',
        modulePath: '/workspace/src/session-runtime.ts',
        moduleSpecifier: './session-runtime',
        sourcePath: '/workspace/src/module.ts',
      },
      {
        evidenceKind: 'ambient-declaration',
        exportKind: 'named',
        exportName: 'readToken',
        globalName: 'tokenReader',
        modulePath: '/workspace/src/token-runtime.ts',
        moduleSpecifier: './token-runtime',
        sourcePath: '/workspace/src/plain.ts',
      },
    ]);
    expect(result.ambiguousGlobalNames).toEqual([]);
    expect(result.unresolvedGlobalNames).toEqual([]);
  });

  /** Retains default, named-alias, and namespace import shapes without evaluating their modules. */
  it('collects direct top-level assignments for every supported runtime import shape', async () => {
    const sourcePath = '/workspace/src/bootstrap.ts';
    const sourceText = [
      'import defaultValue from "./default-value";',
      'import { helper as localHelper, type Hidden } from "./named-value";',
      'import * as tools from "./tools";',
      'import type typeOnly from "./type-only";',
      '(globalThis as typeof globalThis).defaultValue = defaultValue ?? {};',
      'window.helperValue = localHelper;',
      'globalThis.toolkit = tools;',
      'function initializeLater() { globalThis.nested = defaultValue; }',
      'globalThis.created = createValue();',
      'globalThis.typeValue = typeOnly;',
      'otherGlobal.owner = defaultValue;',
      'globalThis["computed"] = defaultValue;',
      'void Hidden;',
    ].join('\n');
    const resolvedPaths = new Map([
      ['./default-value', '/workspace/src/default-value.ts'],
      ['./named-value', '/workspace/src/named-value.ts'],
      ['./tools', '/workspace/src/tools.ts'],
      ['./type-only', '/workspace/src/type-only.ts'],
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: () => sourceText,
      resolveModule: (specifier) => resolvedPaths.get(specifier),
      sourcePaths: [sourcePath],
    });

    expect(result.evidence).toEqual([
      {
        evidenceKind: 'runtime-assignment',
        exportKind: 'default',
        globalName: 'defaultValue',
        modulePath: '/workspace/src/default-value.ts',
        moduleSpecifier: './default-value',
        sourcePath,
      },
      {
        evidenceKind: 'runtime-assignment',
        exportKind: 'named',
        exportName: 'helper',
        globalName: 'helperValue',
        modulePath: '/workspace/src/named-value.ts',
        moduleSpecifier: './named-value',
        sourcePath,
      },
      {
        evidenceKind: 'runtime-assignment',
        exportKind: 'namespace',
        globalName: 'toolkit',
        modulePath: '/workspace/src/tools.ts',
        moduleSpecifier: './tools',
        sourcePath,
      },
    ]);
  });

  /** Recognizes a bootstrap's exact self-global fallback without executing the application entry. */
  it('collects imported values behind matching global self-fallbacks', async () => {
    const sourcePath = '/workspace/src/index.tsx';
    const sourceText = [
      'import { Buffer } from "buffer";',
      'import process from "process/browser";',
      '(window as any).Buffer = window.Buffer || Buffer;',
      'window.process = window.process ?? process;',
      'globalThis.rejected = window.unrelated || process;',
    ].join('\n');
    const resolvedPaths = new Map([
      ['buffer', '/workspace/node_modules/buffer/index.js'],
      ['process/browser', '/workspace/node_modules/process/browser.js'],
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: () => sourceText,
      resolveModule: (specifier) => resolvedPaths.get(specifier),
      sourcePaths: [sourcePath],
    });

    expect(result.evidence).toEqual([
      {
        evidenceKind: 'runtime-assignment',
        exportKind: 'named',
        exportName: 'Buffer',
        globalName: 'Buffer',
        modulePath: '/workspace/node_modules/buffer/index.js',
        moduleSpecifier: 'buffer',
        sourcePath,
      },
      {
        evidenceKind: 'runtime-assignment',
        exportKind: 'default',
        globalName: 'process',
        modulePath: '/workspace/node_modules/process/browser.js',
        moduleSpecifier: 'process/browser',
        sourcePath,
      },
    ]);
    expect(result.unresolvedGlobalNames).toEqual([]);
  });

  /** Uses runtime syntax even when lower-priority ambient evidence resolves successfully elsewhere. */
  it('applies runtime-assignment priority before comparing module identities', async () => {
    const sources = new Map<string, string>([
      ['/workspace/src/global.d.ts', 'declare var clock: typeof import("clock-package").default;'],
      [
        '/workspace/src/index.ts',
        ['import projectClock from "./configured-clock";', 'globalThis.clock = projectClock;'].join(
          '\n',
        ),
      ],
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (specifier) =>
        specifier === './configured-clock'
          ? '/workspace/src/configured-clock.ts'
          : '/workspace/node_modules/clock-package/index.d.ts',
      sourcePaths: [...sources.keys()],
    });

    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0]).toMatchObject({
      evidenceKind: 'runtime-assignment',
      modulePath: '/workspace/src/configured-clock.ts',
      moduleSpecifier: './configured-clock',
    });
  });

  /** Rejects conflicting assignments instead of choosing a filesystem-order-dependent app entry. */
  it('reports same-priority runtime ambiguity without selecting a value', async () => {
    const sources = new Map<string, string>([
      ['/workspace/src/a.ts', 'import value from "./a-runtime"; globalThis.clock = value;'],
      ['/workspace/src/b.ts', 'import value from "./b-runtime"; window.clock = value;'],
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (specifier) => `/workspace/src/${specifier.slice(2)}.ts`,
      sourcePaths: [...sources.keys()],
    });

    expect(result.evidence).toEqual([]);
    expect(result.dependencyPaths).toEqual([]);
    expect(result.ambiguousGlobalNames).toEqual(['clock']);
    expect(result.unresolvedGlobalNames).toEqual([]);
  });

  /** A stronger unresolved assignment blocks a convenient but potentially different ambient value. */
  it('reports unresolved runtime evidence instead of falling back to an ambient declaration', async () => {
    const sources = new Map<string, string>([
      ['/workspace/src/global.d.ts', 'declare var clock: typeof import("clock-package").default;'],
      [
        '/workspace/src/index.ts',
        'import configured from "./missing-configured-clock"; globalThis.clock = configured;',
      ],
    ]);

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: (sourcePath) => sources.get(sourcePath),
      resolveModule: (specifier) =>
        specifier === 'clock-package'
          ? '/workspace/node_modules/clock-package/index.d.ts'
          : undefined,
      sourcePaths: [...sources.keys()],
    });

    expect(result.evidence).toEqual([]);
    expect(result.ambiguousGlobalNames).toEqual([]);
    expect(result.unresolvedGlobalNames).toEqual(['clock']);
  });

  /**
   * Ignores declarations that are not global ambient `var` members and assignments whose right-hand
   * side could execute or whose import is erased.
   */
  it('rejects unsupported, scoped, type-only, computed, and unsafe evidence shapes', async () => {
    const sourcePath = '/workspace/src/rejected.ts';
    const sourceText = [
      'import runtimeValue from "./runtime";',
      'import type erasedValue from "./erased";',
      'export {};',
      'declare var moduleScoped: typeof import("./module-scoped").default;',
      'declare global {',
      '  let blockScoped: typeof import("./block").default;',
      '  var namespaceOnly: typeof import("./namespace");',
      '  var indexed: typeof import("./indexed")["value"];',
      '}',
      'globalThis.window = runtimeValue;',
      'globalThis.dynamic = runtimeValue || { enabled: true };',
      'globalThis.called = createRuntime(runtimeValue);',
      'globalThis.erased = erasedValue;',
    ].join('\n');

    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: () => sourceText,
      resolveModule: () => '/workspace/src/runtime.ts',
      sourcePaths: [sourcePath],
    });

    expect(result).toEqual({
      ambiguousGlobalNames: [],
      dependencyPaths: [],
      evidence: [],
      truncated: false,
      unresolvedGlobalNames: [],
    });
  });

  /** Withholds all partial evidence when file, byte, candidate, or reader budgets are incomplete. */
  it.each([
    {
      label: 'file count',
      options: { maximumFiles: 1 },
      sourcePaths: ['/workspace/a.ts', '/workspace/b.ts'],
      sourceText: 'import value from "./value"; globalThis.value = value;',
    },
    {
      label: 'per-file bytes',
      options: { maximumFileBytes: 8 },
      sourcePaths: ['/workspace/a.ts'],
      sourceText: 'import value from "./value"; globalThis.value = value;',
    },
    {
      label: 'aggregate bytes',
      options: { maximumTotalBytes: 8 },
      sourcePaths: ['/workspace/a.ts'],
      sourceText: 'import value from "./value"; globalThis.value = value;',
    },
    {
      label: 'candidate count',
      options: { maximumCandidates: 1 },
      sourcePaths: ['/workspace/a.ts'],
      sourceText: [
        'import first from "./first";',
        'import second from "./second";',
        'globalThis.first = first;',
        'globalThis.second = second;',
      ].join('\n'),
    },
  ])('fails closed when the $label safety budget is reached', async (fixture) => {
    const result = await collectPreviewImplicitGlobalEvidence({
      ...fixture.options,
      readSource: () => fixture.sourceText,
      resolveModule: () => '/workspace/value.ts',
      sourcePaths: fixture.sourcePaths,
    });

    expect(result.truncated).toBe(true);
    expect(result.evidence).toEqual([]);
    expect(result.dependencyPaths).toEqual([]);
  });

  /** A reader failure is incomplete evidence, while a missing snapshot is an ordinary absent file. */
  it('distinguishes failed source reads from explicitly absent source text', async () => {
    const failingResult = await collectPreviewImplicitGlobalEvidence({
      readSource: () => {
        throw new Error('permission denied');
      },
      resolveModule: () => '/workspace/value.ts',
      sourcePaths: ['/workspace/a.ts'],
    });
    const absentResult = await collectPreviewImplicitGlobalEvidence({
      readSource: () => undefined,
      resolveModule: () => '/workspace/value.ts',
      sourcePaths: ['/workspace/a.ts'],
    });

    expect(failingResult.truncated).toBe(true);
    expect(absentResult.truncated).toBe(false);
    expect(absentResult.evidence).toEqual([]);
  });

  /** Resolver exceptions and non-absolute results remain visible as unresolved static evidence. */
  it.each([
    ['relative result', () => './value.ts'],
    [
      'resolver exception',
      () => {
        throw new Error('bad project configuration');
      },
    ],
  ])('fails closed on a %s', async (_label, resolver) => {
    const sourcePath = '/workspace/index.ts';
    const result = await collectPreviewImplicitGlobalEvidence({
      readSource: () => 'import value from "./value"; globalThis.value = value;',
      resolveModule: resolver,
      sourcePaths: [sourcePath],
    });

    expect(result.evidence).toEqual([]);
    expect(result.unresolvedGlobalNames).toEqual(['value']);
  });
});

/** Creates and tracks one real directory used to exercise the default bounded filesystem reader. */
async function createTemporaryRoot(): Promise<string> {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-global-evidence-'));
  temporaryRoots.push(temporaryRoot);
  return temporaryRoot;
}
