/** Broad frontier failures retain exact first-edge evidence without rescanning every source per target. */
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Metafile } from 'esbuild';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyPreviewInspectorBundleFrontierMetafile } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontierMetafile';

type Options = Parameters<typeof verifyPreviewInspectorBundleFrontierMetafile>[0];
afterEach(() => vi.restoreAllMocks());

describe('frontier mismatch incoming edges', () => {
  it('diagnoses many leaked sources with bounded physical lookups and preserves the boundary edge', async () => {
    const fixture = await createFixture(32);
    let importListsRead = 0;
    for (const input of Object.values(fixture.options.metafile.inputs)) {
      const imports = input.imports;
      Object.defineProperty(input, 'imports', {
        get: (): typeof imports => {
          importListsRead += 1;
          return imports;
        },
      });
    }
    const observed = vi.spyOn(realpathSync, 'native');
    const error = captureMismatch(fixture.options);
    expect(error).toMatchObject({
      reason: 'frontier-mismatch',
      frontierMismatchEvidence: {
        cause: 'unexpected-metafile-input',
        source: { workspaceRelativePath: 'src/Leak00.ts' },
        importer: { workspaceRelativePath: 'src/zEntry.ts' },
        specifier: { value: './start' },
      },
    });
    // Rechecking every file for every leaked target causes quadratic synchronous disk work.
    const physicalLookups = observed.mock.calls.filter(([file]) =>
      String(file).startsWith(path.join(fixture.root, 'src')),
    );
    expect(physicalLookups.length).toBeLessThanOrEqual(32 * 3 + 8);
    expect(importListsRead).toBeLessThanOrEqual(32 * 3 + 8);
  });

  it('retains the first sorted importer and its authored import order', async () => {
    const fixture = await createFixture(2);
    const inputs = fixture.options.metafile.inputs;
    inputs['src/Leak00.ts'] = {
      bytes: 1,
      imports: [
        { path: 'src/Leak01.ts', original: './external', kind: 'import-statement', external: true },
        { path: 'src/Leak01.ts', original: './first', kind: 'import-statement' },
        { path: 'src/Leak01.ts', original: './second', kind: 'import-statement' },
      ],
    };
    inputs['src/Leak01.ts'] = {
      bytes: 1,
      imports: [{ path: 'src/Leak00.ts', original: './back', kind: 'import-statement' }],
    };
    inputs['src/zEntry.ts'] = { bytes: 1, imports: [] };
    expect(captureMismatch(fixture.options)).toMatchObject({
      frontierMismatchEvidence: {
        source: { workspaceRelativePath: 'src/Leak00.ts' },
        importer: { workspaceRelativePath: 'src/Leak01.ts' },
        specifier: { value: './back' },
      },
    });
    expect(
      captureMismatch({
        ...fixture.options,
        authenticSourcePaths: [path.join(fixture.root, 'src/Leak01.ts')],
      }),
    ).toMatchObject({
      frontierMismatchEvidence: {
        source: { workspaceRelativePath: 'src/Leak00.ts' },
        importer: { workspaceRelativePath: 'src/Leak01.ts' },
      },
    });
    expect(
      captureMismatch({
        ...fixture.options,
        authenticSourcePaths: [path.join(fixture.root, 'src/Leak00.ts')],
      }),
    ).toMatchObject({
      frontierMismatchEvidence: {
        source: { workspaceRelativePath: 'src/Leak01.ts' },
        importer: { workspaceRelativePath: 'src/Leak00.ts' },
        specifier: { value: './first' },
      },
    });
  });

  it('does not invent an incoming edge from external or virtual imports', async () => {
    const fixture = await createFixture(2);
    fixture.options.metafile.inputs['src/zEntry.ts'] = {
      bytes: 1,
      imports: [
        { path: 'src/Leak00.ts', original: './external', kind: 'import-statement', external: true },
      ],
    };
    fixture.options.metafile.inputs['src/Leak00.ts'] = { bytes: 1, imports: [] };
    fixture.options.metafile.inputs['react-preview-owned:virtual'] = {
      bytes: 1,
      imports: [{ path: 'src/Leak00.ts', original: './virtual', kind: 'import-statement' }],
    };
    const error = captureMismatch(fixture.options);
    expect(error).toMatchObject({
      frontierMismatchEvidence: { source: { workspaceRelativePath: 'src/Leak00.ts' } },
    });
    expect(error).not.toHaveProperty('frontierMismatchEvidence.importer');
    expect(error).not.toHaveProperty('frontierMismatchEvidence.specifier');
  });
});

/** Captures the public mismatch error, never calculating expectations with the production helpers. */
function captureMismatch(options: Options): unknown {
  try {
    verifyPreviewInspectorBundleFrontierMetafile(options);
  } catch (error) {
    return error;
  }
  throw new Error('Expected the frozen frontier to reject the unadmitted input');
}

/** Creates real source identities and a broad leaked import chain under the test run's owned root. */
async function createFixture(count: number): Promise<{ root: string; options: Options }> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'preview-meta-edges-')));
  await mkdir(path.join(root, 'src'));
  const names = Array.from(
    { length: count },
    (_, index) => `src/Leak${String(index).padStart(2, '0')}.ts`,
  );
  await Promise.all(
    [...names, 'src/zEntry.ts'].map((name) => writeFile(path.join(root, name), 'export {};')),
  );
  const inputs: Metafile['inputs'] = Object.fromEntries(
    names.map((name, index) => [
      name,
      {
        bytes: 1,
        imports:
          index + 1 < names.length
            ? [
                {
                  path: names[index + 1] ?? '',
                  original: './next',
                  kind: 'import-statement' as const,
                },
              ]
            : [],
      },
    ]),
  );
  inputs['src/zEntry.ts'] = {
    bytes: 1,
    imports: [{ path: names[0] ?? '', original: './start', kind: 'import-statement' }],
  };
  const target = path.join(root, 'src/zEntry.ts');
  return {
    root,
    options: {
      activity: {
        analysisCandidateCount: 1,
        authoredEdgeCount: count,
        corridorSourceCount: 1,
        dependencySnapshotCount: 0,
        discoveryScope: 'selected-corridor',
        discoveryTruncated: false,
        exactModuleCount: 1,
        executableCandidateCount: 1,
        frontierSourceBytes: 20,
        graphAdmission: 'unbounded',
        kind: 'bundle-frontier',
        maximumDepth: 0,
        optionalComponentCount: 0,
        packageDemandSourceCount: 0,
        phase: 'planned',
        preparationMode: 'fast',
        projectedEdgeCount: 0,
        styleSnapshotCount: 0,
        supportModuleCount: 0,
        totalAuthoredModuleCount: count + 1,
        truncated: false,
        truncationReasons: [],
      },
      authenticSourcePaths: [target],
      metafile: { inputs, outputs: {} },
      target,
      workspaceRoot: root,
    },
  };
}
