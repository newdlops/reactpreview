/** Real programs must reuse package metadata within a build and observe current inputs next build. */
import { mkdir, mkdtemp, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgram,
  type PreviewTypeProgramInput,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';
import { readPreviewTypedComponentProps } from '../../../../src/adapters/esbuild/typeOracle/previewTypedComponentProps';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const EXPECTED_PROPS = {
  status: 'ready',
  item0: 0,
  item1: 1,
  item2: 2,
  item3: 3,
  item4: 4,
  item5: 5,
  item6: 6,
  item7: 7,
};

describe('analysis program package metadata', () => {
  it.each(['Node16', 'NodeNext', 'Bundler'] as const)(
    'reads one package manifest once while preserving %s declared props',
    async (resolution) => {
      const fixture = await createFixture(resolution);
      const reads = observePackageReads(fixture.manifestPath);
      const analysis = createPreviewTypeProgram(fixture.input, new PreviewTypeSourceFileCache());
      expect(readProps(analysis, fixture.pagePath)).toEqual(EXPECTED_PROPS);
      expect(analysis.status).toMatchObject({ projectFiles: 1, refusedModules: 0 });
      for (const name of ['index', 'item0', 'item7']) {
        expect(
          analysis.program.getSourceFile(path.join(fixture.packageRoot, `${name}.d.ts`))
            ?.impliedNodeFormat,
        ).toBe(ts.ModuleKind.ESNext);
      }
      expect(reads).toEqual([fixture.manifestPath]);
    },
  );

  it('rereads a changed package type for the next program using the same source cache', async () => {
    const fixture = await createFixture('NodeNext');
    const cache = new PreviewTypeSourceFileCache();
    const reads = observePackageReads(fixture.manifestPath);
    const first = createPreviewTypeProgram(fixture.input, cache);
    const declarationPath = path.join(fixture.packageRoot, 'index.d.ts');
    expect(first.program.getSourceFile(declarationPath)?.impliedNodeFormat).toBe(
      ts.ModuleKind.ESNext,
    );
    expect(readProps(first, fixture.pagePath)).toEqual(EXPECTED_PROPS);
    expect(reads).toEqual([fixture.manifestPath]);
    await writeFile(
      fixture.manifestPath,
      JSON.stringify({ name: 'payload-kit', type: 'commonjs', types: 'index.d.ts' }),
    );
    reads.length = 0;
    const second = createPreviewTypeProgram(fixture.input, cache);
    expect(second.program.getSourceFile(declarationPath)?.impliedNodeFormat).toBe(
      ts.ModuleKind.CommonJS,
    );
    expect(readProps(second, fixture.pagePath)).toEqual(EXPECTED_PROPS);
    expect(reads).toEqual([fixture.manifestPath]);
    expect(first.program.getSourceFile(declarationPath)?.impliedNodeFormat).toBe(
      ts.ModuleKind.ESNext,
    );
  });

  it('keeps current unsaved declaration text ahead of disk and prior program parses', async () => {
    const fixture = await createFixture('Bundler');
    const cache = new PreviewTypeSourceFileCache();
    const first = createPreviewTypeProgram(fixture.input, cache);
    expect(readProps(first, fixture.pagePath)).toEqual(EXPECTED_PROPS);
    const editedPath = path.join(fixture.packageRoot, 'item0.d.ts');
    const reads = observePackageReads(fixture.manifestPath);
    const next = createPreviewTypeProgram(
      {
        ...fixture.input,
        readSnapshot: (file) => (file === editedPath ? 'export type Item0 = 9;' : undefined),
      },
      cache,
    );
    expect(readProps(next, fixture.pagePath)).toEqual({ ...EXPECTED_PROPS, item0: 9 });
    expect(next.status.projectFiles).toBe(first.status.projectFiles);
    expect(next.status.refusedModules).toBe(0);
    expect(reads).toEqual([fixture.manifestPath]);
  });

  it('uses an unsaved package type on the first program without reading its saved manifest', async () => {
    const fixture = await createFixture('NodeNext');
    const reads = observePackageReads(fixture.manifestPath);
    const analysis = createPreviewTypeProgram(
      {
        ...fixture.input,
        readSnapshot: (file) =>
          file === fixture.manifestPath
            ? JSON.stringify({ name: 'payload-kit', type: 'commonjs', types: 'index.d.ts' })
            : undefined,
      },
      new PreviewTypeSourceFileCache(),
    );
    for (const name of ['index', 'item0', 'item7']) {
      expect(
        analysis.program.getSourceFile(path.join(fixture.packageRoot, `${name}.d.ts`))
          ?.impliedNodeFormat,
      ).toBe(ts.ModuleKind.CommonJS);
    }
    expect(readProps(analysis, fixture.pagePath)).toEqual(EXPECTED_PROPS);
    expect(analysis.status).toMatchObject({ projectFiles: 1, refusedModules: 0 });
    expect(reads).toEqual([]);
  });

  it('refreshes changed and discarded manifest snapshots without mutating earlier programs', async () => {
    const fixture = await createFixture('Bundler');
    const cache = new PreviewTypeSourceFileCache();
    const declarationPath = path.join(fixture.packageRoot, 'index.d.ts');
    const reads = observePackageReads(fixture.manifestPath);
    const formats = ['commonjs', 'module', undefined] as const;
    const programs = formats.map((type) =>
      createPreviewTypeProgram(
        {
          ...fixture.input,
          readSnapshot: (file) =>
            file === fixture.manifestPath && type !== undefined
              ? JSON.stringify({ name: 'payload-kit', type, types: 'index.d.ts' })
              : undefined,
        },
        cache,
      ),
    );
    expect(
      programs.map(
        (analysis) => analysis.program.getSourceFile(declarationPath)?.impliedNodeFormat,
      ),
    ).toEqual([ts.ModuleKind.CommonJS, ts.ModuleKind.ESNext, ts.ModuleKind.ESNext]);
    for (const analysis of programs) {
      expect(readProps(analysis, fixture.pagePath)).toEqual(EXPECTED_PROPS);
      expect(analysis.status).toMatchObject({ projectFiles: 1, refusedModules: 0 });
    }
    expect(reads).toEqual([fixture.manifestPath]);
  });

  it('recognizes a snapshot-only manifest in an existing package directory', async () => {
    const fixture = await createFixture('Node16');
    await unlink(fixture.manifestPath);
    const reads = observePackageReads(fixture.manifestPath);
    const analysis = createPreviewTypeProgram(
      {
        ...fixture.input,
        readSnapshot: (file) =>
          file === fixture.manifestPath
            ? JSON.stringify({ name: 'payload-kit', type: 'module', types: 'index.d.ts' })
            : undefined,
      },
      new PreviewTypeSourceFileCache(),
    );
    expect(
      analysis.program.getSourceFile(path.join(fixture.packageRoot, 'index.d.ts'))
        ?.impliedNodeFormat,
    ).toBe(ts.ModuleKind.ESNext);
    expect(readProps(analysis, fixture.pagePath)).toEqual(EXPECTED_PROPS);
    expect(analysis.status).toMatchObject({ projectFiles: 1, refusedModules: 0 });
    expect(reads).toEqual([]);
  });
});

/** Records real filesystem reads at the system boundary; the actual reader and checker still run. */
function observePackageReads(manifestPath: string): string[] {
  const reads: string[] = [];
  const readFile = ts.sys.readFile.bind(ts.sys);
  vi.spyOn(ts.sys, 'readFile').mockImplementation((fileName, encoding) => {
    if (path.normalize(fileName) === manifestPath) reads.push(fileName);
    return readFile(fileName, encoding);
  });
  return reads;
}

/** Reads actual required prop values from the program; no type/checker stand-ins are used. */
function readProps(analysis: PreviewTypeProgram, pagePath: string): unknown {
  const source = analysis.program.getSourceFile(pagePath);
  if (source === undefined) throw new Error('Fixture page not admitted');
  return readPreviewTypedComponentProps(analysis.checker, source, 'Page');
}

/** A real multi-declaration package makes repeated per-file manifest loading observable. */
async function createFixture(resolution: 'Node16' | 'NodeNext' | 'Bundler'): Promise<{
  readonly packageRoot: string;
  readonly manifestPath: string;
  readonly pagePath: string;
  readonly input: PreviewTypeProgramInput;
}> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'type-program-package-cache-')));
  roots.push(root);
  const packageRoot = path.join(root, 'node_modules', 'payload-kit');
  const manifestPath = path.join(packageRoot, 'package.json');
  const pagePath = path.join(root, 'page.mts');
  const tsconfigPath = path.join(root, 'tsconfig.json');
  await mkdir(packageRoot, { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({ name: 'payload-kit', type: 'module', types: 'index.d.ts' }),
  );
  await writeFile(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        module: resolution === 'Bundler' ? 'ESNext' : resolution,
        moduleResolution: resolution,
        strict: true,
        target: 'ES2022',
      },
    }),
  );
  await writeFile(
    pagePath,
    'import type { Props } from "payload-kit"; export function Page(props: Props) { return null; }',
  );
  const imports: string[] = [];
  const properties: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const id = index.toString();
    await writeFile(path.join(packageRoot, `item${id}.d.ts`), `export type Item${id} = ${id};`);
    imports.push(`import type { Item${id} } from "./item${id}.js";`);
    properties.push(`item${id}: Item${id};`);
  }
  await writeFile(
    path.join(packageRoot, 'index.d.ts'),
    [...imports, `export interface Props { status: 'ready'; ${properties.join(' ')} }`].join('\n'),
  );
  return {
    packageRoot,
    manifestPath,
    pagePath,
    input: {
      managedNodeModulesPaths: [],
      readSnapshot: (): string | undefined => undefined,
      rootPaths: [pagePath],
      tsconfigPath,
    },
  };
}
