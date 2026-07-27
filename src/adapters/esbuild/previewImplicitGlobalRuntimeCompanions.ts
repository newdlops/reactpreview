/** Narrows implicit-global evidence to authored runtime modules allowed in a page frontier. */
import path from 'node:path';
import type { PreviewGlobalPackageBridgeEvidencePolicy } from './globalPackageBridge';
import type { PreviewGlobalStyleImportSelection } from './previewGlobalStyleSelection';
import type { PreviewThemeImportSelection } from './previewTargetExports';

export interface CollectPreviewInspectorRuntimeCompanionPathsOptions {
  readonly globalBridgePolicy: PreviewGlobalPackageBridgeEvidencePolicy;
  readonly globalStyleImports: readonly PreviewGlobalStyleImportSelection[];
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly themeImport?: PreviewThemeImportSelection;
  readonly themeImporterPath: string;
}

/** Keeps assignment/declaration sources as watch evidence while admitting bridge runtime modules. */
export function collectPreviewImplicitGlobalRuntimeCompanionPaths(
  policy: PreviewGlobalPackageBridgeEvidencePolicy,
): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        policy.hints
          .map((hint) => hint.moduleSpecifier)
          .filter(
            (specifier): specifier is string =>
              typeof specifier === 'string' && path.isAbsolute(specifier),
          )
          .map((specifier) => path.normalize(specifier)),
      ),
    ].sort(),
  );
}

/** Admits every authored module imported only by compiler-generated runtime boundaries. */
export function collectPreviewInspectorRuntimeCompanionPaths(
  options: CollectPreviewInspectorRuntimeCompanionPathsOptions,
): readonly string[] {
  const paths = new Set(
    collectPreviewImplicitGlobalRuntimeCompanionPaths(options.globalBridgePolicy),
  );
  for (const globalStyleImport of options.globalStyleImports) {
    if (path.isAbsolute(globalStyleImport.moduleSpecifier))
      paths.add(path.normalize(globalStyleImport.moduleSpecifier));
  }
  if (options.themeImport !== undefined) {
    const themePath = options.resolveModule(
      options.themeImport.moduleSpecifier,
      options.themeImporterPath,
    );
    if (themePath !== undefined && path.isAbsolute(themePath)) paths.add(path.normalize(themePath));
  }
  return Object.freeze([...paths].sort());
}
