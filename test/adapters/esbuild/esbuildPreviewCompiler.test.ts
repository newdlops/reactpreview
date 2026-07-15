/**
 * Exercises the real runtime compiler against project React, TSX, CSS, and unsaved source text.
 * These tests ensure the no-server build path works before a VS Code extension host is involved.
 */
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { PreviewCompilationError } from '../../../src/domain/preview';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

const FIXTURE_PATH = fileURLToPath(new URL('../../fixtures/SamplePreview.tsx', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SAVED_SOURCE = await readFile(FIXTURE_PATH, 'utf8');

describe('EsbuildPreviewCompiler', () => {
  /** Bundles a default React export and emits imported CSS without writing into the project. */
  it('creates browser JavaScript and stylesheet artifacts', async () => {
    const compiler = new EsbuildPreviewCompiler();

    const bundle = await compiler.compile({
      documentPath: FIXTURE_PATH,
      language: 'tsx',
      sourceText: SAVED_SOURCE,
      workspaceRoot: PROJECT_ROOT,
    });

    expect(bundle.javascript.byteLength).toBeGreaterThan(0);
    expect(bundle.stylesheet).toBeDefined();
    const stylesheet = new TextDecoder().decode(bundle.stylesheet);
    expect(stylesheet).toContain('.sample-card');
    expect(stylesheet).toMatch(/\.samplePreview_title|\.title/u);
    expect(bundle.dependencies).toContain(FIXTURE_PATH);
    expect(
      bundle.dependencies.filter((dependency) => dependency.includes('react-preview-entry')),
    ).toEqual([]);
  });

  /** Gives the active editor snapshot precedence over the fixture's saved filesystem contents. */
  it('uses unsaved current-document text', async () => {
    const compiler = new EsbuildPreviewCompiler();
    const unsavedSource = SAVED_SOURCE.replace('Saved fixture source', 'Unsaved editor snapshot');

    const bundle = await compiler.compile({
      documentPath: FIXTURE_PATH,
      language: 'tsx',
      sourceText: unsavedSource,
      workspaceRoot: PROJECT_ROOT,
    });
    const javascript = new TextDecoder().decode(bundle.javascript);

    expect(javascript).toContain('Unsaved editor snapshot');
    expect(javascript).not.toContain('Saved fixture source');
  });

  /**
   * Resolves an extensionless circular import back to the same in-memory editor module.
   * Without alias unification, esbuild can bundle a second copy from the saved filesystem file.
   */
  it('does not duplicate saved source through an extensionless circular import', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/circular-preview-'),
    );
    const documentPath = path.join(temporaryDirectory, 'CyclePreview.tsx');
    const helperPath = path.join(temporaryDirectory, 'cycleHelper.ts');
    const savedSource = [
      "import { readEditorValue } from './cycleHelper';",
      "export const editorValue = 'Saved circular module';",
      'export default function CyclePreview() {',
      '  return <p>{readEditorValue()}</p>;',
      '}',
    ].join('\n');
    const helperSource = [
      "import { editorValue } from './CyclePreview';",
      'export function readEditorValue(): string {',
      '  return editorValue;',
      '}',
    ].join('\n');
    const unsavedSource = savedSource.replace('Saved circular module', 'Unsaved circular module');

    try {
      await Promise.all([
        writeFile(documentPath, savedSource, 'utf8'),
        writeFile(helperPath, helperSource, 'utf8'),
      ]);
      const compiler = new EsbuildPreviewCompiler();
      const bundle = await compiler.compile({
        documentPath,
        language: 'tsx',
        sourceText: unsavedSource,
        workspaceRoot: PROJECT_ROOT,
      });
      const javascript = new TextDecoder().decode(bundle.javascript);

      expect(javascript).toContain('Unsaved circular module');
      expect(javascript).not.toContain('Saved circular module');
      expect(bundle.dependencies).toContain(documentPath);
      expect(bundle.dependencies).toContain(helperPath);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Converts syntax failures into the stable domain error rather than leaking esbuild types. */
  it('reports invalid editor source as a PreviewCompilationError', async () => {
    const compiler = new EsbuildPreviewCompiler();

    await expect(
      compiler.compile({
        documentPath: FIXTURE_PATH,
        language: 'tsx',
        sourceText: 'export default function Broken( {',
        workspaceRoot: PROJECT_ROOT,
      }),
    ).rejects.toBeInstanceOf(PreviewCompilationError);
  });

  /**
   * Preserves the editor's symlink identity so esbuild cannot bypass an unsaved source overlay.
   */
  it.runIf(process.platform !== 'win32')(
    'uses unsaved source when the active document path is a symlink',
    async () => {
      const temporaryDirectory = await mkdtemp(
        path.join(PROJECT_ROOT, 'test/fixtures/symlink-preview-'),
      );
      const realDocumentPath = path.join(temporaryDirectory, 'RealPreview.tsx');
      const linkedDocumentPath = path.join(temporaryDirectory, 'LinkedPreview.tsx');
      const savedSource =
        'export default function SymlinkPreview() { return <p>Saved symlink source</p>; }';
      const unsavedSource = savedSource.replace('Saved symlink source', 'Unsaved symlink source');

      try {
        await writeFile(realDocumentPath, savedSource, 'utf8');
        await symlink(realDocumentPath, linkedDocumentPath, 'file');
        const compiler = new EsbuildPreviewCompiler();
        const bundle = await compiler.compile({
          documentPath: linkedDocumentPath,
          language: 'tsx',
          sourceText: unsavedSource,
          workspaceRoot: PROJECT_ROOT,
        });
        const javascript = new TextDecoder().decode(bundle.javascript);

        expect(javascript).toContain('Unsaved symlink source');
        expect(javascript).not.toContain('Saved symlink source');
        expect(bundle.dependencies).toContain(linkedDocumentPath);
        expect(canonicalizeExistingPath(linkedDocumentPath)).toBe(
          canonicalizeExistingPath(realDocumentPath),
        );
      } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    },
  );
});
