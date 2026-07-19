/** Verifies automatic target props through the complete Page Inspector compiler pipeline. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('EsbuildPreviewCompiler automatic target props', () => {
  /** Carries inferred Formik-like receiver paths into the editable Inspector descriptor. */
  it('emits data-only object and function shapes for a direct target fallback', async () => {
    const projectRoot = await mkdtemp(
      path.join(REPOSITORY_ROOT, 'test/fixtures/automatic-target-props-'),
    );
    const targetPath = path.join(projectRoot, 'src/CheckField.tsx');
    const sourceText = [
      'export const CheckField = ({ field, helpers }: any) => {',
      '  const addressInput = field.value.addressInput;',
      '  if (!addressInput.postcode) return <span>EMPTY_ADDRESS_MARKER</span>;',
      '  const complete = () => helpers.setValue({ ...field.value, ready: true });',
      '  return <button onClick={complete}>ready</button>;',
      '};',
    ].join('\n');
    const compiler = new EsbuildPreviewCompiler();

    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await Promise.all([
        writeFile(path.join(projectRoot, 'package.json'), '{"private":true}', 'utf8'),
        writeFile(targetPath, sourceText, 'utf8'),
      ]);

      const bundle = await compiler.compile({
        dependencySnapshots: [],
        documentPath: targetPath,
        language: 'tsx',
        renderMode: 'page-inspector',
        sourceText,
        useStorybookPreview: false,
        workspaceRoot: projectRoot,
      });
      const javascript = Buffer.concat([
        Buffer.from(bundle.javascript),
        ...bundle.chunks.map((chunk) => Buffer.from(chunk.contents)),
      ]).toString('utf8');

      expect(javascript).toContain('EMPTY_ADDRESS_MARKER');
      expect(javascript).toContain('field.value.addressInput');
      expect(javascript).toContain('helpers.setValue');
      expect(javascript).toContain('previewAutomaticNoop');
      expect(javascript).toContain('Smart-generated preview paths:');
      expect(javascript).toContain('Smart fill props');
      expect(javascript).toContain('[Preview no-op function]');
      expect(bundle.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
        [],
      );
    } finally {
      await compiler.shutdown();
      await rm(projectRoot, { force: true, recursive: true });
    }
  });
});
