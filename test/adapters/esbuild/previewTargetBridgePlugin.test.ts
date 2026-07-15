/**
 * Verifies that the private target bridge exposes exactly the export chosen by static analysis.
 * A real in-memory esbuild run proves the generated re-export is valid and remains tree-shakable.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewTargetBridgePlugin } from '../../../src/adapters/esbuild/previewTargetBridgePlugin';

describe('createPreviewTargetBridgePlugin', () => {
  /** Re-exports a selected named component as default without retaining another target export. */
  it('bridges only the selected named runtime export', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-target-'));
    const documentPath = path.join(temporaryDirectory, 'Target.tsx');
    try {
      await writeFile(
        documentPath,
        [
          "export function NamedPreview() { return 'NAMED_PREVIEW_MARKER'; }",
          "export default function DefaultPreview() { return 'DEFAULT_PREVIEW_MARKER'; }",
        ].join('\n'),
        'utf8',
      );

      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [createPreviewTargetBridgePlugin({ documentPath, exportName: 'NamedPreview' })],
        stdin: {
          contents: "import Preview from 'react-preview:target'; console.log(Preview());",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        treeShaking: true,
        write: false,
      });
      const javascript = result.outputFiles[0]?.text ?? '';

      expect(javascript).toContain('NAMED_PREVIEW_MARKER');
      expect(javascript).not.toContain('DEFAULT_PREVIEW_MARKER');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Keeps the existing default-export bridge behavior when no explicit selection is supplied. */
  it('defaults to the target default export for existing compiler callers', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-target-'));
    const documentPath = path.join(temporaryDirectory, 'Target.ts');
    try {
      await writeFile(
        documentPath,
        [
          "export const NamedPreview = () => 'NAMED_PREVIEW_MARKER';",
          "export default function DefaultPreview() { return 'DEFAULT_PREVIEW_MARKER'; }",
        ].join('\n'),
        'utf8',
      );

      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [createPreviewTargetBridgePlugin({ documentPath })],
        stdin: {
          contents: "import Preview from 'react-preview:target'; console.log(Preview());",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        treeShaking: true,
        write: false,
      });
      const javascript = result.outputFiles[0]?.text ?? '';

      expect(javascript).toContain('DEFAULT_PREVIEW_MARKER');
      expect(javascript).not.toContain('NAMED_PREVIEW_MARKER');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
