/** Verifies evidence-bounded projection of enormous side-effect-free package root barrels. */
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build, type BuildResult, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewLargePackageBarrelPlugin } from '../../../src/adapters/esbuild/previewLargePackageBarrelPlugin';
import { PREVIEW_RESOLVE_GUARD } from '../../../src/adapters/esbuild/previewPluginProtocol';

const PACKAGE_NAME = 'large-icon-library';
const EXPORT_COUNT = 256;

describe('createPreviewLargePackageBarrelPlugin', () => {
  /** Loads only selected public leaves when every package API mapping has one exact proof. */
  it('projects named imports from a large side-effect-free barrel to exact deep exports', async () => {
    const fixture = await createLargeBarrelFixture();
    try {
      await writeFile(
        fixture.entryPath,
        [
          `import { Icon000, Icon255 } from '${PACKAGE_NAME}';`,
          'globalThis.previewResult = [Icon000, Icon255];',
        ].join('\n'),
        'utf8',
      );

      const result = await buildFixture(fixture, fixture.entryPath);

      expect(executePreview(result)).toEqual(['icon-000', 'icon-255']);
      expect(hasInput(result, 'dist/Icon000.js')).toBe(true);
      expect(hasInput(result, 'dist/Icon255.js')).toBe(true);
      expect(hasInput(result, 'dist/Icon127.js')).toBe(false);
      expect(hasInput(result, 'dist/index.js')).toBe(false);
    } finally {
      await fixture.dispose();
    }
  });

  /** Keeps syntax whose namespace semantics cannot be represented by a named deep projection. */
  it('falls back to the authored root for default, namespace, and re-export consumers', async () => {
    const fixture = await createLargeBarrelFixture();
    try {
      const cases = [
        {
          entry:
            "import rootValue from 'large-icon-library'; globalThis.previewResult = rootValue;",
          expected: 'root-default',
          name: 'default',
        },
        {
          entry:
            "import * as icons from 'large-icon-library'; globalThis.previewResult = icons.Icon000;",
          expected: 'icon-000',
          name: 'namespace',
        },
        {
          entry: "export { Icon000 as previewResult } from 'large-icon-library';",
          expected: 'icon-000',
          name: 're-export',
        },
      ] as const;
      for (const testCase of cases) {
        const entryPath = path.join(fixture.workspaceRoot, 'src', `${testCase.name}.ts`);
        await writeFile(entryPath, testCase.entry, 'utf8');

        const result = await buildFixture(fixture, entryPath);

        expect(readCaseResult(result, testCase.name)).toBe(testCase.expected);
        expect(hasInput(result, 'dist/index.js')).toBe(true);
      }
    } finally {
      await fixture.dispose();
    }
  });

  /** Refuses to guess when two public package subpaths resolve to the same physical leaf. */
  it('preserves the root barrel when the public deep export mapping is ambiguous', async () => {
    const fixture = await createLargeBarrelFixture({ ambiguousSubpath: true });
    try {
      await writeFile(
        fixture.entryPath,
        `import { Icon000 } from '${PACKAGE_NAME}'; globalThis.previewResult = Icon000;`,
        'utf8',
      );

      const result = await buildFixture(fixture, fixture.entryPath);

      expect(executePreview(result)).toBe('icon-000');
      expect(hasInput(result, 'dist/index.js')).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  /** Never bypasses a package root whose manifest says evaluation can have side effects. */
  it('preserves the root barrel when package side effects are enabled', async () => {
    const fixture = await createLargeBarrelFixture({ sideEffects: true });
    try {
      await writeFile(
        fixture.entryPath,
        `import { Icon000 } from '${PACKAGE_NAME}'; globalThis.previewResult = Icon000;`,
        'utf8',
      );

      const result = await buildFixture(fixture, fixture.entryPath);

      expect(executePreview(result)).toBe('icon-000');
      expect(hasInput(result, 'dist/index.js')).toBe(true);
    } finally {
      await fixture.dispose();
    }
  });

  /** Avoids a second parser entirely when resolved packages cannot be projected as large barrels. */
  it('does not parse authored importers for ordinary package roots', async () => {
    const fixture = await createOrdinaryPackageFixture(24);
    const importerReads: string[] = [];
    try {
      const result = await buildFixture(fixture, fixture.entryPath, {
        readSource: (sourcePath) => {
          importerReads.push(sourcePath);
          return sourcePath === fixture.entryPath ? fixture.entrySource : undefined;
        },
      });

      expect(executePreview(result)).toEqual(
        Array.from({ length: 24 }, (_, index) => `value-${index.toString()}`),
      );
      expect(importerReads).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  /** Leaves installed dependency-to-dependency imports to esbuild without TypeScript parsing. */
  it('does not inspect importers inside dependency installation directories', async () => {
    const fixture = await createNestedDependencyFixture();
    const importerReads: string[] = [];
    try {
      const result = await buildFixture(fixture, fixture.entryPath, {
        readSource: (sourcePath) => {
          importerReads.push(sourcePath);
          return sourcePath === fixture.entryPath ? fixture.entrySource : undefined;
        },
      });

      expect(executePreview(result)).toBe('nested-value');
      expect(importerReads).toEqual([]);
    } finally {
      await fixture.dispose();
    }
  });

  /** Coalesces duplicate import declarations before recursively invoking esbuild resolution. */
  it('resolves one repeated package-root edge only once per importer', async () => {
    const fixture = await createLargeBarrelFixture();
    let guardedRootResolutions = 0;
    const importerReads: string[] = [];
    const resolutionProbe: Plugin = {
      name: 'large-barrel-resolution-probe',
      setup(esbuild): void {
        esbuild.onResolve({ filter: /^large-icon-library$/ }, (arguments_) => {
          if ((arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD) {
            guardedRootResolutions += 1;
          }
          return undefined;
        });
      },
    };
    try {
      const entrySource = [
        `import { Icon000 } from '${PACKAGE_NAME}';`,
        `import { Icon001 } from '${PACKAGE_NAME}';`,
        `import { Icon255 } from '${PACKAGE_NAME}';`,
        'globalThis.previewResult = [Icon000, Icon001, Icon255];',
      ].join('\n');
      await writeFile(fixture.entryPath, entrySource, 'utf8');
      const canonicalEntryPath = await realpath(fixture.entryPath);

      const result = await buildFixture(fixture, fixture.entryPath, {
        pluginsBefore: [resolutionProbe],
        readSource: (sourcePath) => {
          importerReads.push(sourcePath);
          return sourcePath === canonicalEntryPath ? entrySource : undefined;
        },
      });

      expect(executePreview(result)).toEqual(['icon-000', 'icon-001', 'icon-255']);
      expect(guardedRootResolutions).toBe(1);
      expect(importerReads).toEqual([canonicalEntryPath]);
    } finally {
      await fixture.dispose();
    }
  });
});

/** Filesystem fixture that resembles a generated icon package with public wildcard leaf exports. */
interface LargeBarrelFixture {
  readonly dispose: () => Promise<void>;
  readonly entryPath: string;
  readonly workspaceRoot: string;
}

/** Small authored entry plus installed packages used for resolver-cost regression coverage. */
interface OrdinaryPackageFixture extends LargeBarrelFixture {
  /** Exact source returned through the editor-snapshot callback. */
  readonly entrySource: string;
}

/** Optional package evidence variations used to exercise the optimizer's fail-closed boundaries. */
interface LargeBarrelFixtureOptions {
  readonly ambiguousSubpath?: boolean;
  readonly sideEffects?: boolean;
}

/** Creates 256 direct re-exports so the package crosses the deliberately high optimization floor. */
async function createLargeBarrelFixture(
  options: LargeBarrelFixtureOptions = {},
): Promise<LargeBarrelFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-large-barrel-'));
  const packageRoot = path.join(workspaceRoot, 'node_modules', PACKAGE_NAME);
  const distributionRoot = path.join(packageRoot, 'dist');
  const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
  await Promise.all([
    mkdir(distributionRoot, { recursive: true }),
    mkdir(path.dirname(entryPath), { recursive: true }),
  ]);
  const exportMap: Record<string, unknown> = {
    '.': './dist/index.js',
    './*': './dist/*.js',
  };
  if (options.ambiguousSubpath === true) exportMap['./alias/*'] = './dist/*.js';
  await writeFile(
    path.join(packageRoot, 'package.json'),
    `${JSON.stringify({
      exports: exportMap,
      name: PACKAGE_NAME,
      sideEffects: options.sideEffects ?? false,
      type: 'module',
    })}\n`,
    'utf8',
  );
  const names = Array.from(
    { length: EXPORT_COUNT },
    (_, index) => `Icon${index.toString().padStart(3, '0')}`,
  );
  await Promise.all(
    names.map(async (name, index) => {
      await writeFile(
        path.join(distributionRoot, `${name}.js`),
        `export default ${JSON.stringify(`icon-${index.toString().padStart(3, '0')}`)};\n`,
        'utf8',
      );
    }),
  );
  await writeFile(
    path.join(distributionRoot, 'index.js'),
    [
      ...names.map((name) => `export { default as ${name} } from './${name}.js';`),
      "export default 'root-default';",
    ].join('\n'),
    'utf8',
  );
  return {
    dispose: async () => {
      await rm(workspaceRoot, { force: true, recursive: true });
    },
    entryPath,
    workspaceRoot,
  };
}

/** Creates many ordinary packages to expose importer-wide resolver overhead without large barrels. */
async function createOrdinaryPackageFixture(packageCount: number): Promise<OrdinaryPackageFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-package-imports-'));
  const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
  const packageNames = Array.from(
    { length: packageCount },
    (_, index) => `ordinary-package-${index.toString().padStart(2, '0')}`,
  );
  const entrySource = [
    ...packageNames.map(
      (packageName, index) =>
        `import { value as value${index.toString()} } from ${JSON.stringify(packageName)};`,
    ),
    `globalThis.previewResult = [${packageNames
      .map((_, index) => `value${index.toString()}`)
      .join(', ')}];`,
  ].join('\n');
  await mkdir(path.dirname(entryPath), { recursive: true });
  await Promise.all(
    packageNames.map(async (packageName, index) => {
      const packageRoot = path.join(workspaceRoot, 'node_modules', packageName);
      await mkdir(packageRoot, { recursive: true });
      await Promise.all([
        writeFile(
          path.join(packageRoot, 'package.json'),
          `${JSON.stringify({
            main: './index.js',
            name: packageName,
            sideEffects: true,
            type: 'module',
          })}\n`,
          'utf8',
        ),
        writeFile(
          path.join(packageRoot, 'index.js'),
          `export const value = ${JSON.stringify(`value-${index.toString()}`)};\n`,
          'utf8',
        ),
      ]);
    }),
  );
  await writeFile(entryPath, entrySource, 'utf8');
  return {
    dispose: async () => {
      await rm(workspaceRoot, { force: true, recursive: true });
    },
    entryPath,
    entrySource,
    workspaceRoot,
  };
}

/** Creates one dependency whose own bare import must bypass authored-source demand analysis. */
async function createNestedDependencyFixture(): Promise<OrdinaryPackageFixture> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-nested-imports-'));
  const entryPath = path.join(workspaceRoot, 'src', 'entry.ts');
  const outerRoot = path.join(workspaceRoot, 'node_modules', 'outer-package');
  const innerRoot = path.join(workspaceRoot, 'node_modules', 'inner-package');
  const entrySource = "import { value } from 'outer-package'; globalThis.previewResult = value;";
  await Promise.all([
    mkdir(path.dirname(entryPath), { recursive: true }),
    mkdir(outerRoot, { recursive: true }),
    mkdir(innerRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(entryPath, entrySource, 'utf8'),
    writeFile(
      path.join(outerRoot, 'package.json'),
      `${JSON.stringify({
        main: './index.js',
        name: 'outer-package',
        sideEffects: true,
        type: 'module',
      })}\n`,
      'utf8',
    ),
    writeFile(
      path.join(outerRoot, 'index.js'),
      "import { nested } from 'inner-package'; export const value = nested;\n",
      'utf8',
    ),
    writeFile(
      path.join(innerRoot, 'package.json'),
      `${JSON.stringify({
        main: './index.js',
        name: 'inner-package',
        sideEffects: true,
        type: 'module',
      })}\n`,
      'utf8',
    ),
    writeFile(path.join(innerRoot, 'index.js'), "export const nested = 'nested-value';\n", 'utf8'),
  ]);
  return {
    dispose: async () => {
      await rm(workspaceRoot, { force: true, recursive: true });
    },
    entryPath,
    entrySource,
    workspaceRoot,
  };
}

/** Optional instrumentation injected before the optimizer in dedicated resolver-cost tests. */
interface BuildFixtureOptions {
  /** Plugins that observe nested `build.resolve()` calls without claiming their requests. */
  readonly pluginsBefore?: readonly Plugin[];
  /** Optional current editor snapshot reader forwarded to the optimizer. */
  readonly readSource?: (sourcePath: string) => string | undefined;
}

/** Bundles entirely in memory while retaining the dependency graph for projection assertions. */
async function buildFixture(
  fixture: LargeBarrelFixture,
  entryPath: string,
  options: BuildFixtureOptions = {},
): Promise<BuildResult> {
  return await build({
    absWorkingDir: fixture.workspaceRoot,
    bundle: true,
    entryPoints: [entryPath],
    format: 'cjs',
    logLevel: 'silent',
    metafile: true,
    outdir: path.join(fixture.workspaceRoot, '.preview-out'),
    platform: 'browser',
    plugins: [
      ...(options.pluginsBefore ?? []),
      createPreviewLargePackageBarrelPlugin({
        ...(options.readSource === undefined ? {} : { readSource: options.readSource }),
        workspaceRoot: fixture.workspaceRoot,
      }),
    ],
    write: false,
  });
}

/** Executes one browser-platform CommonJS artifact in an isolated global and returns its result. */
function executePreview(result: BuildResult): unknown {
  const context: Record<string, unknown> = { exports: {}, module: { exports: {} } };
  context.globalThis = context;
  vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', context);
  return context.previewResult;
}

/** Reads either a global assignment or the CommonJS export used by the re-export syntax case. */
function readCaseResult(result: BuildResult, caseName: string): unknown {
  if (caseName !== 're-export') return executePreview(result);
  const module = { exports: {} as Record<string, unknown> };
  const context: Record<string, unknown> = { exports: module.exports, module };
  context.globalThis = context;
  vm.runInNewContext(result.outputFiles?.[0]?.text ?? '', context);
  return module.exports.previewResult;
}

/** Checks a normalized metafile input suffix without depending on temporary absolute roots. */
function hasInput(result: BuildResult, suffix: string): boolean {
  const normalizedSuffix = suffix.replaceAll('\\', '/');
  return Object.keys(result.metafile?.inputs ?? {}).some((input) =>
    input.replaceAll('\\', '/').endsWith(normalizedSuffix),
  );
}
