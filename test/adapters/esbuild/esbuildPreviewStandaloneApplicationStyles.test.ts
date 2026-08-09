/** Exercises app-root stylesheet recovery through the complete standalone preview compiler path. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { decodePreviewBundleStyles } from './support/previewBundleStyles';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler standalone application styles', () => {
  /** Includes global and responsive CSS even when no render graph can prove an authored page. */
  it('loads conventional root layout styles around a standalone component target', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/compiler-standalone-styles-'),
    );
    const applicationDirectory = path.join(projectRoot, 'app');
    const examplesDirectory = path.join(projectRoot, 'examples');
    const documentPath = path.join(examplesDirectory, 'StandaloneCard.tsx');
    const layoutPath = path.join(applicationDirectory, 'layout.tsx');
    const stylesheetPath = path.join(applicationDirectory, 'globals.css');
    const sourceText = [
      'export function StandaloneCard() {',
      '  return <section className="standalone-card">Styled target</section>;',
      '}',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await Promise.all([
        mkdir(applicationDirectory, { recursive: true }),
        mkdir(examplesDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          layoutPath,
          [
            "import './globals.css';",
            "throw new Error('ROOT_LAYOUT_MUST_NOT_EXECUTE');",
            'export default function Layout({ children }) { return children; }',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          stylesheetPath,
          [
            '.standalone-card { display: flex; max-width: 32rem; }',
            '@media (max-width: 40rem) { .standalone-card { width: 100%; } }',
          ].join('\n'),
          'utf8',
        ),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        preparationMode: 'fast',
        renderMode: 'page-inspector',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const stylesheet = decodePreviewBundleStyles(bundle);
      const decoder = new TextDecoder();
      const javascript = [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
        .map((contents) => decoder.decode(contents))
        .join('\n');

      expect(stylesheet).toContain('.standalone-card');
      expect(stylesheet).toContain('@media (max-width: 40rem)');
      expect(stylesheet).toContain('max-width: 32rem');
      expect(javascript).not.toContain('ROOT_LAYOUT_MUST_NOT_EXECUTE');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([documentPath, layoutPath, stylesheetPath]),
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
