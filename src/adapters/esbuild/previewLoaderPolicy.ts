/**
 * Centralizes source loaders and inline asset extensions accepted by the preview compiler.
 * Keeping this policy outside the compiler and asset plugin prevents their resolution and loading
 * rules from drifting apart as new render-oriented file formats are added.
 */
import path from 'node:path';
import type { Loader } from 'esbuild';

/** Source loaders whose behavior differs from esbuild's extension defaults. */
export const PREVIEW_SOURCE_LOADERS = {
  '.js': 'jsx',
  '.module.css': 'local-css',
} as const satisfies Readonly<Record<string, Loader>>;

/** Asset extensions that may be embedded into a serverless preview as bounded data URLs. */
const INLINE_ASSET_EXTENSIONS = new Set([
  '.apng',
  '.avif',
  '.bmp',
  '.eot',
  '.gif',
  '.ico',
  '.jfif',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.mp3',
  '.mp4',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.svg',
  '.ttf',
  '.wav',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
]);

/**
 * Reports whether a resolved request belongs to the bounded data-URL asset policy.
 * Extension matching is case-insensitive so common uppercase camera and icon filenames work too.
 *
 * @param filePath Query-free filesystem request inspected before normal source resolution.
 * @returns `true` when the asset plugin should resolve, validate, and load the file.
 */
export function isInlinePreviewAssetPath(filePath: string): boolean {
  return INLINE_ASSET_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
