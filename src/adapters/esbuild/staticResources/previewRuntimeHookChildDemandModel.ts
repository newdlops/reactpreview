/** Bounded child prop demand contracts and JSX collection categories. */
import { type PreviewRuntimeHookImportedHelperNestedUsage } from './previewRuntimeHookAliasUsage';
import { type PreviewInferredPropShape } from './reactExportPropInference';

export const MAX_COMPONENT_IMPORTS = 32;

export const MAX_PROP_DEMANDS = 32;

export const MAX_PROP_DEPTH = 8;

export const MAX_SOURCE_CHARACTERS = 512 * 1024;

export const MAX_TRANSITIVE_COMPONENT_DEPTH = 6;

export const SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;

export const COLLECTION_IDENTITY_METHODS = new Set(['filter', 'slice', 'toReversed', 'toSorted']);

export const BLOCKED_PROP_NAMES = new Set(['__proto__', 'constructor', 'prototype']);

export const JSX_COLLECTION_PROP_NAMES = new Set([
  'data',
  'datalist',
  'items',
  'objectlist',
  'options',
  'records',
  'results',
  'rowdata',
  'rows',
  'values',
]);

export const JSX_COLLECTION_ITEM_WRAPPER_NAMES = new Set([
  'data',
  'item',
  'object',
  'record',
  'row',
  'value',
]);

export const JSX_COLLECTION_FIELD_CONFIG_PROP_NAMES = new Set(['columns', 'fields']);

export const JSX_COLLECTION_ACTION_CONFIG_PROP_NAMES = new Set([
  'actions',
  'itemactions',
  'rowactions',
]);

export const JSX_COLLECTION_FIELD_KEY_NAMES = new Set(['accessorkey', 'dataindex', 'field', 'key']);

export const JSX_COLLECTION_FIELD_CALLBACK_NAMES = new Set([
  'accessor',
  'cell',
  'formatter',
  'getvalue',
  'render',
  'valuegetter',
]);

export const JSX_COLLECTION_ACTION_CALLBACK_NAMES = new Set([
  'action',
  'execute',
  'handler',
  'onclick',
]);

export const JSX_COLLECTION_DIRECT_CALLBACK_PROP_NAMES = new Set([
  'getid',
  'getkey',
  'itemkey',
  'keyextractor',
  'renderitem',
  'renderrow',
  'rowkey',
]);

/** Operation-shaped use compatible with the hook analyzer's internal property-path contract. */
export interface PreviewRuntimeHookChildPropUsage {
  readonly called: boolean;
  /** Static one-item value inferred from the reached child's required collection element type. */
  readonly collectionItemExpression?: string;
  /** Nested child item paths surfaced in resolver diagnostics and partial-value repair. */
  readonly collectionItemRequiredPaths?: readonly string[];
  readonly collectionProperty?: string;
  readonly names: readonly string[];
  /** Exact authored literal/control-flow evidence that must replace a generic preview scalar. */
  readonly renderGuard?: true;
  readonly stringProperty?: string;
  /** Static scalar required to keep a reached child's render-only branch dormant. */
  readonly valueExpression?: string;
}

/** Child prop shapes indexed by the local JSX component binding and authored attribute name. */
export type PreviewRuntimeHookChildPropDemandCatalog = ReadonlyMap<
  string,
  ReadonlyMap<string, PreviewInferredPropShape>
>;

/** Per-source child contracts, collected only after an exact hook-to-JSX forwarding edge exists. */
export type PreviewRuntimeHookChildPropDemandSource =
  PreviewRuntimeHookChildPropDemandCatalog | (() => PreviewRuntimeHookChildPropDemandCatalog);

/** Serialized value contract inferred from an authored local or imported TypeScript type. */
export interface PreviewRuntimeHookLocalTypeFallback {
  /** Side-effect-free expression evaluated only inside the preview hook boundary. */
  readonly expression: string;
  /** Structural family proven by the expanded authored type. */
  readonly kind: PreviewInferredPropShape['kind'];
  /** Concise provenance shown when the generated value is surfaced as a blocker. */
  readonly label: string;
  /** Helper-relative structured uses retained for deep merging with caller-local hook demand. */
  readonly nestedUsages?: readonly PreviewRuntimeHookImportedHelperNestedUsage[];
  /** Nested item properties required by the expanded type. */
  readonly requiredPaths: readonly string[];
}

/** Minimal read-only module operations needed by the cross-component syntax catalog. */
export interface PreviewRuntimeHookChildPropDemandOptions {
  /** Returns a dirty editor snapshot before the catalog consults TypeScript's read-only host. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Resolves an authored import according to the active tsconfig/jsconfig aliases. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Trusted workspace boundary outside which component source is never inspected. */
  readonly workspaceRoot: string;
}

/** Imported component binding before its module is resolved and parsed. */
export interface ImportedComponentBinding {
  readonly exportName: string;
  readonly moduleSpecifier: string;
}

/** Optional members are read only when an authored value is already being supplied by its caller. */
export interface PreviewRuntimeHookChildPropDemandCollectOptions {
  readonly includeOptionalTypes?: boolean;
  /** Internal target-to-leaf depth retained across recursive imported JSX consumers. */
  readonly transitiveDepth?: number;
}
