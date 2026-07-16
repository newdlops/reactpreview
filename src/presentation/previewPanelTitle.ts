/**
 * Creates the compact label shown by VS Code for one pinned React Preview editor tab.
 * Runtime diagnostics keep the workspace-relative path separately; the editor chrome only needs
 * the basename and must not consume horizontal space with a long monorepo directory hierarchy.
 */
import path from 'node:path';

/**
 * Returns the platform-correct filename for a validated preview target path.
 *
 * @param documentPath Absolute filesystem path already accepted by the preview target resolver.
 * @returns Basename including the source extension, suitable for `WebviewPanel.title`.
 */
export function createPreviewPanelTitle(documentPath: string): string {
  return path.basename(documentPath);
}
