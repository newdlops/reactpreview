/**
 * Verifies multi-file esbuild output planning before compiler and artifact-store integration.
 * Real code-splitting output proves metadata joining, while direct fixtures exercise path attacks
 * that esbuild itself does not normally emit.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Metafile, type OutputFile } from 'esbuild';
import { describe, expect, it } from 'vitest';
import {
  planPreviewBuildOutputs,
  PreviewBuildOutputPlannerError,
  type PreviewBuildOutputPlannerOptions,
} from '../../../src/adapters/esbuild/previewBuildOutputPlanner';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VIRTUAL_ENTRY_NAME = '<preview-output-planner-entry>';

describe('planPreviewBuildOutputs', () => {
  /** Selects entry artifacts while retaining only lazy JavaScript as publishable auxiliaries. */
  it('plans real esbuild lazy JavaScript and aggregate entry CSS output', async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/output-planner-preview-'),
    );
    const outputDirectory = path.join(fixtureDirectory, 'react-preview-output');
    try {
      await Promise.all([
        writeFile(
          path.join(fixtureDirectory, 'lazy-child.js'),
          "import './lazy-child.css'; export const marker = 'LAZY_CHILD_MARKER';",
          'utf8',
        ),
        writeFile(
          path.join(fixtureDirectory, 'lazy-child.css'),
          '.lazy-child { color: rebeccapurple; }',
          'utf8',
        ),
      ]);
      const result = await build({
        absWorkingDir: fixtureDirectory,
        bundle: true,
        chunkNames: 'chunks/[name]-[hash]',
        entryNames: 'entry',
        format: 'esm',
        metafile: true,
        outdir: outputDirectory,
        splitting: true,
        stdin: {
          contents: "globalThis.__previewLazy = () => import('./lazy-child.js');",
          loader: 'js',
          resolveDir: fixtureDirectory,
          sourcefile: VIRTUAL_ENTRY_NAME,
        },
        write: false,
      });

      const plan = planPreviewBuildOutputs({
        absoluteOutputDirectory: outputDirectory,
        absoluteWorkingDirectory: fixtureDirectory,
        metafile: result.metafile,
        outputFiles: result.outputFiles,
        virtualEntryName: VIRTUAL_ENTRY_NAME,
      });

      expect(new TextDecoder().decode(plan.entryJavaScript)).toMatch(
        /import\("\.\/chunks\/lazy-child-[A-Z0-9]+\.js"\)/u,
      );
      expect(new TextDecoder().decode(plan.entryStylesheet)).toContain('.lazy-child');
      expect(plan.auxiliaryJavaScript).toHaveLength(1);
      expect(plan.auxiliaryJavaScript[0]?.relativePath).toMatch(
        /^chunks\/lazy-child-[A-Z0-9]+\.js$/u,
      );
      expect(
        new TextDecoder().decode(plan.auxiliaryJavaScript[0]?.contents ?? new Uint8Array()),
      ).toContain('LAZY_CHILD_MARKER');
      expect(
        plan.auxiliaryJavaScript.every((output) => !output.relativePath.endsWith('.css')),
      ).toBe(true);
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  /** Sorts auxiliary paths independently of esbuild output-array and metadata insertion order. */
  it('returns auxiliary JavaScript in deterministic POSIX path order', () => {
    const fixture = createDirectPlannerFixture([
      'chunks/z-last.js',
      'entry.js',
      'chunks/a-first.js',
    ]);

    const plan = planPreviewBuildOutputs(fixture);

    expect(plan.auxiliaryJavaScript.map((output) => output.relativePath)).toEqual([
      'chunks/a-first.js',
      'chunks/z-last.js',
    ]);
  });

  /** Rejects duplicate bytes for one artifact identity before a store can overwrite a chunk. */
  it('rejects duplicate output paths', () => {
    const fixture = createDirectPlannerFixture(['entry.js']);
    const duplicate = createOutputFile(
      fixture.absoluteOutputDirectory,
      'entry.js',
      'duplicate entry',
    );

    expect(() =>
      planPreviewBuildOutputs({
        ...fixture,
        outputFiles: [...fixture.outputFiles, duplicate],
      }),
    ).toThrow(/duplicate output path/u);
  });

  /** Rejects lexical traversal even when normalization would place the final path under outdir. */
  it('rejects traversal and backslash output paths', () => {
    const traversalFixture = createDirectPlannerFixture(['entry.js']);
    const traversalEntry = createRawOutputFile(
      `${traversalFixture.absoluteOutputDirectory}/chunks/../entry.js`,
      'entry',
    );
    expect(() =>
      planPreviewBuildOutputs({ ...traversalFixture, outputFiles: [traversalEntry] }),
    ).toThrow(/traversal or redundant/u);

    const backslashFixture = createDirectPlannerFixture(['entry.js']);
    const backslashEntry = createRawOutputFile(
      `${backslashFixture.absoluteOutputDirectory}/chunks\\entry.js`,
      'entry',
    );
    expect(() =>
      planPreviewBuildOutputs({ ...backslashFixture, outputFiles: [backslashEntry] }),
    ).toThrow(/backslashes/u);
  });

  /** Rejects NUL and absolute metadata keys instead of joining them below global storage. */
  it('rejects unsafe metadata paths', () => {
    const nulFixture = createDirectPlannerFixture(['entry.js']);
    const entryMetadata = requireMetadataOutput(nulFixture.metafile.outputs['out/entry.js']);
    const nulMetafile = createMetafile({ 'out/entry\0.js': entryMetadata });
    expect(() => planPreviewBuildOutputs({ ...nulFixture, metafile: nulMetafile })).toThrow(
      /safe POSIX relative path/u,
    );

    const absoluteFixture = createDirectPlannerFixture(['entry.js']);
    const absoluteMetafile = createMetafile({
      [path.join(absoluteFixture.absoluteOutputDirectory, 'entry.js')]: requireMetadataOutput(
        absoluteFixture.metafile.outputs['out/entry.js'],
      ),
    });
    expect(() =>
      planPreviewBuildOutputs({ ...absoluteFixture, metafile: absoluteMetafile }),
    ).toThrow(/safe POSIX relative path/u);
  });

  /** Requires every byte output and metadata output to have an exact counterpart. */
  it('rejects missing metadata and missing in-memory output files', () => {
    const missingMetadata = createDirectPlannerFixture(['entry.js', 'chunks/lazy.js']);
    expect(() =>
      planPreviewBuildOutputs({
        ...missingMetadata,
        metafile: createMetafile({
          'out/entry.js': requireMetadataOutput(missingMetadata.metafile.outputs['out/entry.js']),
        }),
      }),
    ).toThrow(/missing metafile metadata/u);

    const missingBytes = createDirectPlannerFixture(['entry.js', 'chunks/lazy.js']);
    expect(() =>
      planPreviewBuildOutputs({
        ...missingBytes,
        outputFiles: [requireOutputFile(missingBytes.outputFiles[0])],
      }),
    ).toThrow(/missing in-memory bytes/u);
  });

  /** Keeps every non-entry JavaScript file inside the dedicated chunk namespace. */
  it('rejects auxiliary JavaScript outside chunks', () => {
    const fixture = createDirectPlannerFixture(['entry.js', 'lazy.js']);

    expect(() => planPreviewBuildOutputs(fixture)).toThrow(/below chunks/u);
  });

  /** Enforces a finite artifact count even for otherwise valid code-split output paths. */
  it('rejects builds above the auxiliary file budget', () => {
    const paths = [
      'entry.js',
      ...Array.from({ length: 128 }, (_, index) => `chunks/chunk-${index.toString()}.js`),
    ];
    const fixture = createDirectPlannerFixture(paths);

    expect(() => planPreviewBuildOutputs(fixture)).toThrow(/more than 128/u);
  });
});

