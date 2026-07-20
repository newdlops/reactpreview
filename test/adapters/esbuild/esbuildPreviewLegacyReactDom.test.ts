/**
 * Exercises the compiler against an isolated React 16/17-style installation.
 *
 * The fixture intentionally lives outside this repository so ancestor lookup cannot accidentally
 * find the extension's React 19 dependency or its `react-dom/client` export.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EsbuildPreviewCompiler } from '../../../src/adapters/esbuild/esbuildPreviewCompiler';
import type { PreviewBundle } from '../../../src/domain/preview';
import { canonicalizeExistingPath } from '../../../src/shared/pathIdentity';

describe('EsbuildPreviewCompiler legacy ReactDOM compatibility', () => {
  /** Compiles packages that do not publish the React 18 client-root subpath. */
  it('selects the project-local legacy ReactDOM root when react-dom/client is absent', async () => {
    const temporaryDirectory = canonicalizeExistingPath(
      await mkdtemp(path.join(tmpdir(), 'react-preview-legacy-react-dom-')),
    );
    const reactDirectory = path.join(temporaryDirectory, 'node_modules/react');
    const reactDomDirectory = path.join(temporaryDirectory, 'node_modules/react-dom');
    const documentPath = path.join(temporaryDirectory, 'LegacyPreview.tsx');
    const sourceText = [
      "import * as React from 'react';",
      "export default function LegacyPreview() { return React.createElement('main'); }",
    ].join('\n');

    try {
      await Promise.all([
        mkdir(reactDirectory, { recursive: true }),
        mkdir(reactDomDirectory, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(temporaryDirectory, 'package.json'),
          JSON.stringify({ dependencies: { react: '17.0.2', 'react-dom': '16.13.1' } }),
          'utf8',
        ),
        writeFile(
          path.join(reactDirectory, 'package.json'),
          JSON.stringify({ main: 'index.js', name: 'react', version: '17.0.2' }),
          'utf8',
        ),
        writeFile(
          path.join(reactDirectory, 'index.js'),
          'module.exports = { Component: class {}, createElement() { return {}; } };',
          'utf8',
        ),
        writeFile(
          path.join(reactDomDirectory, 'package.json'),
          JSON.stringify({ main: 'index.js', name: 'react-dom', version: '16.13.1' }),
          'utf8',
        ),
        writeFile(
          path.join(reactDomDirectory, 'index.js'),
          [
            "exports.render = function render() { console.info('LEGACY_REACT_DOM_RENDER'); };",
            'exports.unmountComponentAtNode = function unmountComponentAtNode() {};',
          ].join('\n'),
          'utf8',
        ),
        writeFile(documentPath, sourceText, 'utf8'),
      ]);

      const bundle = await new EsbuildPreviewCompiler().compile({
        dependencySnapshots: [],
        documentPath,
        language: 'tsx',
        sourceText,
        workspaceRoot: temporaryDirectory,
      });
      const javascript = decodeBundleJavascript(bundle);

      expect(javascript).toContain('LEGACY_REACT_DOM_RENDER');
      expect(javascript).not.toContain('react-dom/client');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});

/** Decodes the generated entry and lazy chunks so assertions cover the complete preview graph. */
function decodeBundleJavascript(bundle: PreviewBundle): string {
  const decoder = new TextDecoder();
  return [bundle.javascript, ...bundle.chunks.map((chunk) => chunk.contents)]
    .map((contents) => decoder.decode(contents))
    .join('\n');
}
