/**
 * Creates the ordered-export virtual bridge between the runtime entry and the active source file.
 * Explicit component exports remain statically imported for tree shaking, while an `export *` slot
 * expands the final module namespace only at that exact source position. A directly imported theme
 * candidate is exposed as private metadata without loading an application entry point.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import type { PreviewParentSlicePlansByExport } from './parentSlice';
import { createPreviewParentSliceSpecifier } from './previewParentSlicePlugin';
import type { PreviewTargetExportSlot, PreviewThemeImportSelection } from './previewTargetExports';
import type { PreviewStaticPropsByExport } from './previewTargetUsageProps';
import { PREVIEW_TARGET_BRIDGE_NAMESPACE, PREVIEW_TARGET_SPECIFIER } from './previewPluginProtocol';

/** Immutable source metadata required to create one target gallery bridge. */
export interface PreviewTargetBridgePluginOptions {
  /** Absolute active-document path whose component exports become gallery entries. */
  readonly documentPath: string;
  /** Ordered direct export slots selected from the active editor snapshot. */
  readonly exports?: readonly PreviewTargetExportSlot[];
  /** Optional direct import that is already an explicit theme dependency of the target file. */
  readonly themeImport?: PreviewThemeImportSelection;
  /** Export-specific JSX branches mounted only when no explicit project setup owns composition. */
  readonly parentSlicesByExport?: PreviewParentSlicePlansByExport;
  /** Lowest-priority primitive props collected from real target JSX usages. */
  readonly usagePropsByExport?: PreviewStaticPropsByExport;
}

/**
 * Creates a virtual module that exposes ordered component descriptors and optional theme metadata.
 *
 * @param options Active document, export slots, and an optional explicit theme import.
 * @returns Stateless esbuild plugin scoped to one compilation request.
 */
export function createPreviewTargetBridgePlugin(options: PreviewTargetBridgePluginOptions): Plugin {
  /** Resolves only the private target specifier emitted by the generated browser entry. */
  function resolveTargetBridge(arguments_: OnResolveArgs): OnResolveResult | undefined {
    if (arguments_.path !== PREVIEW_TARGET_SPECIFIER) {
      return undefined;
    }
    return {
      namespace: PREVIEW_TARGET_BRIDGE_NAMESPACE,
      path: options.documentPath,
    };
  }

  /** Generates static imports plus a small source-ordered descriptor inventory. */
  function loadTargetBridge(arguments_: OnLoadArgs): OnLoadResult {
    const documentSpecifier = JSON.stringify(arguments_.path.replaceAll('\\', '/'));
    const selections = options.exports ?? [
      { displayName: 'default', exportName: 'default', kind: 'explicit' as const },
    ];
    for (const selection of selections) {
      if (selection.kind === 'explicit') {
        assertValidExportName(selection.exportName);
      }
    }
    if (options.themeImport !== undefined) {
      assertValidExportName(options.themeImport.exportName);
    }
    return {
      contents: createTargetBridgeSource(
        documentSpecifier,
        selections,
        options.themeImport,
        options.parentSlicesByExport ?? {},
        options.usagePropsByExport ?? {},
      ),
      loader: 'js',
      resolveDir: path.dirname(options.documentPath),
    };
  }

  return {
    name: 'react-preview-target-bridge',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:target$/ }, resolveTargetBridge);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_TARGET_BRIDGE_NAMESPACE }, loadTargetBridge);
    },
  };
}

/**
 * Builds a bridge module without evaluating target values inside the extension host.
 *
 * @param documentSpecifier JSON-encoded absolute target module path.
 * @param selections Source-ordered explicit and wildcard export slots.
 * @param themeImport Optional direct project theme import selected by static syntax.
 * @returns Browser JavaScript exporting descriptors as default and theme metadata by name.
 */
