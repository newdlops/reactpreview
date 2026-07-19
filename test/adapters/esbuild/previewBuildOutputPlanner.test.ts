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
  MAX_PREVIEW_OUTPUT_FILES,
  planPreviewBuildOutputs,
  PreviewBuildOutputPlannerError,
  type PreviewBuildOutputPlannerOptions,
} from '../../../src/adapters/esbuild/previewBuildOutputPlanner';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const VIRTUAL_ENTRY_NAME = '<preview-output-planner-entry>';

describe('planPreviewBuildOutputs', () => {
  /** Keeps one dynamically imported component's CSS behind the same browser loading boundary. */
  it('plans real esbuild lazy JavaScript and route-local CSS output', async () => {
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
        chunkNames: 'chunks/[hash]',
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
        /import\("\.\/chunks\/[A-Z0-9]+\.js"\)/u,
      );
      expect(plan.entryStylesheet).toBeUndefined();
      expect(plan.auxiliaryJavaScript).toHaveLength(1);
      expect(plan.auxiliaryStylesheets).toHaveLength(1);
      expect(plan.auxiliaryJavaScript[0]?.relativePath).toMatch(/^chunks\/[A-Z0-9]+\.js$/u);
      expect(
        new TextDecoder().decode(plan.auxiliaryJavaScript[0]?.contents ?? new Uint8Array()),
      ).toContain('LAZY_CHILD_MARKER');
      expect(new TextDecoder().decode(plan.auxiliaryJavaScript[0]?.contents)).toContain(
        'newdlops.react-preview.lazy-styles.v1',
      );
      expect(new TextDecoder().decode(plan.auxiliaryStylesheets[0]?.contents)).toContain(
        '.lazy-child',
      );
      expect(new TextDecoder().decode(plan.entryJavaScript)).toContain(
        plan.auxiliaryStylesheets[0]?.relativePath,
      );
    } finally {
      await rm(fixtureDirectory, { force: true, recursive: true });
    }
  });

  /** Prevents a nested lazy feature's global CSS from entering its parent page stylesheet. */
  it('separates nested dynamic-import stylesheet ownership', async () => {
    const fixtureDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/output-planner-nested-style-'),
    );
    const outputDirectory = path.join(fixtureDirectory, 'react-preview-output');
    try {
      await Promise.all([
        writeFile(
          path.join(fixtureDirectory, 'page.js'),
          "import './page.css'; export const openEditor = () => import('./editor.js');",
          'utf8',
        ),
        writeFile(path.join(fixtureDirectory, 'page.css'), 'body { margin: 0; }', 'utf8'),
        writeFile(
          path.join(fixtureDirectory, 'editor.js'),
          "import './editor.css'; export const editor = true;",
          'utf8',
        ),
        writeFile(path.join(fixtureDirectory, 'editor.css'), 'body { margin: 1rem; }', 'utf8'),
      ]);
      const result = await build({
        absWorkingDir: fixtureDirectory,
        bundle: true,
        chunkNames: 'chunks/[hash]',
        entryNames: 'entry',
        format: 'esm',
        metafile: true,
        outdir: outputDirectory,
        splitting: true,
        stdin: {
          contents: "globalThis.__previewPage = () => import('./page.js');",
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
      const stylesheets = plan.auxiliaryStylesheets.map((output) =>
        new TextDecoder().decode(output.contents),
      );

      expect(stylesheets).toHaveLength(2);
      expect(stylesheets).toContainEqual(expect.stringContaining('margin: 0'));
      expect(stylesheets).toContainEqual(expect.stringContaining('margin: 1rem'));
      expect(
        stylesheets.some(
          (stylesheet) => stylesheet.includes('margin: 0') && stylesheet.includes('margin: 1rem'),
        ),
      ).toBe(false);
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
    expect(plan.auxiliaryStylesheets).toEqual([]);
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

  /** Keeps the entry at the session root because its generated `./chunks` imports are not rewritten. */
  it('rejects a nested virtual entry output', () => {
    const fixture = createDirectPlannerFixture(['entries/entry.js']);

    expect(() => planPreviewBuildOutputs(fixture)).toThrow(/output root/u);
  });

  /** Enforces a finite artifact count even for otherwise valid code-split output paths. */
  it('rejects builds above the auxiliary file budget', () => {
    const paths = [
      'entry.js',
      ...Array.from(
        { length: MAX_PREVIEW_OUTPUT_FILES },
        (_, index) => `chunks/chunk-${index.toString()}.js`,
      ),
    ];
    const fixture = createDirectPlannerFixture(paths);

    expect(() => planPreviewBuildOutputs(fixture)).toThrow(
      new RegExp(`more than ${MAX_PREVIEW_OUTPUT_FILES.toString()}`, 'u'),
    );
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
      createMetadataOutput(
        relativePath === 'entry.js' || relativePath.endsWith('/entry.js')
          ? VIRTUAL_ENTRY_NAME
          : undefined,
      ),
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
