import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST,
  PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_VERSION,
  createPreviewInspectorExecutionRootModuleContract,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorExecutionRootModuleContract';
import { PreviewCompilationError } from '../../../../src/domain/preview';
import { canonicalizeExistingPath } from '../../../../src/shared/pathIdentity';

describe('createPreviewInspectorExecutionRootModuleContract', () => {
  it('freezes an exact named binding proven by prepared compiler source', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-root-contract-'));
    const sourcePath = path.join(directory, 'NamedOwner.tsx');
    const preparedSourceText = [
      'function Owner() { return null; }',
      'export { Owner as NamedOwner };',
    ].join('\n');
    try {
      await writeFile(sourcePath, preparedSourceText);

      const contract = createPreviewInspectorExecutionRootModuleContract({
        exportName: 'NamedOwner',
        preparedSourceText,
        sourcePath,
        surfaceId: 'owner',
      });

      expect(contract).toMatchObject({
        bindingExportName: 'NamedOwner',
        explicitExportNames: ['NamedOwner'],
        exportName: 'NamedOwner',
        hasWildcardExport: false,
        sourcePath: canonicalizeExistingPath(sourcePath),
        surfaceId: 'owner',
      });
      expect(contract.preparedSourceDigest).toMatch(/^[\da-f]{64}$/u);
      expect(Object.isFrozen(contract)).toBe(true);
      expect(PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_VERSION).toBe(2);
      expect(PREVIEW_ABSENCE_EXECUTION_ROOT_POLICY_DIGEST).toMatch(/^[\da-f]{64}$/u);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('resolves an uncertain route-local name to an explicitly exported default binding', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-root-default-contract-'));
    const sourcePath = path.join(directory, 'RootLayout.tsx');
    const preparedSourceText = 'export default function RootLayout() { return null; }';
    try {
      await writeFile(sourcePath, preparedSourceText);

      const contract = createPreviewInspectorExecutionRootModuleContract({
        allowDefaultExportFallback: true,
        exportName: 'RootLayout',
        preparedSourceText,
        sourcePath,
        surfaceId: 'layout-owner',
      });

      expect(contract).toMatchObject({
        bindingExportName: 'default',
        explicitExportNames: ['default'],
        exportName: 'RootLayout',
        surfaceId: 'layout-owner',
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('fails closed when only wildcard or unrelated exports are available', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'preview-root-contract-drift-'));
    const sourcePath = path.join(directory, 'Owner.tsx');
    const preparedSourceText = [
      "export * from './Elsewhere';",
      'export function DifferentOwner() { return null; }',
    ].join('\n');
    try {
      await writeFile(sourcePath, preparedSourceText);

      expect(() =>
        createPreviewInspectorExecutionRootModuleContract({
          exportName: 'NamedOwner',
          preparedSourceText,
          sourcePath,
          surfaceId: 'owner',
        }),
      ).toThrow(PreviewCompilationError);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