function createTargetBridgeSource(
  documentSpecifier: string,
  selections: readonly PreviewTargetExportSlot[],
  themeImport: PreviewThemeImportSelection | undefined,
  parentSlicesByExport: PreviewParentSlicePlansByExport,
  usagePropsByExport: PreviewStaticPropsByExport,
): string {
  const explicitSelections = selections.filter(
    (selection): selection is Extract<PreviewTargetExportSlot, { readonly kind: 'explicit' }> =>
      selection.kind === 'explicit',
  );
  const hasWildcard = selections.some((selection) => selection.kind === 'wildcard');
  const importLines = explicitSelections.map((selection, index) => {
    const parentSlice = parentSlicesByExport[selection.exportName];
    return parentSlice !== undefined && parentSlice.frames.length > 0
      ? `import __reactPreviewExport${index.toString()} from ${JSON.stringify(createPreviewParentSliceSpecifier(selection.exportName))};`
      : `import { ${selection.exportName} as __reactPreviewExport${index.toString()} } from ${documentSpecifier};`;
  });
  if (hasWildcard) {
    importLines.push(`import * as __reactPreviewNamespace from ${documentSpecifier};`);
  } else if (explicitSelections.length === 0) {
    importLines.push(`import ${documentSpecifier};`);
  }

  const themeSource = createThemeImportSource(themeImport);
  if (themeSource.importLine !== undefined) {
    importLines.push(themeSource.importLine);
  }
  const reservedNames = explicitSelections.map((selection) => selection.exportName);
  const explicitIndexes = new Map(
    explicitSelections.map((selection, index) => [selection, index] as const),
  );
  const slotLines = selections.flatMap((selection) => {
    if (selection.kind === 'explicit') {
      const index = explicitIndexes.get(selection);
      if (index === undefined) {
        return [];
      }
      return [
        `__reactPreviewTargets.push({ automaticProps: ${JSON.stringify(usagePropsByExport[selection.exportName] ?? {})}, displayName: ${JSON.stringify(selection.displayName)}, exportName: ${JSON.stringify(selection.exportName)}, parentSlice: ${serializeParentSliceMetadata(parentSlicesByExport[selection.exportName])}, value: __reactPreviewExport${index.toString()} });`,
      ];
    }
    return [
      'for (const exportName of Object.keys(__reactPreviewNamespace).sort()) {',
      '  if (!/^\\p{Lu}[$_\\p{L}\\p{N}\\u200C\\u200D]*$/u.test(exportName) || __reactPreviewSeenNames.has(exportName)) continue;',
      '  __reactPreviewSeenNames.add(exportName);',
      '  __reactPreviewTargets.push({ displayName: exportName, exportName, value: __reactPreviewNamespace[exportName] });',
      '}',
    ];
  });

  return [
    ...importLines,
    `const __reactPreviewSeenNames = new Set(${JSON.stringify(reservedNames)});`,
    'const __reactPreviewTargets = [];',
    ...slotLines,
    `export const previewTheme = ${themeSource.reference};`,
    'export default Object.freeze(__reactPreviewTargets);',
  ].join('\n');
}

/** Serializes bounded provenance shown only when an export later fails inside its selected slice. */
function serializeParentSliceMetadata(
  plan: PreviewParentSlicePlansByExport[string] | undefined,
): string {
  if (plan === undefined || plan.frames.length === 0) {
    return 'undefined';
  }
  return JSON.stringify({
    complete: plan.complete,
    frameCount: plan.frames.length,
    localOwnerDepth: plan.localOwnerDepth,
    projectOwnerDepth: plan.projectOwnerDepth,
    sourcePath: plan.sourcePath,
  });
}

/** Creates one safe direct theme import and the reference exported by the bridge. */
function createThemeImportSource(themeImport: PreviewThemeImportSelection | undefined): {
  readonly importLine?: string;
  readonly reference: string;
} {
  if (themeImport === undefined) {
    return { reference: 'undefined' };
  }
  const moduleSpecifier = JSON.stringify(themeImport.moduleSpecifier);
  return {
    importLine: `import { ${themeImport.exportName} as __reactPreviewTheme } from ${moduleSpecifier};`,
    reference: '__reactPreviewTheme',
  };
}

/** Rejects names that cannot appear in an ECMAScript import specifier. */
function assertValidExportName(exportName: string): void {
  if (
    exportName !== 'default' &&
    !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
  ) {
    throw new TypeError(`Invalid React preview target export name: ${exportName}`);
  }
}
