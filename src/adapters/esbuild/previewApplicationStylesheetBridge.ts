/** Shares application-root stylesheet imports between component and Page Inspector bridges. */
import path from 'node:path';
import type { OnResolveArgs, OnResolveResult, PluginBuild } from 'esbuild';
import {
  isPreviewApplicationStylesheetPath,
  type PreviewApplicationStylesheetImportSelection,
} from './previewApplicationStylesheetSelection';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';

export const PREVIEW_APPLICATION_STYLESHEET_SPECIFIER_PREFIX =
  'react-preview:application-stylesheet/';

/** Creates one private import that is resolved relative to the application file that authored it. */
export function createPreviewApplicationStylesheetSpecifier(index: number): string {
  return `${PREVIEW_APPLICATION_STYLESHEET_SPECIFIER_PREFIX}${index.toString()}`;
}

/** Registers bounded local CSS/Sass resolution without evaluating the application entry module. */
export function registerPreviewApplicationStylesheetResolver(
  build: PluginBuild,
  selections: readonly PreviewApplicationStylesheetImportSelection[],
): void {
  build.onResolve(
    { filter: /^react-preview:application-stylesheet\// },
    async (arguments_): Promise<OnResolveResult | undefined> =>
      resolvePreviewApplicationStylesheet(arguments_, build, selections),
  );
}

/** Resolves only compiler-generated application stylesheet requests. */
async function resolvePreviewApplicationStylesheet(
  arguments_: OnResolveArgs,
  build: PluginBuild,
  selections: readonly PreviewApplicationStylesheetImportSelection[],
): Promise<OnResolveResult | undefined> {
  if (!arguments_.path.startsWith(PREVIEW_APPLICATION_STYLESHEET_SPECIFIER_PREFIX)) {
    return undefined;
  }
  const indexText = arguments_.path.slice(PREVIEW_APPLICATION_STYLESHEET_SPECIFIER_PREFIX.length);
  if (!/^(?:0|[1-9]\d?)$/u.test(indexText)) {
    return { errors: [{ text: 'React Preview received an invalid application stylesheet.' }] };
  }
  const selection = selections[Number(indexText)];
  if (selection === undefined) {
    return { errors: [{ text: 'React Preview application stylesheet is unavailable.' }] };
  }
  const resolution = await build.resolve(selection.moduleSpecifier, {
    importer: selection.importerPath,
    kind: 'import-statement',
    namespace: 'file',
    pluginData: PREVIEW_RESOLVE_GUARD,
    resolveDir: path.dirname(selection.importerPath),
  });
  if (resolution.errors.length > 0) {
    return { errors: resolution.errors, warnings: resolution.warnings };
  }
  if (
    resolution.external ||
    resolution.namespace !== 'file' ||
    !path.isAbsolute(resolution.path) ||
    !isPreviewApplicationStylesheetPath(resolution.path)
  ) {
    return {
      errors: [
        {
          text: `React Preview application stylesheets must resolve to local CSS or Sass files: ${selection.moduleSpecifier}`,
        },
      ],
      warnings: resolution.warnings,
    };
  }
  return { ...resolution, sideEffects: true };
}
