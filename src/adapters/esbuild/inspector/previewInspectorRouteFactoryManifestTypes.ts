/**
 * Immutable route-factory manifest contracts.
 *
 * A manifest is syntax evidence only: it describes factory-produced Router entries without calling
 * project factories or importing their page implementations in the extension host.
 */

/** Distinguishes direct page entries from nested application-module entries. */
export type PreviewInspectorFactoryRouteKind = 'page' | 'submodule';

/** Why a visible factory choice cannot yet become a selectable browser route. */
export type PreviewInspectorFactoryRouteAvailability =
  | 'selectable'
  | 'catalog-unresolved'
  | 'component-unresolved'
  | 'submodule-base-unresolved'
  | 'factory-contract-unresolved';

/** One renderable, non-fallback route recovered from a factory call. */
export interface PreviewInspectorFactoryRouteEntry {
  /** Catalog/factory pattern with authored parameter constraints preserved. */
  readonly absolutePattern: string;
  /** Public export used when the component import can be resolved. */
  readonly componentExportName?: string;
  /** Page-map key or nested-module component identity. */
  readonly componentName: string;
  /** Authored component module, when import syntax proves it. */
  readonly componentSourcePath?: string;
  /** Whether this entry is a direct page or a nested application module. */
  readonly kind: PreviewInspectorFactoryRouteKind;
  /** Constraint-free pattern passed to the owning React Router. */
  readonly relativeRouterPattern: string;
}

/** Fields shared by every visible factory choice. */
interface PreviewInspectorFactoryRouteOptionBase {
  readonly componentName: string;
  readonly kind: PreviewInspectorFactoryRouteKind;
  readonly occurrenceStart: number;
}

/** A factory choice whose static evidence proves a renderable route. */
export interface PreviewInspectorSelectableFactoryRouteOption extends PreviewInspectorFactoryRouteOptionBase {
  readonly availability: 'selectable';
  readonly route: PreviewInspectorFactoryRouteEntry;
}

/** A visible choice whose static route proof is incomplete. */
export interface PreviewInspectorUnavailableFactoryRouteOption extends PreviewInspectorFactoryRouteOptionBase {
  readonly availability: Exclude<PreviewInspectorFactoryRouteAvailability, 'selectable'>;
}

/** All choices survive analysis, including choices whose safe path proof is incomplete. */
export type PreviewInspectorFactoryRouteOption =
  PreviewInspectorSelectableFactoryRouteOption | PreviewInspectorUnavailableFactoryRouteOption;

/** Narrows a visible choice to one that has a statically renderable route. */
export function isPreviewInspectorSelectableFactoryRouteOption(
  option: PreviewInspectorFactoryRouteOption,
): option is PreviewInspectorSelectableFactoryRouteOption {
  return option.availability === 'selectable';
}

/** Literal wildcard fallback retained for diagnostics but excluded from normal route choices. */
export interface PreviewInspectorFactoryFallbackEntry {
  /** Fallback component spelling from the Route element. */
  readonly componentName: string;
  /** Stable source offset for deterministic diagnostic ordering. */
  readonly occurrenceStart: number;
  /** The only fallback pattern accepted by this static collector. */
  readonly pattern: '*';
}

/** Complete inert route inventory for one exported factory owner. */
export interface PreviewInspectorRouteFactoryManifest {
  /** Absolute base supplied to the selected factory invocation. */
  readonly basePattern: string;
  /** Sources read while proving definition, catalog, and component references. */
  readonly dependencies: readonly string[];
  /** Same-boundary wildcard Routes, deliberately not selectable page entries. */
  readonly fallbacks: readonly PreviewInspectorFactoryFallbackEntry[];
  /** Export identity of the selected factory owner. */
  readonly ownerExportName: string;
  /** Source module of the selected factory owner. */
  readonly ownerSourcePath: string;
  /** Renderable resolved page/submodule choices in source order. */
  readonly routes: readonly PreviewInspectorFactoryRouteEntry[];
  /** Complete choice set. `routes` is retained for compiler callers that only accept selectable paths. */
  readonly options: readonly PreviewInspectorFactoryRouteOption[];
  /** Number of callback values proven to be inserted beneath Routes. */
  readonly routeSlotCount: number;
  /** Choice names whose path/component evidence could not be safely joined. */
  readonly unresolvedChoiceNames: readonly string[];
}
