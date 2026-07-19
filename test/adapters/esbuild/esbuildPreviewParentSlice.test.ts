/** Exercises the complete compiler path for a statically projected parent JSX wrapper branch. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import { decodePreviewBundleStyles } from './support/previewBundleStyles';
import type { PreviewBundle } from '../../../src/domain/preview';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler parent render slices', () => {
  /** Bundles the target, selected shell, and shell CSS while omitting authored JSX siblings. */
  it('loads only the pinpoint wrapper branch selected from a real target usage', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/compiler-parent-slice-'),
    );
    const sourceDirectory = path.join(projectRoot, 'src');
    const documentPath = path.join(sourceDirectory, 'TargetRow.tsx');
    const consumerPath = path.join(sourceDirectory, 'Owner.tsx');
    const shellPath = path.join(sourceDirectory, 'Shell.tsx');
    const stylesheetPath = path.join(sourceDirectory, 'shell.css');
    const setupPath = path.join(projectRoot, 'preview-setup.ts');
    const sourceText = [
      'export function TargetRow({ label }) {',
      '  return <tr><td>{label}|PINPOINT_TARGET_RUNTIME</td></tr>;',
      '}',
    ].join('\n');

    try {
      await mkdir(sourceDirectory, { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(documentPath, sourceText, 'utf8'),
        writeFile(
          consumerPath,
          [
            "import { TargetRow } from './TargetRow';",
            "import { Shell } from './Shell';",
            'export function Owner() {',
            '  return (',
            '    <Shell variant="grid">',
            '      <tbody><TargetRow label="PARENT_AUTHORED_LABEL" /></tbody>',
            '      <aside>UNRELATED_PARENT_SIBLING</aside>',
            '    </Shell>',
            '  );',
            '}',
          ].join('\n'),
          'utf8',
        ),
        writeFile(
          shellPath,
          [
            "import './shell.css';",
            'export function Shell({ children, variant }) {',
            '  return <table className="pinpoint-shell" data-variant={variant}>{children}</table>;',
            '}',
            "export function UnrelatedShellExport() { return 'UNRELATED_SHELL_EXPORT'; }",
          ].join('\n'),
          'utf8',
        ),
        writeFile(stylesheetPath, '.pinpoint-shell { display: grid; }', 'utf8'),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = decodeBundleJavascript(bundle);
      const stylesheet = decodePreviewBundleStyles(bundle);

      expect(javascript).toContain('PINPOINT_TARGET_RUNTIME');
      expect(javascript).toContain('PARENT_AUTHORED_LABEL');
      expect(javascript).toContain('pinpoint-shell');
      expect(javascript).not.toContain('UNRELATED_PARENT_SIBLING');
      expect(javascript).not.toContain('UNRELATED_SHELL_EXPORT');
      expect(stylesheet).toContain('.pinpoint-shell');
      expect(bundle.dependencies).toEqual(
        expect.arrayContaining([consumerPath, documentPath, shellPath, stylesheetPath]),
      );

      await writeFile(
        setupPath,
        "export const previewProps = { label: 'EXPLICIT_SETUP_LABEL' };",
        'utf8',
      );
      const setupOwnedBundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        setupModulePath: setupPath,
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const setupOwnedJavascript = decodeBundleJavascript(setupOwnedBundle);
      expect(setupOwnedJavascript).toContain('EXPLICIT_SETUP_LABEL');
      expect(setupOwnedJavascript).not.toContain('pinpoint-shell');
    } finally {
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});

/** Decodes the entry and local chunks because target and parent slices load after setup bootstrap. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}
