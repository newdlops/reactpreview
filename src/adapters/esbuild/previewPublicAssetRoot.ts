/** Discovers the conventional passive-asset directory without enumerating project files. */
import { stat } from 'node:fs/promises';
import path from 'node:path';

/** Returns the existing project `public` directory accepted by runtime asset compatibility. */
export async function findPreviewPublicAssetRoot(projectRoot: string): Promise<string | undefined> {
  const publicAssetRoot = path.resolve(projectRoot, 'public');
  try {
    const metadata = await stat(publicAssetRoot);
    return metadata.isDirectory() ? publicAssetRoot : undefined;
  } catch {
    return undefined;
  }
}
