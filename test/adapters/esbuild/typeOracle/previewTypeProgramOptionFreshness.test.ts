/** Reused bound syntax must agree with a fresh checker after project options change. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewTypeOracle } from '../../../../src/adapters/esbuild/typeOracle/previewTypeOracle';
import {
  createPreviewTypeProgram,
  PreviewTypeSourceFileCache,
  type PreviewTypeProgramInput,
} from '../../../../src/adapters/esbuild/typeOracle/previewTypeProgram';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe('type-program compiler option freshness', () => {
  it('reclassifies global declarations in both directions after moduleDetection changes', async () => {
    const fixture = await createFixture('ts', 'interface GlobalMarker { flag: "stable" }');
    const cache = new PreviewTypeSourceFileCache();
    for (const moduleDetection of ['legacy', 'force', 'legacy']) {
      await fixture.configure({ moduleDetection });
      const warm = analyze(fixture.input, cache, fixture.source);
      const fresh = analyze(fixture.input, new PreviewTypeSourceFileCache(), fixture.source);
      expect(warm.module).toBe(moduleDetection === 'force');
      expect(warm.errors).toEqual(fresh.errors);
      expect(warm.errors.includes(2304)).toBe(moduleDetection === 'force');
    }
  });

  it('reclassifies JSX-only modules when the automatic JSX runtime changes', async () => {
    const fixture = await createFixture(
      'tsx',
      'interface GlobalMarker {}\nconst element = <main />;',
    );
    const cache = new PreviewTypeSourceFileCache();
    for (const jsx of ['preserve', 'react-jsx', 'react-jsxdev', 'preserve']) {
      await fixture.configure({ jsx, moduleDetection: 'auto' });
      const warm = analyze(fixture.input, cache, fixture.source);
      const fresh = analyze(fixture.input, new PreviewTypeSourceFileCache(), fixture.source);
      expect(warm.module).toBe(jsx !== 'preserve');
      expect(warm.errors).toEqual(fresh.errors);
    }
  });

  it('refreshes binder diagnostics when fallthrough checking is enabled then disabled', async () => {
    const fixture = await createFixture(
      'ts',
      'let n = 0; switch (n) { case 1: n++; case 2: n++; }',
    );
    const cache = new PreviewTypeSourceFileCache();
    for (const noFallthroughCasesInSwitch of [false, true, false]) {
      await fixture.configure({ moduleDetection: 'legacy', noFallthroughCasesInSwitch });
      const warm = analyze(fixture.input, cache, fixture.source);
      const fresh = analyze(fixture.input, new PreviewTypeSourceFileCache(), fixture.source);
      expect(warm.errors).toEqual(fresh.errors);
      expect(warm.errors.includes(7029)).toBe(noFallthroughCasesInSwitch);
    }
  });

  it('keeps exact unchanged parses and leaves the previous program intact after a config edit', async () => {
    const fixture = await createFixture('ts', 'interface GlobalMarker { flag: "stable" }');
    const cache = new PreviewTypeSourceFileCache();
    await fixture.configure({ moduleDetection: 'legacy' });
    const first = createPreviewTypeProgram(fixture.input, cache);
    const source = first.program.getSourceFile(fixture.source);
    const second = createPreviewTypeProgram(fixture.input, cache);
    expect(second.program.getSourceFile(fixture.source)).toBe(source);
    await fixture.configure({ moduleDetection: 'force' });
    const changed = createPreviewTypeProgram(fixture.input, cache);
    expect(changed.program.getSourceFile(fixture.source)).not.toBe(source);
    expect(first.program.getSemanticDiagnostics(first.program.getSourceFile(fixture.page))).toEqual(
      [],
    );
    expect(
      changed.program
        .getSemanticDiagnostics(changed.program.getSourceFile(fixture.page))
        .map((d) => d.code),
    ).toContain(2304);
  });

  it('selects the heap budget only after invalidating option-dependent parses', async () => {
    const fixture = await createFixture('ts', 'interface GlobalMarker { flag: "stable" }');
    const cache = new PreviewTypeSourceFileCache();
    await fixture.configure({ moduleDetection: 'legacy' });
    createPreviewTypeProgram(fixture.input, cache);
    const retained = cache.textBytes();
    expect(retained).toBeGreaterThan(0);
    const observations: number[] = [];
    createPreviewTypeProgram(fixture.input, cache, (bytes) => {
      observations.push(bytes);
      return undefined;
    });
    expect(observations).toEqual([retained]);
    expect(cache.textBytes()).toBe(0);
    createPreviewTypeProgram(fixture.input, cache);
    await fixture.configure({ moduleDetection: 'force' });
    createPreviewTypeProgram(fixture.input, cache, (bytes) => {
      observations.push(bytes);
      return undefined;
    });
    expect(observations).toEqual([retained, 0]);
    expect(cache.textBytes()).toBe(0);
  });

  it('does not credit discarded parses when a changed config reaches the real heap gate', async () => {
    const fixture = await createFixture(
      'ts',
      'interface GlobalMarker { flag: "stable" }' + '/*' + 'x'.repeat(256 * 1024) + '*/',
    );
    const mib = 1024 * 1024;
    let used = 64 * mib;
    // Start roomy, then use the small campaign-worker ceiling at the next heap read.
    let limit = 4096 * mib;
    const bounded = new PreviewTypeOracle(undefined, () => ({
      heap_size_limit: limit,
      used_heap_size: used,
    }));
    await fixture.configure({ moduleDetection: 'legacy' });
    const request = { exportName: 'value', requiredPaths: [], sourcePath: fixture.page };
    const first = bounded.createView(fixture.input);
    expect(first.readTypedExportValue(request)?.value).toEqual({ flag: 'stable' });
    first.release();
    limit = 432 * mib;
    used = 190 * mib;
    const unchanged = bounded.createView(fixture.input);
    expect(unchanged.readTypedExportValue(request)?.value).toEqual({ flag: 'stable' });
    unchanged.release();
    await fixture.configure({ moduleDetection: 'force' });
    const changed = bounded.createView(fixture.input);
    expect(changed.readTypedExportValue(request)).toBeUndefined();
    expect(changed.readStatus()).toMatchObject({ skippedForHeap: true });
    expect(first.readStatus()).not.toHaveProperty('skippedForHeap');
    bounded.clear();
  });
});

