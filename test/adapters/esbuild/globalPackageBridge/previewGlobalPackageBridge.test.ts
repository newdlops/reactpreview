/**
 * Verifies implicit-global compatibility with real esbuild bundles and isolated package fixtures.
 * The tests execute generated browser code so import order, module identity, and tree shaking are
 * proven rather than inferred from generated strings.
 */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build, type BuildResult } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  createPreviewGlobalPackageBridgePlugin,
  createPreviewGlobalPackageBridgePlan,
  createPreviewGlobalPackageBridgeHintsFromEvidence,
  createPreviewGlobalPackageBridgeEvidencePolicy,
  discoverPreviewGlobalPackageBridges,
  type PreviewGlobalPackageBridgePlan,
} from '../../../../src/adapters/esbuild/globalPackageBridge';

describe('global package bridge discovery', () => {
  /** Converts selected source evidence into canonical workspace-module hints without guessing. */
  it('adapts runtime evidence with its exact export shape and module identity', () => {
    const hints = createPreviewGlobalPackageBridgeHintsFromEvidence({
      ambiguousGlobalNames: [],
      dependencyPaths: ['/workspace/src/bootstrap.ts', '/workspace/src/dayjs.ts'],
      evidence: [
        {
          evidenceKind: 'runtime-assignment',
          exportKind: 'default',
          globalName: 'dayjs',
          modulePath: '/workspace/src/dayjs.ts',
          moduleSpecifier: 'common/ui/utils/dayjs',
          sourcePath: '/workspace/src/bootstrap.ts',
        },
      ],
      truncated: false,
      unresolvedGlobalNames: [],
    });

    expect(hints).toEqual([
      {
        evidence: 'runtime-assignment',
        exportKind: 'default',
        globalName: 'dayjs',
        moduleSpecifier: '/workspace/src/dayjs.ts',
        resolveDir: '/workspace/src',
        watchPath: '/workspace/src/dayjs.ts',
      },
    ]);
  });

  /** Keeps the authored runtime package when TypeScript resolved its declaration-only entry. */
  it('does not import a declaration file as an implicit browser global', () => {
    const hints = createPreviewGlobalPackageBridgeHintsFromEvidence({
      ambiguousGlobalNames: [],
      dependencyPaths: ['/workspace/src/index.tsx', '/workspace/node_modules/buffer/index.d.ts'],
      evidence: [
        {
          evidenceKind: 'runtime-assignment',
          exportKind: 'named',
          exportName: 'Buffer',
          globalName: 'Buffer',
          modulePath: '/workspace/node_modules/buffer/index.d.ts',
          moduleSpecifier: 'buffer',
          sourcePath: '/workspace/src/index.tsx',
        },
      ],
      truncated: false,
      unresolvedGlobalNames: [],
    });

    expect(hints).toEqual([
      expect.objectContaining({
        exportKind: 'named',
        exportName: 'Buffer',
        globalName: 'Buffer',
        moduleSpecifier: 'buffer',
        watchPath: '/workspace/node_modules/buffer/index.d.ts',
      }),
    ]);
  });

  /** Prefers an adjacent package implementation so browser polyfills outrank Node builtin shims. */
  it('maps declaration evidence to an adjacent runtime implementation', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-runtime-module-'));
    const declarationPath = path.join(workspaceRoot, 'node_modules', 'buffer', 'index.d.ts');
    const runtimePath = path.join(workspaceRoot, 'node_modules', 'buffer', 'index.js');
    try {
      await mkdir(path.dirname(declarationPath), { recursive: true });
      await Promise.all([
        writeFile(declarationPath, 'export declare class Buffer {}', 'utf8'),
        writeFile(runtimePath, 'export class Buffer {}', 'utf8'),
      ]);

      const hints = createPreviewGlobalPackageBridgeHintsFromEvidence({
        ambiguousGlobalNames: [],
        dependencyPaths: [declarationPath],
        evidence: [
          {
            evidenceKind: 'runtime-assignment',
            exportKind: 'named',
            exportName: 'Buffer',
            globalName: 'Buffer',
            modulePath: declarationPath,
            moduleSpecifier: 'buffer',
            sourcePath: path.join(workspaceRoot, 'src', 'index.tsx'),
          },
        ],
        truncated: false,
        unresolvedGlobalNames: [],
      });

      expect(hints[0]).toMatchObject({
        moduleSpecifier: runtimePath,
        watchPath: runtimePath,
      });
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Carries ambiguity and truncation into fallback suppression instead of changing semantics. */
  it('creates fail-closed dependency fallback policy from negative strong evidence', () => {
    const ambiguousPolicy = createPreviewGlobalPackageBridgeEvidencePolicy({
      ambiguousGlobalNames: ['dayjs'],
      dependencyPaths: ['/workspace/global.d.ts'],
      evidence: [],
      truncated: false,
      unresolvedGlobalNames: ['analytics'],
    });
    const truncatedPolicy = createPreviewGlobalPackageBridgeEvidencePolicy({
      ambiguousGlobalNames: [],
      dependencyPaths: [],
      evidence: [],
      truncated: true,
      unresolvedGlobalNames: [],
    });

    expect(ambiguousPolicy).toEqual(
      expect.objectContaining({
        blockedGlobalNames: ['analytics', 'dayjs'],
        disableDependencyFallback: false,
        evidenceDependencyPaths: ['/workspace/global.d.ts'],
      }),
    );
    expect(truncatedPolicy.disableDependencyFallback).toBe(true);
  });

  /** Applies blocked-name and incomplete-inventory policy before installed package fallback. */
  it('suppresses package fallback for ambiguous names and truncated evidence', async () => {
    const fixture = await createBuildFixture('dayjs', 'export default () => null;', 'module');
    try {
      const commonOptions = {
        projectRoot: fixture.projectRoot,
        referencedGlobalNames: ['dayjs'],
        workspaceRoot: fixture.workspaceRoot,
      };
      const [ambiguousPlan, truncatedPlan] = await Promise.all([
        discoverPreviewGlobalPackageBridges({
          ...commonOptions,
          blockedGlobalNames: ['dayjs'],
        }),
        discoverPreviewGlobalPackageBridges({
          ...commonOptions,
          disableDependencyFallback: true,
        }),
      ]);

      expect(ambiguousPlan.bridges).toEqual([]);
      expect(truncatedPlan.bridges).toEqual([]);
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Finds an exact same-name dependency from a nested package through hoisted node_modules. */
  it('discovers only installed exact identifier package names', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-discovery-'));
    const projectRoot = path.join(workspaceRoot, 'packages', 'application');
    const dayjsRoot = path.join(workspaceRoot, 'node_modules', 'dayjs');
    try {
      await Promise.all([
        mkdir(projectRoot, { recursive: true }),
        mkdir(dayjsRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(workspaceRoot, 'package.json'),
          JSON.stringify({
            dependencies: {
              '@scope/tool': '1.0.0',
              'date-fns': '1.0.0',
              dayjs: '1.0.0',
              missing: '1.0.0',
              process: '1.0.0',
            },
            private: true,
          }),
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'package.json'),
          JSON.stringify({ dependencies: { dayjs: '1.0.0' }, private: true }),
          'utf8',
        ),
        writeFile(
          path.join(dayjsRoot, 'package.json'),
          JSON.stringify({ main: 'index.js', name: 'dayjs', version: '1.0.0' }),
          'utf8',
        ),
      ]);

      const plan = await discoverPreviewGlobalPackageBridges({
        maxPackageCandidates: 1,
        projectRoot,
        referencedGlobalNames: ['dayjs', 'missing'],
        workspaceRoot,
      });

      expect(plan.bridges).toEqual([
        expect.objectContaining({
          evidence: 'dependency-name',
          exportKind: 'auto',
          globalName: 'dayjs',
          moduleSpecifier: 'dayjs',
        }),
      ]);
      expect(plan.dependencyPaths).toEqual(
        expect.arrayContaining([
          await realpath(path.join(projectRoot, 'package.json')),
          await realpath(path.join(workspaceRoot, 'package.json')),
          await realpath(path.join(dayjsRoot, 'package.json')),
        ]),
      );
      expect(plan.truncated).toBe(true);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /**
   * Bridges the standard capitalized Buffer contract even when only a transitive package installed
   * it and the free reference lives in node_modules, outside workspace source instrumentation.
   */
  it('plans an installed browser Buffer polyfill before reached dependency evaluation', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-buffer-'));
    const projectRoot = path.join(workspaceRoot, 'application');
    const packageRoot = path.join(workspaceRoot, 'node_modules', 'buffer');
    const consumerRoot = path.join(workspaceRoot, 'node_modules', 'buffer-from');
    const targetPath = path.join(projectRoot, 'Target.js');
    try {
      await Promise.all([
        mkdir(projectRoot, { recursive: true }),
        mkdir(packageRoot, { recursive: true }),
        mkdir(consumerRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(workspaceRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          path.join(packageRoot, 'package.json'),
          '{"name":"buffer","version":"1.0.0","type":"module","main":"index.js"}',
          'utf8',
        ),
        writeFile(
          path.join(packageRoot, 'index.js'),
          `export const BUFFER_POLYFILL_MARKER = 'reached-buffer-polyfill';
           export class Buffer {
             static from(value) { return { toString: () => value + ':' + BUFFER_POLYFILL_MARKER }; }
           }`,
          'utf8',
        ),
        writeFile(
          path.join(consumerRoot, 'package.json'),
          '{"name":"buffer-from","version":"1.0.0","main":"index.js"}',
          'utf8',
        ),
        writeFile(
          path.join(consumerRoot, 'index.js'),
          `module.exports = value => Buffer.from(value).toString();`,
          'utf8',
        ),
      ]);
      const plan = await discoverPreviewGlobalPackageBridges({
        projectRoot,
        referencedGlobalNames: [],
        workspaceRoot,
      });
      const blockedPlan = await discoverPreviewGlobalPackageBridges({
        blockedGlobalNames: ['Buffer'],
        projectRoot,
        referencedGlobalNames: [],
        workspaceRoot,
      });
      const fixture = { plan, projectRoot, targetPath, workspaceRoot };
      const reached = await bundleAndRun(
        fixture,
        `globalThis.output = require('buffer-from')('ready');`,
      );
      const unused = await bundleFixture(fixture, `globalThis.output = 'no-buffer-reference';`);

      expect(plan.bridges).toContainEqual(
        expect.objectContaining({
          exportKind: 'named',
          exportName: 'Buffer',
          globalName: 'Buffer',
          moduleSpecifier: 'buffer/',
        }),
      );
      expect(reached.output).toBe('ready:reached-buffer-polyfill');
      expect(unused.outputFiles[0]?.text).not.toContain('reached-buffer-polyfill');
      expect(blockedPlan.bridges.some((bridge) => bridge.globalName === 'Buffer')).toBe(false);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Supports exact aliases and named exports only when supplied as inert explicit hints. */
  it('retains validated explicit export-shape hints', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-hint-'));
    const packageRoot = path.join(workspaceRoot, 'node_modules', 'date-toolkit');
    try {
      await mkdir(packageRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(workspaceRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          path.join(packageRoot, 'package.json'),
          '{"name":"date-toolkit","version":"1.0.0"}',
          'utf8',
        ),
      ]);

      const plan = await discoverPreviewGlobalPackageBridges({
        hints: [
          {
            exportKind: 'named',
            exportName: 'createDate',
            globalName: 'dateFactory',
            packageSpecifier: 'date-toolkit',
          },
          {
            globalName: 'invalid;globalThis.compromised=true',
            packageSpecifier: 'date-toolkit',
          },
        ],
        projectRoot: workspaceRoot,
        workspaceRoot,
      });

      expect(plan.bridges).toEqual([
        expect.objectContaining({
          evidence: 'explicit-hint',
          exportKind: 'named',
          exportName: 'createDate',
          globalName: 'dateFactory',
          moduleSpecifier: 'date-toolkit',
        }),
      ]);
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Gives actual project bootstrap behavior priority over declarations and bare-package fallback. */
  it('selects a project wrapper assigned by runtime evidence before ambient and package evidence', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-wrapper-'));
    const projectRoot = path.join(workspaceRoot, 'application');
    const wrapperPath = path.join(projectRoot, 'src', 'common', 'ui', 'utils', 'dayjs.js');
    const ambientPath = path.join(projectRoot, 'src', 'ambient-dayjs.js');
    const dayjsRoot = path.join(projectRoot, 'node_modules', 'dayjs');
    const targetPath = path.join(projectRoot, 'src', 'Target.js');
    try {
      await Promise.all([
        mkdir(path.dirname(wrapperPath), { recursive: true }),
        mkdir(dayjsRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"dayjs":"1.0.0"}}',
          'utf8',
        ),
        writeFile(
          path.join(projectRoot, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              baseUrl: '.',
              paths: { 'common/*': ['src/common/*'] },
            },
          }),
          'utf8',
        ),
        writeFile(
          path.join(dayjsRoot, 'package.json'),
          '{"name":"dayjs","version":"1.0.0","type":"module","main":"index.js"}',
          'utf8',
        ),
        writeFile(path.join(dayjsRoot, 'index.js'), "export default () => 'BARE_PACKAGE';", 'utf8'),
        writeFile(wrapperPath, "export default (value) => 'PROJECT_WRAPPER:' + value;", 'utf8'),
        writeFile(ambientPath, "export default () => 'AMBIENT_ONLY';", 'utf8'),
        writeFile(targetPath, "globalThis.output = dayjs('ready');", 'utf8'),
      ]);
      const plan = await discoverPreviewGlobalPackageBridges({
        hints: [
          {
            evidence: 'ambient-declaration',
            exportKind: 'default',
            globalName: 'dayjs',
            moduleSpecifier: ambientPath,
            watchPath: ambientPath,
          },
          {
            evidence: 'runtime-assignment',
            exportKind: 'default',
            globalName: 'dayjs',
            moduleSpecifier: 'common/ui/utils/dayjs',
            resolveDir: path.dirname(targetPath),
            watchPath: wrapperPath,
          },
        ],
        projectRoot,
        referencedGlobalNames: ['dayjs'],
        workspaceRoot,
      });
      const result = await build({
        bundle: true,
        format: 'iife',
        logLevel: 'silent',
        platform: 'browser',
        plugins: [createPreviewGlobalPackageBridgePlugin({ plan })],
        stdin: {
          contents: "import './Target.js';",
          loader: 'js',
          resolveDir: path.dirname(targetPath),
        },
        tsconfig: path.join(projectRoot, 'tsconfig.json'),
        write: false,
      });
      const sandbox: Record<string, unknown> = {};
      const javascript = result.outputFiles[0]?.text ?? '';
      runInNewContext(javascript, sandbox);

      expect(sandbox.output).toBe('PROJECT_WRAPPER:ready');
      expect(javascript).not.toContain('BARE_PACKAGE');
      expect(javascript).not.toContain('AMBIENT_ONLY');
      expect(plan.inventory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ evidence: 'runtime-assignment', status: 'active' }),
          expect.objectContaining({ evidence: 'ambient-declaration', status: 'shadowed' }),
          expect.objectContaining({ evidence: 'dependency-name', status: 'shadowed' }),
        ]),
      );
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Omits equal-priority module conflicts instead of choosing a wrong monorepo instance. */
  it('records equal runtime evidence with different identities as ambiguous', () => {
    const plan = createPreviewGlobalPackageBridgePlan({
      candidates: [
        {
          evidence: 'runtime-assignment',
          exportKind: 'default',
          globalName: 'dayjs',
          moduleSpecifier: '/workspace/packages/first/dayjs.ts',
          resolveDir: '/workspace/packages/first',
          watchPath: '/workspace/packages/first/dayjs.ts',
        },
        {
          evidence: 'runtime-assignment',
          exportKind: 'default',
          globalName: 'dayjs',
          moduleSpecifier: '/workspace/packages/second/dayjs.ts',
          resolveDir: '/workspace/packages/second',
          watchPath: '/workspace/packages/second/dayjs.ts',
        },
      ],
    });

    expect(plan.bridges).toEqual([]);
    expect(plan.inventory.map((item) => item.status)).toEqual(['ambiguous', 'ambiguous']);
  });
});

describe('createPreviewGlobalPackageBridgePlugin', () => {
  /** Executes a declaration-backed browser polyfill instead of injecting its erased `.d.ts`. */
  it('injects the adjacent runtime implementation for declaration evidence', async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-buffer-runtime-'));
    const projectRoot = path.join(workspaceRoot, 'application');
    const packageRoot = path.join(workspaceRoot, 'node_modules', 'buffer');
    const declarationPath = path.join(packageRoot, 'index.d.ts');
    const runtimePath = path.join(packageRoot, 'index.js');
    const targetPath = path.join(projectRoot, 'Target.js');
    try {
      await Promise.all([
        mkdir(projectRoot, { recursive: true }),
        mkdir(packageRoot, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(workspaceRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(
          declarationPath,
          'export declare class Buffer { static isBuffer(value: unknown): boolean }',
          'utf8',
        ),
        writeFile(
          runtimePath,
          'export class Buffer { static isBuffer(value) { return value === "preview-buffer"; } }',
          'utf8',
        ),
      ]);
      const hints = createPreviewGlobalPackageBridgeHintsFromEvidence({
        ambiguousGlobalNames: [],
        dependencyPaths: [targetPath, declarationPath],
        evidence: [
          {
            evidenceKind: 'runtime-assignment',
            exportKind: 'named',
            exportName: 'Buffer',
            globalName: 'Buffer',
            modulePath: declarationPath,
            moduleSpecifier: 'buffer',
            sourcePath: targetPath,
          },
        ],
        truncated: false,
        unresolvedGlobalNames: [],
      });
      const plan = await discoverPreviewGlobalPackageBridges({
        hints,
        projectRoot,
        referencedGlobalNames: ['Buffer'],
        workspaceRoot,
      });
      const result = await bundleFixture(
        { plan, projectRoot, targetPath, workspaceRoot },
        `globalThis.output = Buffer.isBuffer('preview-buffer');`,
      );
      const sandbox: Record<string, unknown> = {};
      runInNewContext(result.outputFiles[0]?.text ?? '', sandbox);

      expect(sandbox.output).toBe(true);
      expect(result.outputFiles[0]?.text).not.toContain('declare class Buffer');
    } finally {
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Evaluates an injected ESM dependency before a target's top-level `dayjs()` call. */
  it('injects an ESM default before target module evaluation', async () => {
    const fixture = await createBuildFixture(
      'dayjs',
      [
        "globalThis.order = [...(globalThis.order ?? []), 'package'];",
        "export default (value) => 'ESM:' + value;",
      ].join('\n'),
      'module',
    );
    try {
      const sandbox = await bundleAndRun(
        fixture,
        [
          "globalThis.order = [...(globalThis.order ?? []), 'target'];",
          "globalThis.output = dayjs('ready');",
        ].join('\n'),
      );

      expect(sandbox.output).toBe('ESM:ready');
      expect(sandbox.order).toEqual(['package', 'target']);
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Unwraps CommonJS `module.exports` and preserves identity with authored imports. */
  it('uses the same CommonJS package instance as an explicit import', async () => {
    const fixture = await createBuildFixture(
      'clock',
      "module.exports = (value) => 'CJS:' + value;",
      'commonjs',
    );
    try {
      const sandbox = await bundleAndRun(
        fixture,
        [
          "import importedClock from 'clock';",
          'globalThis.sameIdentity = importedClock === clock;',
          "globalThis.output = clock('ready');",
        ].join('\n'),
      );

      expect(sandbox.output).toBe('CJS:ready');
      expect(sandbox.sameIdentity).toBe(true);
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Selects named exports and full namespaces without assuming a default export exists. */
  it('supports named and namespace evidence shapes', async () => {
    const fixture = await createBuildFixture(
      'toolkit',
      "export const label = 'NAMESPACE'; export const make = (value) => 'NAMED:' + value;",
      'module',
    );
    try {
      const plan = await discoverPreviewGlobalPackageBridges({
        hints: [
          {
            exportKind: 'named',
            exportName: 'make',
            globalName: 'factory',
            packageSpecifier: 'toolkit',
          },
          {
            exportKind: 'namespace',
            globalName: 'toolkitNamespace',
            packageSpecifier: 'toolkit',
          },
        ],
        projectRoot: fixture.projectRoot,
        workspaceRoot: fixture.workspaceRoot,
      });
      const result = await bundleFixture(
        { ...fixture, plan },
        [
          "globalThis.namedOutput = factory('ready');",
          'globalThis.namespaceOutput = toolkitNamespace.label;',
        ].join('\n'),
      );
      const sandbox: Record<string, unknown> = {};
      runInNewContext(result.outputFiles[0]?.text ?? '', sandbox);

      expect(sandbox.namedOutput).toBe('NAMED:ready');
      expect(sandbox.namespaceOutput).toBe('NAMESPACE');
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Leaves locally bound names untouched and removes unused candidate package side effects. */
  it('does not override lexical bindings or bundle unused inject candidates', async () => {
    const fixture = await createBuildFixture(
      'dayjs',
      "globalThis.unexpectedPackageEvaluation = true; export default () => 'PACKAGE';",
      'module',
    );
    try {
      const result = await bundleFixture(
        fixture,
        "const dayjs = () => 'LOCAL'; globalThis.output = dayjs();",
      );
      const javascript = result.outputFiles[0]?.text ?? '';
      const sandbox: Record<string, unknown> = {};
      runInNewContext(javascript, sandbox);

      expect(sandbox.output).toBe('LOCAL');
      expect(sandbox.unexpectedPackageEvaluation).toBeUndefined();
      expect(javascript).not.toContain('unexpectedPackageEvaluation');
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });

  /** Proves an unused manifest candidate cannot resolve a broken entry before tree shaking. */
  it('does not resolve an unused candidate package with a missing browser entry', async () => {
    const fixture = await createBuildFixture(
      'dayjs',
      "export default (value) => 'VALID:' + value;",
      'module',
    );
    const brokenPackageRoot = path.join(fixture.workspaceRoot, 'node_modules', 'broken');
    try {
      await mkdir(brokenPackageRoot, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(fixture.projectRoot, 'package.json'),
          '{"private":true,"dependencies":{"broken":"1.0.0","dayjs":"1.0.0"}}',
          'utf8',
        ),
        writeFile(
          path.join(brokenPackageRoot, 'package.json'),
          '{"name":"broken","version":"1.0.0","main":"missing.js"}',
          'utf8',
        ),
      ]);
      const plan = await discoverPreviewGlobalPackageBridges({
        projectRoot: fixture.projectRoot,
        referencedGlobalNames: ['dayjs'],
        workspaceRoot: fixture.workspaceRoot,
      });
      const result = await bundleFixture(
        { ...fixture, plan },
        "globalThis.output = dayjs('ready');",
      );
      const sandbox: Record<string, unknown> = {};
      runInNewContext(result.outputFiles[0]?.text ?? '', sandbox);

      expect(sandbox.output).toBe('VALID:ready');
      expect(plan.bridges.map((bridge) => bridge.globalName)).toEqual(['dayjs']);
    } finally {
      await rm(fixture.workspaceRoot, { force: true, recursive: true });
    }
  });
});

/** Isolated package, project roots, and immutable plan shared by one real esbuild assertion. */
interface BuildFixture {
  readonly plan: PreviewGlobalPackageBridgePlan;
  readonly projectRoot: string;
  readonly targetPath: string;
  readonly workspaceRoot: string;
}

/** Creates one dependency installed only in workspace-hoisted node_modules. */
async function createBuildFixture(
  packageName: string,
  packageSource: string,
  packageType: 'commonjs' | 'module',
): Promise<BuildFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'preview-global-build-'));
  const projectRoot = path.join(workspaceRoot, 'packages', 'application');
  const packageRoot = path.join(workspaceRoot, 'node_modules', packageName);
  const targetPath = path.join(projectRoot, 'Target.js');
  await Promise.all([
    mkdir(projectRoot, { recursive: true }),
    mkdir(packageRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(workspaceRoot, 'package.json'), '{"private":true}', 'utf8'),
    writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ dependencies: { [packageName]: '1.0.0' }, private: true }),
      'utf8',
    ),
    writeFile(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({
        main: 'index.js',
        name: packageName,
        type: packageType,
        version: '1.0.0',
      }),
      'utf8',
    ),
    writeFile(path.join(packageRoot, 'index.js'), packageSource, 'utf8'),
  ]);
  const plan = await discoverPreviewGlobalPackageBridges({
    projectRoot,
    referencedGlobalNames: [packageName],
    workspaceRoot,
  });
  return { plan, projectRoot, targetPath, workspaceRoot };
}

/** Bundles one target and executes its browser-oriented IIFE in a clean VM realm. */
async function bundleAndRun(
  fixture: BuildFixture,
  sourceText: string,
): Promise<Record<string, unknown>> {
  const result = await bundleFixture(fixture, sourceText);
  const sandbox: Record<string, unknown> = {};
  runInNewContext(result.outputFiles[0]?.text ?? '', sandbox);
  return sandbox;
}

/** Writes the target and performs one build with the public bridge plugin only. */
async function bundleFixture(
  fixture: BuildFixture,
  sourceText: string,
): Promise<BuildResult<{ write: false }>> {
  await writeFile(fixture.targetPath, sourceText, 'utf8');
  return await build({
    bundle: true,
    format: 'iife',
    logLevel: 'silent',
    platform: 'browser',
    plugins: [
      createPreviewGlobalPackageBridgePlugin({
        plan: fixture.plan,
        projectRoot: fixture.projectRoot,
      }),
    ],
    stdin: {
      contents: "import './Target.js';",
      loader: 'js',
      resolveDir: fixture.projectRoot,
    },
    treeShaking: true,
    write: false,
  });
}
