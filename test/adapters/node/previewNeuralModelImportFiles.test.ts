/** Verifies that a global-storage import file is claimed once and settled beside its backup. */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PREVIEW_NEURAL_MODEL_IMPORT_FILE,
  PreviewNeuralModelImportFiles,
} from '../../../src/adapters/node/previewNeuralModelImportFiles';
import { createEmptyPreviewInspectorNeuralModel } from '../../../src/presentation/previewInspectorNeuralModelProtocol';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('PreviewNeuralModelImportFiles', () => {
  /** One claim wins; the file ends applied, next to a backup of the pre-import model. */
  it('claims a pending import once and settles it with a backup', async () => {
    const directory = await createDirectory();
    const empty = createEmptyPreviewInspectorNeuralModel();
    await writeFile(
      path.join(directory, PREVIEW_NEURAL_MODEL_IMPORT_FILE),
      JSON.stringify({
        base: empty,
        format: 'react-preview-neural-pretraining',
        id: 'pretrain-1',
        trained: empty,
        version: 1,
      }),
    );
    const source = new PreviewNeuralModelImportFiles(directory);

    const [first, second] = await Promise.all([source.claim(), source.claim()]);
    const claim = first ?? second;
    await claim?.backup(empty);
    await claim?.settle('applied');

    expect([first, second].filter((value) => value !== undefined)).toHaveLength(1);
    expect(claim?.value?.id).toBe('pretrain-1');
    expect((await readdir(directory)).sort()).toEqual([
      'neural-model-backup.pretrain-1.json',
      'neural-model-import.pretrain-1.applied.json',
    ]);
    expect(
      JSON.parse(
        await readFile(path.join(directory, 'neural-model-backup.pretrain-1.json'), 'utf8'),
      ),
    ).toEqual(empty);
    expect(await source.claim()).toBeUndefined();
  });

  /** A malformed document is claimed without a value and can be set aside as rejected. */
  it('claims malformed documents without a value', async () => {
    const directory = await createDirectory();
    await writeFile(path.join(directory, PREVIEW_NEURAL_MODEL_IMPORT_FILE), '{"format":"x"}');

    const claim = await new PreviewNeuralModelImportFiles(directory).claim();
    await claim?.settle('rejected');

    expect(claim?.value).toBeUndefined();
    expect(await readdir(directory)).toEqual(['neural-model-import.invalid.rejected.json']);
  });
});

/** Creates one temporary global storage directory. */
async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'react-preview-neural-import-'));
  temporaryRoots.push(directory);
  return directory;
}