/** Uses the real checker and source classification, including diagnostics stored during binding. */
function analyze(
  input: PreviewTypeProgramInput,
  cache: PreviewTypeSourceFileCache,
  source: string,
): {
  readonly errors: readonly number[];
  readonly module: boolean;
} {
  const analysis = createPreviewTypeProgram(input, cache);
  const file = analysis.program.getSourceFile(source);
  if (file === undefined) throw new Error('Fixture source was not admitted');
  return {
    errors: analysis.program.getSemanticDiagnostics().map((d) => d.code),
    module: ts.isExternalModule(file),
  };
}

/** Writes only to an owned temporary root; project configs remain static JSON data. */
async function createFixture(
  extension: string,
  text: string,
): Promise<{
  readonly configure: (options: Readonly<Record<string, unknown>>) => Promise<void>;
  readonly input: PreviewTypeProgramInput;
  readonly page: string;
  readonly source: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'type-option-freshness-'));
  roots.push(root);
  const source = path.join(root, `globals.${extension}`);
  const page = path.join(root, 'page.ts');
  const tsconfigPath = path.join(root, 'tsconfig.json');
  await writeFile(source, text);
  await writeFile(page, 'export const value: GlobalMarker = { flag: "stable" };');
  return {
    configure: async (options) =>
      writeFile(
        tsconfigPath,
        JSON.stringify({
          compilerOptions: {
            module: 'esnext',
            moduleResolution: 'bundler',
            target: 'es2022',
            strict: true,
            ...options,
          },
        }),
      ),
    input: {
      rootPaths: [page, source],
      readSnapshot: () => undefined,
      managedNodeModulesPaths: [],
      tsconfigPath,
    },
    page,
    source,
  };
}
