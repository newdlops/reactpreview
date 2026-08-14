/**
 * Selects dependency sources that still need the exact compatibility pipeline during automatic
 * selected-corridor preparation. Ordinary modules can remain on esbuild's native parser, while
 * project runtime boundaries and non-native resource expressions retain preview instrumentation.
 */

/** Runtime/provider syntax whose omission can prevent the provisional component tree from mounting. */
const RUNTIME_BOUNDARY_TOKENS = [
  'createContext',
  'formik',
  'getFragmentData',
  'gql',
  'react-redux',
  'react-router',
  'styled-components',
  'useContext',
] as const;

/** Packages whose hooks are React/runtime primitives rather than project data boundaries. */
const NATIVE_HOOK_MODULES = new Set([
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-dev-runtime',
  'react/jsx-runtime',
  'styled-components',
]);

const CUSTOM_HOOK_NAME_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*$/u;
const STORE_HOOK_NAME_PATTERN = /^use[A-Z0-9_$][A-Za-z0-9_$]*Store$/u;
const IMPORT_DECLARATION_PATTERN =
  /\bimport\s+(?:type\s+)?([\s\S]{1,480}?)\s+from\s+(['"])([^'"]+)\2/gu;
const STATIC_RENDER_ASSET_PATTERN =
  /(?:\b(?:background(?:Image)?|href|icon|image(?:Url)?|poster|src(?:Set)?|xlinkHref)\s*(?:=|:)\s*(?:\{?\s*)?["'`]|\b[A-Za-z_$][\w$]*(?:asset|avatar|background|icon|image|img|logo|poster|src|url|uri)\s*=\s*["'`])/iu;

/**
 * Returns whether one reached dependency needs preview-specific source rewriting.
 * The check intentionally uses bounded lexical evidence; false positives cost one exact transform,
 * whereas a false negative could omit a provider, data fallback, or finite resource expansion.
 */
export function requiresPreviewDependencyCompatibility(
  sourceText: string,
  projectUsesNextRuntime: boolean | undefined,
): boolean {
  if (
    sourceText.includes('import.meta.glob') ||
    sourceText.includes('require.context') ||
    (sourceText.includes('new URL') && sourceText.includes('import.meta.url')) ||
    STATIC_RENDER_ASSET_PATTERN.test(sourceText) ||
    /\bimport\s*\(\s*(?!["'])/u.test(sourceText) ||
    /\brequire\s*\(\s*(?!["'])/u.test(sourceText)
  ) {
    return true;
  }
  if (
    sourceText.includes('@emotion/styled') ||
    sourceText.includes('next/dynamic') ||
    sourceText.includes('next/font') ||
    hasImportedRuntimeHookCall(sourceText) ||
    /\buse[A-Z_$][\w$]*Context\b/u.test(sourceText) ||
    RUNTIME_BOUNDARY_TOKENS.some((token) => sourceText.includes(token))
  ) {
    return true;
  }
  return (
    projectUsesNextRuntime === true &&
    (sourceText.includes('generateMetadata') ||
      sourceText.includes('generateViewport') ||
      sourceText.includes('export const metadata') ||
      sourceText.includes('export const viewport'))
  );
}

/**
 * Finds a project/package hook import that is also invoked by this module.
 *
 * The provisional compiler normally passes ordinary dependencies directly to esbuild. A selected
 * VirtualPage corridor may replace a render-blocking hook module with a shallow surface, however,
 * and its importer must then receive the exact demand-shaped fallback transformation. This bounded
 * lexical gate admits only imported `useX` bindings (including aliases, defaults, namespaces, and
 * generic calls), avoiding a TypeScript parse for components that merely use React primitives.
 */
function hasImportedRuntimeHookCall(sourceText: string): boolean {
  if (!sourceText.includes('import') || !sourceText.includes('use')) return false;
  IMPORT_DECLARATION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMPORT_DECLARATION_PATTERN.exec(sourceText)) !== null) {
    const clause = match[1] ?? '';
    const moduleSpecifier = match[3] ?? '';
    if (NATIVE_HOOK_MODULES.has(moduleSpecifier)) continue;

    for (const bindingName of readImportedHookBindingNames(clause)) {
      if (
        hasDirectHookCall(sourceText, bindingName) ||
        (STORE_HOOK_NAME_PATTERN.test(bindingName) && hasStoreSnapshotCall(sourceText, bindingName))
      ) {
        return true;
      }
    }
    const namespaceName = /\*\s+as\s+([A-Za-z_$][\w$]*)/u.exec(clause)?.[1];
    if (
      namespaceName !== undefined &&
      new RegExp(
        `\\b${escapeRegularExpression(namespaceName)}\\s*\\.\\s*use[A-Z0-9_$][\\w$]*\\s*(?:<[^;(){}]{0,240}>)?\\s*\\(`,
        'u',
      ).test(sourceText)
    ) {
      return true;
    }
  }
  return false;
}

/** Reads default and named local hook bindings from one already bounded import clause. */
function readImportedHookBindingNames(clause: string): readonly string[] {
  const names = new Set<string>();
  const defaultName = /^\s*([A-Za-z_$][\w$]*)/u.exec(clause)?.[1];
  if (defaultName !== undefined && CUSTOM_HOOK_NAME_PATTERN.test(defaultName)) {
    names.add(defaultName);
  }
  const namedBlock = /\{([\s\S]{0,400})\}/u.exec(clause)?.[1] ?? '';
  for (const item of namedBlock.split(',')) {
    const binding = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?/u.exec(item);
    const importedName = binding?.[1];
    const localName = binding?.[2] ?? importedName;
    if (
      importedName !== undefined &&
      localName !== undefined &&
      CUSTOM_HOOK_NAME_PATTERN.test(importedName)
    ) {
      names.add(localName);
    }
  }
  return Object.freeze([...names]);
}

/** Matches ordinary and TypeScript-generic calls without attempting to parse arbitrary syntax. */
function hasDirectHookCall(sourceText: string, bindingName: string): boolean {
  return new RegExp(
    `\\b${escapeRegularExpression(bindingName)}\\s*(?:<[^;(){}]{0,240}>)?\\s*\\(`,
    'u',
  ).test(sourceText);
}

/** Matches the side-effect-free synchronous snapshot reader exposed by Zustand-style hook stores. */
function hasStoreSnapshotCall(sourceText: string, bindingName: string): boolean {
  return new RegExp(
    `\\b${escapeRegularExpression(bindingName)}\\s*\\.\\s*getState\\s*\\(`,
    'u',
  ).test(sourceText);
}

/** Escapes a statically parsed identifier before it is embedded in a bounded regular expression. */
function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