/** Creates internally consistent direct output and metadata fixtures for policy-focused tests. */
function createDirectPlannerFixture(
  relativePaths: readonly string[],
): PreviewBuildOutputPlannerOptions {
  const absoluteWorkingDirectory = path.resolve(PROJECT_ROOT, '.planner-fixture');
  const absoluteOutputDirectory = path.join(absoluteWorkingDirectory, 'out');
  const outputFiles = relativePaths.map((relativePath) =>
    createOutputFile(absoluteOutputDirectory, relativePath, `contents:${relativePath}`),
  );
  const outputs = Object.fromEntries(
    relativePaths.map((relativePath) => [
      `out/${relativePath}`,
      createMetadataOutput(relativePath === 'entry.js' ? VIRTUAL_ENTRY_NAME : undefined),
    ]),
  );
  return {
    absoluteOutputDirectory,
    absoluteWorkingDirectory,
    metafile: createMetafile(outputs),
    outputFiles,
    virtualEntryName: VIRTUAL_ENTRY_NAME,
  };
}

/** Creates one absolute fake esbuild output while retaining native path separators. */
function createOutputFile(
  outputDirectory: string,
  relativePath: string,
  contents: string,
): OutputFile {
  return createRawOutputFile(path.join(outputDirectory, ...relativePath.split('/')), contents);
}

/** Creates the complete OutputFile surface used by the planner without invoking esbuild. */
function createRawOutputFile(outputPath: string, source: string): OutputFile {
  const contents = new TextEncoder().encode(source);
  return {
    contents,
    hash: `hash:${source}`,
    path: outputPath,
    get text(): string {
      return new TextDecoder().decode(contents);
    },
  };
}

/** Creates minimal output metadata with an optional virtual entry identity. */
function createMetadataOutput(entryPoint: string | undefined): Metafile['outputs'][string] {
  return {
    bytes: 1,
    exports: [],
    imports: [],
    inputs: {},
    ...(entryPoint === undefined ? {} : { entryPoint }),
  };
}

/** Wraps direct output metadata in the complete esbuild metafile shape. */
function createMetafile(outputs: Metafile['outputs']): Metafile {
  return { inputs: {}, outputs };
}

/** Narrows intentionally optional record lookups for malicious metadata fixture construction. */
function requireMetadataOutput(
  output: Metafile['outputs'][string] | undefined,
): Metafile['outputs'][string] {
  if (output === undefined) {
    throw new PreviewBuildOutputPlannerError('Test fixture metadata output is missing.');
  }
  return output;
}

/** Narrows an optional array lookup used to remove one file from a direct planner fixture. */
function requireOutputFile(output: OutputFile | undefined): OutputFile {
  if (output === undefined) {
    throw new PreviewBuildOutputPlannerError('Test fixture output file is missing.');
  }
  return output;
}
