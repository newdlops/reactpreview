/**
 * Verifies the optional setup bridge independently from complete React compilation.
 * These tests ensure absence is valid and a configured workspace module remains bundle-visible.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewSetupBridgePlugin } from '../../../src/adapters/esbuild/previewSetupBridgePlugin';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

describe('createPreviewSetupBridgePlugin', () => {
  /** Supplies an empty namespace when a project has no explicit or conventional setup module. */
  it('builds an empty setup without resolving a filesystem module', async () => {
    const result = await build({
      bundle: true,
      format: 'esm',
      logLevel: 'silent',
      plugins: [createPreviewSetupBridgePlugin({})],
      stdin: {
        contents:
          "import setup from 'react-preview:setup'; console.log(Object.keys(setup).length);",
        loader: 'js',
        resolveDir: PROJECT_ROOT,
      },
      write: false,
    });

    expect(result.outputFiles[0]?.text).toContain('empty-preview-setup');
  });

  /** Imports a quoted path as a namespace so every optional setup hook remains discoverable. */
  it('bundles a configured setup namespace through its stable specifier', async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(PROJECT_ROOT, 'test/fixtures/setup-bridge-preview-'),
    );
    const setupModulePath = path.join(temporaryDirectory, 'quoted "setup".ts');

    try {
      await writeFile(
        setupModulePath,
        "export const previewProps = { marker: 'PROJECT_SETUP_MARKER' };",
        'utf8',
      );
      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [createPreviewSetupBridgePlugin({ setupModulePath })],
        stdin: {
          contents:
            "import setup from 'react-preview:setup'; console.log(setup.previewProps.marker);",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        write: false,
      });

      expect(result.outputFiles[0]?.text).toContain('PROJECT_SETUP_MARKER');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
