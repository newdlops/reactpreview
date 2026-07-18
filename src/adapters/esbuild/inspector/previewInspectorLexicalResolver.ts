/**
 * Provides the dependency-free relative-import resolver used by standalone Inspector analysis.
 * Production callers supply the project-aware TypeScript resolver; this fallback lets focused
 * tests and conventional relative projects connect extensionless and directory-index imports.
 */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';

/**
 * Builds a bounded, inventory-only module resolver without probing or executing project config.
 *
 * @param sourcePaths Authored source inventory already admitted by the Inspector boundary.
 * @returns Resolver accepting only relative specifiers that map to an inventoried source file.
 */
export function createLexicalInspectorModuleResolver(
  sourcePaths: readonly string[],
): ResolvePreviewRenderGraphModule {
  const byStem = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const normalizedPath = path.normalize(sourcePath);
    byStem.set(removeInspectorSourceExtension(normalizedPath), normalizedPath);
    const basename = path.basename(normalizedPath).replace(/\.[^.]+$/u, '');
    if (basename === 'index') {
      byStem.set(path.dirname(normalizedPath), normalizedPath);
    }
  }
  return (moduleSpecifier, consumerPath) => {
    if (!moduleSpecifier.startsWith('.')) {
      return undefined;
    }
    return byStem.get(
      removeInspectorSourceExtension(
        path.resolve(
          path.dirname(consumerPath),
          moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier,
        ),
      ),
    );
  };
}

/** Treats extensionful and extensionless relative imports as one lexical inventory key. */
function removeInspectorSourceExtension(sourcePath: string): string {
  return path.normalize(sourcePath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
}
