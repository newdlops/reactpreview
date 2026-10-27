/** Bounded syntax inference contracts, mutable state, and limits shared by prop analysis. */
import ts from 'typescript';
import { PREVIEW_COLLECTION_METHOD_NAMES } from '../previewCollectionMethodNames';
import { PREVIEW_STRING_ONLY_METHOD_NAMES } from '../previewStringMethodNames';
import { type PreviewPropCollectionKind } from './reactPropCollectionType';

export const MAX_COMPONENT_EXPORTS = 32;

export const MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH = 12;

export const MAX_INFERRED_DEPTH = 10;

export const MAX_INFERRED_NODES = 192;

export const MIN_USAGE_NODE_RESERVE = 32;

export const MAX_IMPORTED_TYPE_MODULES = 12;

export const MAX_IMPORTED_TYPE_BYTES = 2 * 1024 * 1024;

export const MAX_STATIC_REGISTRY_HINTS = 16;

export const MAX_STATIC_REGISTRY_SOURCE_BYTES = 512 * 1024;

export const BLOCKED_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'key',
  'prototype',
  'ref',
]);

export const ARRAY_METHOD_NAMES = new Set<string>(PREVIEW_COLLECTION_METHOD_NAMES);

export const ARRAY_INDEX_PATTERN = /^(?:0|[1-9]\d*)$/u;

export const ARRAY_ITEM_CALLBACK_METHOD_NAMES = new Set([
  'every',
  'filter',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'flatMap',
  'forEach',
  'map',
  'reduce',
  'reduceRight',
  'some',
]);

export const ARRAY_ITEM_CALLBACK_PARAMETER_INDEX = new Map<string, number>([
  ['reduce', 1],
  ['reduceRight', 1],
]);

export const ARRAY_ITEM_IDENTITY_METHOD_NAMES = new Set([
  'filter',
  'slice',
  'toReversed',
  'toSorted',
]);

export const LOCAL_HELPER_ITEM_IDENTITY_METHOD_NAMES = new Set([
  ...ARRAY_ITEM_IDENTITY_METHOD_NAMES,
  'sort',
]);

