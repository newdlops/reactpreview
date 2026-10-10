/**
 * Global-storage file source for Page Inspector neural pre-training imports.
 *
 * The pre-training tool writes `neural-model-import.json` into the extension's global storage
 * directory. The first Page Inspector synchronization claims it with an atomic rename, so only one
 * window applies it. The file then ends as `neural-model-import.<id>.applied.json` (or
 * `.rejected.json`), next to a `neural-model-backup.<id>.json` copy of the pre-import model.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  readPreviewInspectorNeuralModelImport,
  type PreviewInspectorNeuralModelImport,
  type PreviewInspectorNeuralModelImportClaim,
  type PreviewInspectorNeuralModelImportSource,
} from '../../presentation/previewInspectorNeuralModelImport';

/** File name the pre-training tool writes into the extension's global storage directory. */
export const PREVIEW_NEURAL_MODEL_IMPORT_FILE = 'neural-model-import.json';
/** Two bounded models need well under this; anything larger is not a pre-training result. */
const MAX_IMPORT_BYTES = 1_000_000;

/** Claims pre-training imports from one global storage directory. */
export class PreviewNeuralModelImportFiles implements PreviewInspectorNeuralModelImportSource {
  /**
   * Binds the source to one storage directory without touching the filesystem.
   *
   * @param directory Extension global storage directory.
   */
  public constructor(private readonly directory: string) {}

  /** Renames a pending import to a unique claimed name, then reads and validates it. */
  public async claim(): Promise<PreviewInspectorNeuralModelImportClaim | undefined> {
    const claimedPath = path.join(
      this.directory,
      `neural-model-import.${randomUUID()}.claimed.json`,
    );
    try {
      await rename(path.join(this.directory, PREVIEW_NEURAL_MODEL_IMPORT_FILE), claimedPath);
    } catch {
      return undefined;
    }
    const value = await readClaimedImport(claimedPath);
    const name = value?.id ?? 'invalid';
    return {
      ...(value === undefined ? {} : { value }),
      backup: async (model) => {
        await writeFile(
          path.join(this.directory, `neural-model-backup.${name}.json`),
          `${JSON.stringify(model)}\n`,
          'utf8',
        );
      },
      settle: async (outcome) => {
        await rename(
          claimedPath,
          path.join(this.directory, `neural-model-import.${name}.${outcome}.json`),
        );
      },
    };
  }
}

/** Reads one claimed file; oversized or malformed documents yield `undefined`. */
async function readClaimedImport(
  claimedPath: string,
): Promise<PreviewInspectorNeuralModelImport | undefined> {
  try {
    if ((await stat(claimedPath)).size > MAX_IMPORT_BYTES) return undefined;
    return readPreviewInspectorNeuralModelImport(
      JSON.parse(await readFile(claimedPath, 'utf8')) as unknown,
    );
  } catch {
    return undefined;
  }
}
