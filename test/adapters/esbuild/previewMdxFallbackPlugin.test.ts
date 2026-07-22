/**
 * Verifies the bounded generic MDX fallback independently from project framework configuration.
 * Every fixture uses the production esbuild plugin and an isolated workspace so query handling,
 * dependency preservation, fail-soft compilation, and canonical path security remain observable.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { build, type BuildResult, type OutputFile, type Plugin } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewMdxFallbackPlugin } from '../../../src/adapters/esbuild/previewMdxFallbackPlugin';

const PROJECT_NODE_MODULES = path.resolve('node_modules');

describe('createPreviewMdxFallbackPlugin', () => {
  /** Compiles directly imported MDX and supplies safe Fumadocs-compatible metadata exports. */
  it('provides frontmatter, toc, structured data, and a default component without loading config', async () => {
    const fixture = await createMdxFixture('metadata');
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'source.config.mjs'),
          "throw new Error('PROJECT_MDX_CONFIG_MUST_NOT_EXECUTE');",
          'utf8',
        ),
        writeFile(
          fixture.documentPath,
          [
            '---',
            'title: Preview Guide',
            'published: true',
            'tags: [react, preview]',
            'owner:',
            '  name: Newdlops',
            '---',
            '',
            '# Overview',
            '',
            'This paragraph explains the preview.',
            '',
            '## Details',
            '',
            '<Callout>Nested MDX content</Callout>',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          fixture.entryPath,
          [
            "import Content, { frontmatter, structuredData, toc } from './document.mdx';",
            'globalThis.__previewMdxResult = {',
            '  componentType: typeof Content,',
            '  frontmatter,',
            '  structuredData,',
            '  toc,',
            '};',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await buildMdxFixture(fixture);
      const runtime = executePreviewMdxBundle(result.outputFiles ?? []);
      expect(runtime).toMatchObject({
        componentType: 'function',
        frontmatter: {
          owner: { name: 'Newdlops' },
          published: true,
          tags: ['react', 'preview'],
          title: 'Preview Guide',
        },
        structuredData: {
          contents: [{ content: 'This paragraph explains the preview.', heading: 'overview' }],
          headings: [
            { content: 'Overview', id: 'overview' },
            { content: 'Details', id: 'details' },
          ],
        },
        toc: [
          { depth: 1, title: 'Overview', url: '#overview' },
          { depth: 2, title: 'Details', url: '#details' },
        ],
      });
      expect(result.warnings).toHaveLength(0);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Skips malformed body compilation for metadata-only queries and keeps suffix cache identities. */
  it('handles only=frontmatter without compiling the body or aliasing a full-content suffix', async () => {
    const fixture = await createMdxFixture('frontmatter-only');
    const plugin = createPreviewMdxFallbackPlugin({ workspaceRoot: fixture.root });
    try {
      await writeFile(
        fixture.documentPath,
        ['---', 'title: Metadata Only', '---', '', '<Unclosed'].join('\n'),
        'utf8',
      );
      await writeFile(
        fixture.entryPath,
        [
          "import Content, { frontmatter } from './document.mdx?collection=docs&only=frontmatter';",
          'globalThis.__previewMdxResult = { frontmatter, rendered: Content({}) };',
        ].join('\n'),
        'utf8',
      );
      const metadataOnly = await buildMdxFixture(fixture, [plugin]);
      expect(executePreviewMdxBundle(metadataOnly.outputFiles ?? [])).toMatchObject({
        frontmatter: { title: 'Metadata Only' },
        rendered: null,
      });
      expect(metadataOnly.warnings).toHaveLength(0);

      await writeFile(
        fixture.entryPath,
        [
          "import Content from './document.mdx';",
          'const element = Content({});',
          "globalThis.__previewMdxResult = element.props['data-react-preview-mdx-fallback'];",
        ].join('\n'),
        'utf8',
      );
      const fullContent = await buildMdxFixture(fixture, [plugin]);
      expect(executePreviewMdxBundle(fullContent.outputFiles ?? [])).toBe('true');
      expect(
        fullContent.warnings.some((warning) => warning.text.includes('compilation failed')),
      ).toBe(true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Avoids compiling or resolving every body imported by an eager documentation catalog. */
  it('loads collection imports as bounded metadata and warns only once per build', async () => {
    const fixture = await createMdxFixture('collection-metadata');
    const secondDocumentPath = path.join(fixture.root, 'second.mdx');
    try {
      await Promise.all([
        writeFile(
          fixture.documentPath,
          [
            '---',
            'title: Collection Guide',
            'description: Bounded catalog summary',
            '---',
            '',
            "import MissingBodyDependency from './missing-body-dependency'",
            '',
            '<Unclosed',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          secondDocumentPath,
          [
            '---',
            'title: Second Guide',
            '---',
            '',
            "import AnotherMissingDependency from './another-missing-dependency'",
            '',
            '<AlsoUnclosed',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          fixture.entryPath,
          [
            "import First, { frontmatter, structuredData, toc } from './document.mdx?collection=docs';",
            "import Second from './second.mdx?collection=docs';",
            'const element = First({});',
            'globalThis.__previewMdxResult = {',
            '  description: element.props.children[1].props.children,',
            '  frontmatter,',
            "  marker: element.props['data-react-preview-mdx-collection'],",
            '  secondType: typeof Second,',
            '  structuredData,',
            '  title: element.props.children[0].props.children,',
            '  toc,',
            '};',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await buildMdxFixture(fixture);
      expect(executePreviewMdxBundle(result.outputFiles ?? [])).toMatchObject({
        description: 'Bounded catalog summary',
        frontmatter: {
          description: 'Bounded catalog summary',
          title: 'Collection Guide',
        },
        marker: 'metadata-first',
        secondType: 'function',
        structuredData: { contents: [], headings: [] },
        title: 'Collection Guide',
        toc: [],
      });
      expect(
        result.warnings.filter((warning) => warning.text.includes('metadata-first mode')),
      ).toHaveLength(1);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Preserves authored imports and named exports while ordinary esbuild plugins own dependencies. */
  it('keeps CSS and component imports and does not duplicate authored metadata exports', async () => {
    const fixture = await createMdxFixture('imports');
    try {
      await Promise.all([
        writeFile(
          fixture.documentPath,
          [
            "import './document.css'",
            "import { Panel } from './Panel'",
            "export const toc = [{ title: 'Authored', url: '#authored', depth: 2 }]",
            '',
            '# Generated Heading',
            '',
            '<Panel />',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          path.join(fixture.root, 'Panel.tsx'),
          'export function Panel() { return <aside>PANEL_IMPORT_MARKER</aside>; }',
          'utf8',
        ),
        writeFile(
          path.join(fixture.root, 'document.css'),
          '.MDX_CSS_IMPORT_MARKER { color: rgb(12, 34, 56); }',
          'utf8',
        ),
        writeFile(
          fixture.entryPath,
          [
            "import Content, { toc } from './document.mdx';",
            'globalThis.__previewMdxResult = { componentType: typeof Content, toc };',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await buildMdxFixture(fixture);
      const runtime = executePreviewMdxBundle(result.outputFiles ?? []);
      const javascript = readPreviewMdxOutput(result.outputFiles ?? [], '.js');
      const stylesheet = readPreviewMdxOutput(result.outputFiles ?? [], '.css');
      expect(runtime).toMatchObject({
        componentType: 'function',
        toc: [{ depth: 2, title: 'Authored', url: '#authored' }],
      });
      expect(javascript).toContain('PANEL_IMPORT_MARKER');
      expect(stylesheet).toContain('MDX_CSS_IMPORT_MARKER');
      expect(stylesheet).toContain('rgb(12, 34, 56)');
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Uses React's classic API so an installed React 16 runtime needs no jsx-runtime subpath. */
  it('compiles MDX without requiring react/jsx-runtime', async () => {
    const fixture = await createMdxFixture('react-16-classic');
    try {
      await Promise.all([
        writeFile(fixture.documentPath, '# Classic React', 'utf8'),
        writeFile(
          fixture.entryPath,
          [
            "import Content from './document.mdx';",
            'const element = Content({});',
            'globalThis.__previewMdxResult = {',
            '  children: element.props.children,',
            '  type: element.type,',
            '};',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await buildMdxFixture(fixture, [
        createPreviewMdxFallbackPlugin({ workspaceRoot: fixture.root }),
        createReact16RuntimeFixturePlugin(),
      ]);

      expect(executePreviewMdxBundle(result.outputFiles ?? [])).toMatchObject({
        children: 'Classic React',
        type: 'h1',
      });
      expect(readPreviewMdxOutput(result.outputFiles ?? [], '.js')).not.toContain(
        'react/jsx-runtime',
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Converts one malformed document to a visible static module instead of failing the page graph. */
  it('degrades compilation errors to a renderable placeholder and retains frontmatter', async () => {
    const fixture = await createMdxFixture('syntax-fallback');
    try {
      await Promise.all([
        writeFile(
          fixture.documentPath,
          ['---', 'title: Broken Guide', '---', '', '# Broken', '', '<Unclosed'].join('\n'),
          'utf8',
        ),
        writeFile(
          fixture.entryPath,
          [
            "import Content, { frontmatter } from './document.mdx';",
            'const element = Content({});',
            'globalThis.__previewMdxResult = {',
            '  componentType: typeof Content,',
            "  fallback: element.props['data-react-preview-mdx-fallback'],",
            '  frontmatter,',
            '};',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await buildMdxFixture(fixture);
      const runtime = executePreviewMdxBundle(result.outputFiles ?? []);
      expect(runtime).toMatchObject({
        componentType: 'function',
        fallback: 'true',
        frontmatter: { title: 'Broken Guide' },
      });
      expect(result.warnings.some((warning) => warning.text.includes('static MDX fallback'))).toBe(
        true,
      );
      expect(result.warnings.some((warning) => warning.text.includes('compilation failed'))).toBe(
        true,
      );
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Uses a bounded placeholder without reading an individually oversized MDX document. */
  it('keeps oversized documents inside the static output budget', async () => {
    const fixture = await createMdxFixture('source-budget');
    try {
      await Promise.all([
        writeFile(fixture.documentPath, 'x'.repeat(2 * 1024 * 1024 + 1), 'utf8'),
        writeFile(
          fixture.entryPath,
          [
            "import Content from './document.mdx';",
            'const element = Content({});',
            "globalThis.__previewMdxResult = element.props['data-react-preview-mdx-fallback'];",
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await buildMdxFixture(fixture);
      expect(executePreviewMdxBundle(result.outputFiles ?? [])).toBe('true');
      expect(result.warnings.some((warning) => warning.text.includes('2 MiB'))).toBe(true);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  /** Rejects an in-workspace symlink whose canonical MDX target escapes the trusted boundary. */
  it('does not compile MDX reached through an outside-workspace symlink', async () => {
    const fixture = await createMdxFixture('outside-symlink');
    const outsideRoot = await mkdtemp(path.join(tmpdir(), 'react-preview-mdx-outside-'));
    const outsideDocument = path.join(outsideRoot, 'outside.mdx');
    try {
      await Promise.all([
        writeFile(outsideDocument, '# Outside', 'utf8'),
        writeFile(
          fixture.entryPath,
          "import Outside from './outside.mdx'; console.log(Outside);",
          'utf8',
        ),
      ]);
      await symlink(outsideDocument, path.join(fixture.root, 'outside.mdx'));

      await expect(buildMdxFixture(fixture)).rejects.toThrow('outside the trusted workspace');
    } finally {
      await Promise.all([
        rm(fixture.root, { force: true, recursive: true }),
        rm(outsideRoot, { force: true, recursive: true }),
      ]);
    }
  });
});

/** Absolute paths shared by one isolated MDX compiler fixture. */
interface PreviewMdxFixture {
  /** TypeScript entry that imports the query-bearing MDX module. */
  readonly entryPath: string;
  /** Authored MDX document loaded by the production fallback plugin. */
  readonly documentPath: string;
  /** Canonical temporary workspace removed after the test. */
  readonly root: string;
}

/** Creates an empty temporary workspace with stable entry and document names. */
async function createMdxFixture(label: string): Promise<PreviewMdxFixture> {
  const root = await mkdtemp(path.join(tmpdir(), `react-preview-mdx-${label}-`));
  await mkdir(root, { recursive: true });
  return {
    documentPath: path.join(root, 'document.mdx'),
    entryPath: path.join(root, 'entry.ts'),
    root,
  };
}

/** Runs a browser-format in-memory bundle with extension-owned React dependencies available. */
async function buildMdxFixture(
  fixture: PreviewMdxFixture,
  plugins: readonly Plugin[] = [createPreviewMdxFallbackPlugin({ workspaceRoot: fixture.root })],
): Promise<BuildResult> {
  return await build({
    absWorkingDir: fixture.root,
    bundle: true,
    define: { 'process.env.NODE_ENV': '"development"' },
    entryPoints: [fixture.entryPath],
    format: 'iife',
    logLevel: 'silent',
    nodePaths: [PROJECT_NODE_MODULES],
    outdir: path.join(fixture.root, 'out'),
    platform: 'browser',
    plugins: [...plugins],
    write: false,
  });
}

/**
 * Provides only the public React 16 classic surface and explicitly rejects the later JSX subpath.
 * The tiny runtime is sufficient to execute the compiled heading without installing another React
 * copy into the fixture or weakening normal package resolution in production.
 */
function createReact16RuntimeFixturePlugin(): Plugin {
  return {
    name: 'react-preview-react16-mdx-fixture',
    setup(build): void {
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({
        errors: [{ text: 'React 16 does not expose react/jsx-runtime.' }],
      }));
      build.onResolve({ filter: /^react$/ }, () => ({
        namespace: 'react-preview-react16-fixture',
        path: 'react',
      }));
      build.onLoad({ filter: /.*/, namespace: 'react-preview-react16-fixture' }, () => ({
        contents: [
          'export const Fragment = Symbol.for("react.fragment");',
          'export function createElement(type, props, ...children) {',
          '  return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };',
          '}',
        ].join('\n'),
        loader: 'js',
      }));
    },
  };
}

/** Executes one generated browser bundle and returns its JSON-compatible fixture result. */
function executePreviewMdxBundle(outputFiles: readonly OutputFile[]): unknown {
  const javascript = readPreviewMdxOutput(outputFiles, '.js');
  const context: { __previewMdxResult?: unknown } = {};
  vm.runInNewContext(javascript, context);
  return JSON.parse(JSON.stringify(context.__previewMdxResult)) as unknown;
}

/** Selects one generated artifact by extension and returns its UTF-8 text. */
function readPreviewMdxOutput(outputFiles: readonly OutputFile[], extension: string): string {
  const output = outputFiles.find((candidate) => candidate.path.endsWith(extension));
  if (output === undefined) throw new Error(`Expected an MDX fixture ${extension} output file.`);
  return output.text;
}
