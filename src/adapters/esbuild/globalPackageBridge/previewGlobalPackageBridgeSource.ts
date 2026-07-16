/**
 * Generates one small esbuild inject module per statically selected global identifier.
 * Separate modules are important: esbuild can discard every unused candidate before visiting its
 * package graph, avoiding the cost and side effects of bundling all project dependencies.
 */
import type { PreviewGlobalPackageBridge } from './previewGlobalPackageBridge';
import { isSafePreviewRuntimeGlobalName } from '../previewRuntimeEnvironment';

/**
 * Creates validated ESM source that exports the exact identifier esbuild should inject.
 *
 * `auto` preserves a default-export or CommonJS `module.exports` identity and falls back to the
 * namespace for named-only ESM. The generated module never mutates the browser global object.
 *
 * @param bridge Validated package identity and export selection.
 * @returns Tiny side-effect-free ESM adapter source.
 */
export function createPreviewGlobalPackageBridgeSource(bridge: PreviewGlobalPackageBridge): string {
  assertValidBridge(bridge);
  const moduleSpecifier = JSON.stringify(bridge.moduleSpecifier);
  const selectionExpression = createSelectionExpression(bridge);
  return [
    `import * as __previewModuleNamespace from ${moduleSpecifier};`,
    `const __previewGlobalValue = ${selectionExpression};`,
    `export { __previewGlobalValue as ${bridge.globalName} };`,
  ].join('\n');
}

/** Selects default, named, namespace, or CommonJS-compatible automatic package identity. */
function createSelectionExpression(bridge: PreviewGlobalPackageBridge): string {
  switch (bridge.exportKind) {
    case 'auto':
      return "Object.prototype.hasOwnProperty.call(__previewModuleNamespace, 'default') ? __previewModuleNamespace.default : __previewModuleNamespace";
    case 'default':
      return '__previewModuleNamespace.default';
    case 'named':
      return `__previewModuleNamespace[${JSON.stringify(bridge.exportName)}]`;
    case 'namespace':
      return '__previewModuleNamespace';
  }
}

/** Defends the public generator from source-code injection through manually constructed metadata. */
function assertValidBridge(bridge: PreviewGlobalPackageBridge): void {
  if (!isSafePreviewRuntimeGlobalName(bridge.globalName)) {
    throw new TypeError(`Invalid preview global identifier: ${bridge.globalName}`);
  }
  if (bridge.moduleSpecifier.length === 0 || bridge.moduleSpecifier.includes('\0')) {
    throw new TypeError(`Invalid preview module specifier: ${bridge.moduleSpecifier}`);
  }
  if (
    bridge.exportKind === 'named' &&
    (bridge.exportName === undefined || !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(bridge.exportName))
  ) {
    throw new TypeError(`Invalid preview named export: ${String(bridge.exportName)}`);
  }
}
