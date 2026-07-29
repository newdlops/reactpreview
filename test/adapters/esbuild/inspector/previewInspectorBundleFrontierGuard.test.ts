/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { registerPreviewInspectorBundleFrontierGuard } from '../../../../src/adapters/esbuild/inspector/previewInspectorBundleFrontierGuard';
import { isPreviewFrontierMismatchEvidence } from '../../../../src/domain/previewBuildExecution';
import { canonicalizeExistingPath } from '../../../../src/shared/pathIdentity';

describe('registerPreviewInspectorBundleFrontierGuard', () => {
  it('attaches bounded guard evidence to an actual esbuild failure', async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'react-preview-frontier-guard-'));
    const sourceRoot = path.join(workspaceRoot, 'src');
    const entry = path.join(sourceRoot, 'Entry.ts');
    const unexpected = path.join(sourceRoot, 'Unexpected.ts');
    await mkdir(sourceRoot, { recursive: true });
    await Promise.all([
      writeFile(entry, "import './Unexpected';"),
      writeFile(unexpected, 'export {};'),
    ]);
    let caught: unknown;
    try {
      await build({
        bundle: true,
        entryPoints: [entry],
        logLevel: 'silent',
        plugins: [
          {
            name: 'guard',
            setup(build_) {
              registerPreviewInspectorBundleFrontierGuard(build_, {
                authenticSourcePaths: new Set([canonicalizeExistingPath(entry)]),
                resolveModule: () => unexpected,
                workspaceRoot,
              });
            },
          },
        ],
        write: false,
      });
    } catch (error) {
      caught = error;
    }
    const detail = (caught as { errors: { detail: unknown; text: string }[] }).errors[0]!;
    expect(detail.text).toBe(
      'React Preview frontier mismatch: ./Unexpected escaped the planned authored bundle.',
    );
    expect(isPreviewFrontierMismatchEvidence(detail.detail)).toBe(true);
    expect(detail.detail).toMatchObject({
      cause: 'guard-escape',
      source: { workspaceRelativePath: 'src/Unexpected.ts' },
      importer: { workspaceRelativePath: 'src/Entry.ts' },
      specifier: { value: './Unexpected' },
    });
  });
});
