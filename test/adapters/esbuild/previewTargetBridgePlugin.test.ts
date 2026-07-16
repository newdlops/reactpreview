/**
 * Verifies that the private target bridge exposes source-ordered component descriptors.
 * Real in-memory esbuild builds prove explicit slots remain tree-shakable, wildcard slots expand
 * predictably, and direct theme metadata does not require an application bootstrap module.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { createPreviewParentSlicePlugin } from '../../../src/adapters/esbuild/previewParentSlicePlugin';
import { createPreviewTargetBridgePlugin } from '../../../src/adapters/esbuild/previewTargetBridgePlugin';

describe('createPreviewTargetBridgePlugin', () => {
  /** Imports only the selected wrapper branch while tree-shaking an unrelated sibling export. */
  it('mounts an explicit export through its pinpoint parent render slice', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-target-slice-'));
    const documentPath = path.join(temporaryDirectory, 'Target.tsx');
    const consumerPath = path.join(temporaryDirectory, 'Owner.tsx');
    const shellPath = path.join(temporaryDirectory, 'Shell.tsx');
    const parentSlicesByExport = {
      TargetRow: {
        complete: true,
        dependencyPaths: [consumerPath],
        frames: [
          { childMode: 'children' as const, kind: 'intrinsic' as const, tagName: 'tbody' },
          {
            childMode: 'children' as const,
            importReference: {
              consumerSourcePath: consumerPath,
              exportName: 'Shell',
              moduleSpecifier: './Shell',
            },
            kind: 'imported' as const,
            props: { variant: 'grid' },
          },
        ],
        localOwnerDepth: 0,
        ownerExportNames: ['Owner'],
        ownerLocalName: 'Owner',
        projectOwnerDepth: 0,
        sourcePath: consumerPath,
      },
    };
    try {
      await Promise.all([
        writeFile(
          documentPath,
          "export function TargetRow() { return 'PINPOINT_TARGET_MARKER'; }",
          'utf8',
        ),
        writeFile(
          shellPath,
          [
            "export function Shell({ children }) { return ['SELECTED_SHELL_MARKER', children]; }",
            "export function UnrelatedSibling() { return 'UNRELATED_SIBLING_MARKER'; }",
          ].join('\n'),
          'utf8',
        ),
      ]);

      const result = await build({
        bundle: true,
        format: 'esm',
        jsx: 'automatic',
        logLevel: 'silent',
        nodePaths: [path.join(process.cwd(), 'node_modules')],
        plugins: [
          createPreviewParentSlicePlugin({ documentPath, plansByExport: parentSlicesByExport }),
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: [{ displayName: 'TargetRow', exportName: 'TargetRow', kind: 'explicit' }],
            parentSlicesByExport,
          }),
        ],
        stdin: {
          contents:
            "import targets from 'react-preview:target'; console.log(targets[0].value({}));",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        treeShaking: true,
        write: false,
      });
      const javascript = result.outputFiles[0]?.text ?? '';

      expect(javascript).toContain('PINPOINT_TARGET_MARKER');
      expect(javascript).toContain('SELECTED_SHELL_MARKER');
      expect(javascript).not.toContain('UNRELATED_SIBLING_MARKER');
      expect(javascript).toContain('frameCount');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Serializes reverse-usage props as inert descriptor data for the browser entry to merge. */
  it('attaches static usage props to their exact explicit export', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-target-'));
    const documentPath = path.join(temporaryDirectory, 'Target.ts');
    try {
      await writeFile(documentPath, 'export const Card = () => null;', 'utf8');
      const result = await build({
        bundle: true,
        format: 'iife',
        globalName: '__previewBridgeTest',
        logLevel: 'silent',
        plugins: [
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: [{ displayName: 'Card', exportName: 'Card', kind: 'explicit' }],
            usagePropsByExport: { Card: { label: 'real usage', ready: true } },
          }),
        ],
        stdin: {
          contents:
            "import targets from 'react-preview:target'; export const props = targets[0].automaticProps;",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        write: false,
      });
      const javascript = result.outputFiles[0]?.text ?? '';
      const sandbox: { __previewBridgeTest?: { props?: Record<string, unknown> } } = {};
      runInNewContext(javascript, sandbox);

      expect(sandbox.__previewBridgeTest?.props).toEqual({ label: 'real usage', ready: true });
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Bridges one explicit named component without retaining an unselected target export. */
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
        plugins: [
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: [
              {
                displayName: 'NamedPreview',
                exportName: 'NamedPreview',
                kind: 'explicit',
              },
            ],
          }),
        ],
        stdin: {
          contents: "import targets from 'react-preview:target'; console.log(targets[0].value());",
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

  /** Keeps a descriptor-wrapped default export for callers that omit plural selection metadata. */
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
          contents: "import targets from 'react-preview:target'; console.log(targets[0].value());",
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

  /** Expands a wildcard at its lexical slot while reserving later explicit component names. */
  it('preserves explicit and wildcard gallery ordering without duplicate exports', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-target-'));
    const documentPath = path.join(temporaryDirectory, 'Target.ts');
    try {
      await writeFile(
        documentPath,
        [
          "export const Alpha = () => 'alpha';",
          "export { Beta, Zulu } from './more';",
          "export const Omega = () => 'omega';",
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        path.join(temporaryDirectory, 'more.ts'),
        ["export const Zulu = () => 'zulu';", "export const Beta = () => 'beta';"].join('\n'),
        'utf8',
      );

      const result = await build({
        bundle: true,
        format: 'iife',
        globalName: '__previewBridgeTest',
        logLevel: 'silent',
        plugins: [
          createPreviewTargetBridgePlugin({
            documentPath,
            exports: [
              { displayName: 'Alpha', exportName: 'Alpha', kind: 'explicit' },
              { kind: 'wildcard' },
              { displayName: 'Omega', exportName: 'Omega', kind: 'explicit' },
            ],
          }),
        ],
        stdin: {
          contents:
            "import targets from 'react-preview:target'; export const names = targets.map((target) => target.exportName);",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        write: false,
      });
      const javascript = result.outputFiles[0]?.text ?? '';
      const sandbox: { __previewBridgeTest?: { names?: string[] } } = {};
      runInNewContext(javascript, sandbox);

      expect(sandbox.__previewBridgeTest?.names).toEqual(['Alpha', 'Beta', 'Zulu', 'Omega']);
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });

  /** Exposes the exact selected theme export alongside target descriptors. */
  it('bridges an explicitly discovered project theme without an app entry point', async () => {
    const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'react-preview-target-'));
    const documentPath = path.join(temporaryDirectory, 'Target.ts');
    try {
      await Promise.all([
        writeFile(documentPath, 'export default function Preview() {}', 'utf8'),
        writeFile(
          path.join(temporaryDirectory, 'theme.ts'),
          "export const theme = { marker: 'PROJECT_THEME_MARKER' };",
          'utf8',
        ),
      ]);

      const result = await build({
        bundle: true,
        format: 'esm',
        logLevel: 'silent',
        plugins: [
          createPreviewTargetBridgePlugin({
            documentPath,
            themeImport: { exportName: 'theme', moduleSpecifier: './theme' },
          }),
        ],
        stdin: {
          contents:
            "import { previewTheme } from 'react-preview:target'; console.log(previewTheme.marker);",
          loader: 'js',
          resolveDir: temporaryDirectory,
        },
        treeShaking: true,
        write: false,
      });

      expect(result.outputFiles[0]?.text ?? '').toContain('PROJECT_THEME_MARKER');
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true });
    }
  });
});
