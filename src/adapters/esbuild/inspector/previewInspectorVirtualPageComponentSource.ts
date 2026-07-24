/**
 * Generates an isolated ESM facade for one authentic component in a VirtualPage JSX traversal.
 *
 * VirtualPage follows statically rendered component imports transitively instead of executing a
 * complete application entry. Every reached component still uses its authored implementation. The
 * shared facade runtime gives each boundary independent recovery without repeating that runtime in
 * every generated module.
 */
import type { PreviewInspectorShallowProjection } from './previewInspectorShallowProjection';
import { PREVIEW_INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_SPECIFIER } from './previewInspectorVirtualPageComponentRuntimeSource';

/** Compiler-owned metadata required to import and expose one authentic project component module. */
export interface PreviewInspectorVirtualPageComponent {
  /** Exact authored source imported behind the generated facade. */
  readonly sourcePath: string;
  /** ESM exports proven to participate in the selected static JSX traversal. */
  readonly projection: PreviewInspectorShallowProjection;
}

/**
 * Creates a small browser module preserving an authored component's exact demanded ESM surface.
 *
 * The generated module registers its source before render, allowing an early-return condition
 * anywhere in the transitive VirtualPage tree to choose the statically proven JSX continuation.
 * No hop count is encoded here; esbuild module identity terminates authored import cycles.
 *
 * @param component Exact project source plus its demanded ESM surface.
 * @returns Browser-safe ESM source evaluated only when the selected VirtualPage reaches it.
 */
export function createPreviewInspectorVirtualPageComponentSource(
  component: PreviewInspectorVirtualPageComponent,
): string {
  const exportNames = component.projection.exportNames.filter(
    (exportName) => exportName === 'default' || /^[A-Za-z_$][\w$]*$/u.test(exportName),
  );
  const runtimeHookExportNames = new Set(component.projection.runtimeHookExportNames);
  const lines = [
    `import * as AuthoredModule from ${JSON.stringify(component.sourcePath)};`,
    `import { createVirtualPageComponent, registerVirtualPageSource } from ${JSON.stringify(
      PREVIEW_INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_SPECIFIER,
    )};`,
    `const sourcePath = ${JSON.stringify(component.sourcePath)};`,
    'registerVirtualPageSource(sourcePath);',
  ];

  if (exportNames.includes('default')) {
    lines.push('');
    if (runtimeHookExportNames.has('default')) {
      lines.push('export default AuthoredModule.default;');
    } else {
      lines.push(
        "const VirtualPageDefault = createVirtualPageComponent(AuthoredModule.default, 'default', sourcePath);",
        'export default VirtualPageDefault;',
      );
    }
  }
  exportNames
    .filter((exportName) => exportName !== 'default')
    .forEach((exportName, index) => {
      const localName = `VirtualPageNamed${index.toString()}`;
      lines.push('');
      if (runtimeHookExportNames.has(exportName)) {
        lines.push(
          `const ${localName} = AuthoredModule[${JSON.stringify(exportName)}];`,
          `export { ${localName} as ${exportName} };`,
        );
      } else {
        lines.push(
          `const ${localName} = createVirtualPageComponent(AuthoredModule[${JSON.stringify(
            exportName,
          )}], ${JSON.stringify(exportName)}, sourcePath);`,
          `export { ${localName} as ${exportName} };`,
        );
      }
    });
  return lines.join('\n');
}
