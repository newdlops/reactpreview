/**
 * JSON-safe, bounded host-side description of the styled-components boundary.  This is kept
 * deliberately free of AST nodes and source text because it participates in preview build identity.
 */
export const PREVIEW_STYLED_COMPONENTS_PLAN_VERSION = 1;
export const MAX_STYLE_SHEET_MANAGER_SOURCE_BYTES = 1024 * 1024;
export const MAX_STYLE_SHEET_MANAGER_MODULES = 32;
export const MAX_STYLE_SHEET_MANAGER_LAYERS = 4;
export const MAX_STYLE_SHEET_MANAGER_IMPORTED_BINDINGS = 16;
export const MAX_STYLE_SHEET_MANAGER_STYLIS_PLUGINS = 8;
export const MAX_STYLE_SHEET_MANAGER_IGNORED_REASONS = 16;

export type PreviewStyleSheetBindingAccess =
  { readonly kind: 'default' } | { readonly kind: 'named'; readonly exportName: string };

export interface PreviewStyleSheetBindingReference {
  readonly access: PreviewStyleSheetBindingAccess;
  readonly importerPath: string;
  readonly moduleSpecifier: string;
  readonly resolutionKind: 'import-statement' | 'require-call';
}
/** Explicit alias used by the virtual manager plugin protocol. */
export type PreviewStyleSheetManagerBindingReference = PreviewStyleSheetBindingReference;

export type PreviewStylisPlugins =
  | { readonly kind: 'binding'; readonly value: PreviewStyleSheetBindingReference }
  | {
      readonly kind: 'binding-array';
      readonly values: readonly PreviewStyleSheetBindingReference[];
    };

export interface PreviewStyleSheetManagerLayer {
  readonly disableCSSOMInjection?: boolean;
  readonly disableVendorPrefixes?: boolean;
  readonly enableVendorPrefixes?: boolean;
  readonly shouldForwardProp?: PreviewStyleSheetBindingReference;
  readonly sourceKind: 'authored' | 'synthetic';
  readonly stylisPlugins?: PreviewStylisPlugins;
}

export type PreviewStyleSheetManagerIgnoredReason =
  | 'analysis-truncated'
  | 'ambiguous-manager'
  | 'computed-value'
  | 'conflicting-vendor-prefix-props'
  | 'local-runtime-value'
  | 'nonce'
  | 'parse-error'
  | 'sheet'
  | 'spread-props'
  | 'target'
  | 'unsupported-prop'
  | 'unresolved-binding';

export interface PreviewStyledComponentsPlan {
  readonly available: boolean;
  readonly dependencyPaths: readonly string[];
  readonly evidence: 'absent' | 'authored' | 'synthetic';
  readonly ignoredReasons: readonly PreviewStyleSheetManagerIgnoredReason[];
  /** Manager layers are always ordered outer-to-inner. */
  readonly layers: readonly PreviewStyleSheetManagerLayer[];
  readonly sharedRuntimeChunk: boolean;
  readonly version: typeof PREVIEW_STYLED_COMPONENTS_PLAN_VERSION;
}

/** Creates a deeply frozen plan suitable for cross-module build identity comparisons. */
export function createPreviewStyledComponentsPlan(
  value: Omit<PreviewStyledComponentsPlan, 'version'> & {
    readonly version?: typeof PREVIEW_STYLED_COMPONENTS_PLAN_VERSION;
  },
): PreviewStyledComponentsPlan {
  return deepFreeze({ ...value, version: PREVIEW_STYLED_COMPONENTS_PLAN_VERSION });
}

/** Recursively freezes JSON-like plan data before it enters build identity. */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}