export const RENDERED_COLLECTION_PROP_NAMES = new Set([
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

export const RENDERED_COLLECTION_CONFIG_PROP_NAMES = new Set(['columns', 'fields']);

export const RENDERED_COLLECTION_FIELD_KEY_NAMES = new Set([
  'accessorkey',
  'dataindex',
  'field',
  'key',
]);

export const RENDERED_COLLECTION_CALLBACK_NAMES = new Set([
  'accessor',
  'body',
  'cell',
  'formatter',
  'getvalue',
  'render',
  'valuegetter',
]);

export const RENDERED_COLLECTION_ITEM_WRAPPER_NAMES = new Set([
  'data',
  'item',
  'object',
  'record',
  'row',
  'value',
]);

export const STRING_METHOD_NAMES = new Set<string>(PREVIEW_STRING_ONLY_METHOD_NAMES);

export const STRING_COLLECTION_SHARED_METHOD_NAMES = new Set([
  'at',
  'concat',
  'includes',
  'indexOf',
  'lastIndexOf',
  'slice',
]);

export const KEYED_COLLECTION_HELPER_PATTERN = /^(?:group|index|key|order|sort).*By/iu;

/** Accepts only primitive branch choices supported by generated prop descriptors. */
export function isPreviewInferredCandidateValue(
  value: unknown,
): value is boolean | number | string {
  return typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';
}

/** Neutral value categories understood by the generated browser materializer. */
export type PreviewInferredPropKind =
  | 'array'
  | 'boolean'
  | 'component'
  | 'element'
  | 'function'
  | 'graphql-document'
  | 'null'
  | 'number'
  | 'object'
  | 'string';

/** JSON-safe recursive shape emitted into target and Inspector bridge descriptors. */
export interface PreviewInferredPropShape {
  /** Finite authored branch values used to diversify generated rendered-collection rows. */
  readonly candidateValues?: readonly (boolean | number | string)[];
  /** True only when authored literal/control-flow syntax proves the exact generated scalar. */
  readonly exactValue?: true;
  /** Element contract for arrays when syntax or a resolved type proves its required fields. */
  readonly items?: PreviewInferredPropShape;
  readonly kind: PreviewInferredPropKind;
  /** Array items an authored index read reaches (`finals[k]`, `k: 0 | 1 | 2 | 3` needs four). */
  readonly minItems?: number;
  /** An object prop declared as a built-in Map or Set, materialized as an empty one. */
  readonly collection?: PreviewPropCollectionKind;
  readonly properties?: Readonly<Record<string, PreviewInferredPropShape>>;
  /** True only when JSX proves that this Array directly feeds a list/table collection prop. */
  readonly renderedCollection?: true;
  /** A text leaf read directly as React child content (`<h1>{title}</h1>`), shown as-is. */
  readonly renderedText?: true;
  readonly value?: boolean | number | string | null;
}

/** Exact child-component prop contracts indexed by local JSX binding and attribute name. */
export type PreviewChildPropDemandCatalog = ReadonlyMap<
  string,
  ReadonlyMap<string, PreviewInferredPropShape>
>;

/** Exact child contracts, optionally prepared only after syntax proves a prop-forwarding edge. */
export type PreviewChildPropDemandSource =
  PreviewChildPropDemandCatalog | (() => PreviewChildPropDemandCatalog);

/** Human-readable provenance shown beside editable values in React Page Inspector. */
export interface PreviewInferredPropProvenance {
  readonly kind: PreviewInferredPropKind;
  readonly path: string;
  readonly source: 'type' | 'usage';
}

/** One export's materialization recipe and the paths the extension invented. */
export interface PreviewInferredExportProps {
  readonly provenance: readonly PreviewInferredPropProvenance[];
  readonly shape: PreviewInferredPropShape;
}

/** Exact runtime export-name map consumed without evaluating the selected source module. */
export type PreviewInferredPropsByExport = Readonly<Record<string, PreviewInferredExportProps>>;

export type ExportedFunctionLike =
  ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | ts.MethodDeclaration;

export type LocalObjectType = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** One named or default import ordered for bounded type-contract resolution. */
export interface ResolvableObjectTypeImport {
  readonly importedName: string;
  readonly localName: string;
  /** Prioritizes types directly referenced by an authored component props declaration. */
  readonly propsDependency: boolean;
  /** Keeps direct component-prop wrappers ahead of large unrelated declaration graphs. */
  readonly propsContract: boolean;
  readonly moduleSpecifier: string;
  readonly order: number;
  readonly typeOnly: boolean;
}

/** One parsed direct-import module shared by all bindings from the same authored specifier. */
export interface ResolvedObjectTypeModule {
  readonly sourceFile: ts.SourceFile;
  readonly sourcePath: string;
}

/** One exported object declaration paired with the parsed module that owns its dependencies. */
export interface ResolvedImportedObjectType {
  readonly declaration: LocalObjectType;
  readonly module: ResolvedObjectTypeModule;
}

/** Bounded parse-only import reader shared by compiler and child-demand callers. */
export interface PreviewPropInferenceOptions {
  /** Imported/local child contracts used only for identity-preserving JSX prop forwarding. */
  readonly childPropDemands?: PreviewChildPropDemandSource;
  readonly resolveImport?: (
    moduleSpecifier: string,
    importerPath: string,
  ) => Readonly<{ sourcePath: string; sourceText: string }> | undefined;
}

/** Primitive key accepted by one statically resolved label/renderer registry. */
export type PreviewStaticRegistryKey = boolean | number | string;

/** Mutable internal node that retains merge provenance before deterministic serialization. */
export interface MutableShapeNode {
  /** Source-ordered finite primitive values accepted by rendered callback branches. */
  candidateValues?: (boolean | number | string)[];
  children: Map<string, MutableShapeNode>;
  /** Built-in collection a prop's declaration names (`promoWeeks?: Map<number, string>`). */
  collection?: PreviewPropCollectionKind;
  /** Retains authored literal/control-flow evidence across compatible shape merges. */
  exactValue?: true;
  /** Lets operation-proven literals outrank a type union's arbitrary first materialized member. */
  exactValueSource?: PreviewInferredPropProvenance['source'];
  /** Element contract for an Array node, retained only when its syntax is statically resolvable. */
  items?: MutableShapeNode;
  /** Direct iterable destructuring proves that an otherwise scalar-typed Array needs one sample. */
  itemConsumed?: true;
  kind: PreviewInferredPropKind;
  /** Smallest sample length that keeps every bounded authored index read inside the Array. */
  minItems?: number;
  /** The callback item itself was emitted as React child content rather than only keyed. */
  renderedValue?: true;
  /** JSX proves that this Array is passed to a conventional list/table data prop. */
  renderedCollection?: true;
  source: PreviewInferredPropProvenance['source'];
  value?: boolean | number | string | null;
}

/** One local identifier proven to represent a path rooted at the component's props object. */
export interface PropPathBinding {
  readonly path: readonly string[];
}

/** Export name paired with the function body that React will invoke for that export. */
export interface ExportedComponentFunction {
  /** Props type supplied by a variable annotation such as `React.FC<CardProps>`. */
  readonly classComponentProps?: true;
  readonly contextualPropsType?: ts.TypeNode;
  readonly exportName: string;
  readonly functionLike: ExportedFunctionLike;
}

/** Function body plus the optional variable-level React component props contract. */
export interface ComponentFunctionCandidate {
  /** The function is a class render method whose external prop root is `this.props`. */
  readonly classComponentProps?: true;
  readonly contextualPropsType?: ts.TypeNode;
  readonly functionLike: ExportedFunctionLike;
}

/** Same-file declaration that may be a function or a bounded chain of component wrappers. */
export interface LocalComponentDeclaration {
  readonly classComponentProps?: true;
  readonly contextualPropsType?: ts.TypeNode;
  readonly expression?: ts.Expression;
  readonly functionLike?: ExportedFunctionLike;
}

/** Bounded mutable inference state for one exported function. */
export interface InferenceState {
  /** Component names already traversed while carrying one exact local JSX prop demand. */
  readonly activeLocalComponentNames: ReadonlySet<string>;
  /** Allows only a detached Array callback item to become a scalar ReactNode fallback. */
  readonly allowRenderedRootScalar: boolean;
  readonly aliases: Map<string, PropPathBinding>;
  readonly childPropDemands: PreviewChildPropDemandSource | undefined;
  readonly collectionDemandDepth: number;
  readonly functionLike: ExportedFunctionLike;
  /** Local bindings of the canonical GraphQL fragment identity helper. */
  readonly graphqlFragmentUnmaskBindings: ReadonlySet<string>;
  readonly graphqlDocumentTypeNames: ReadonlySet<string>;
  /** Local helper parameters whose returned arrays retain the original item identities. */
  readonly identityCollectionHelperParameters: ReadonlyMap<string, ReadonlySet<number>>;
  readonly localComponents: ReadonlyMap<string, LocalComponentDeclaration>;
  readonly localComponentDemandDepth: number;
  readonly localTypes: ReadonlyMap<string, LocalObjectType>;
  /** Current phase ceiling; large type unions reserve capacity for operation-proven leaves. */
  nodeLimit: number;
  nodeCount: number;
  /** Source-proven registry keys that replace generic name-derived discriminator text. */
  readonly registryDiscriminantHints: ReadonlyMap<string, PreviewStaticRegistryKey>;
  root: MutableShapeNode;
  readonly sourceFile: ts.SourceFile;
  /** Uses behind an optional receiver, applied only if other evidence materializes that receiver. */
  optionalOperations?: {
    readonly node: ts.Expression;
    readonly path: readonly string[];
    readonly receiverLength: number;
  }[];
}

export const CLASS_COMPONENT_PROPS_ALIAS = 'this.props';

export interface PreviewStaticRegistryImportBinding {
  readonly importedName: string;
  readonly moduleSpecifier: string;
}

export interface PreviewStaticRegistryModule {
  readonly enums: ReadonlyMap<string, ts.EnumDeclaration>;
  readonly objects: ReadonlyMap<string, ts.ObjectLiteralExpression>;
  readonly values: ReadonlyMap<string, ts.Expression>;
}
