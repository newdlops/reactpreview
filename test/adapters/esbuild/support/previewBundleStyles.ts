/** Test helper for reading both eager and preserved lazy stylesheet artifacts from one bundle. */
import type { PreviewBundle } from '../../../../src/domain/preview';

/**
 * Decodes every CSS artifact in deterministic publication order.
 *
 * @param bundle Compiler result containing an optional eager sheet and lazy CSS chunk files.
 * @returns Concatenated UTF-8 CSS suitable for content-oriented integration assertions.
 */
export function decodePreviewBundleStyles(bundle: PreviewBundle): string {
  const stylesheets = [
    ...(bundle.stylesheet === undefined ? [] : [bundle.stylesheet]),
    ...bundle.chunks
      .filter((chunk) => chunk.relativePath.endsWith('.css'))
      .map((chunk) => chunk.contents),
  ];
  const decoder = new TextDecoder();
  return stylesheets.map((stylesheet) => decoder.decode(stylesheet)).join('\n');
}
