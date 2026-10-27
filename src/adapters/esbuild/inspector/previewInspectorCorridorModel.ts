/** Compiler-owned corridor namespaces, projection limits, and plugin contracts. */
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type {
  PreviewInspectorFrontierComponentExports,
  PreviewInspectorProjectedEdge,
} from './previewInspectorBundleFrontierTypes';
import { type PreviewInspectorShallowProjection } from './previewInspectorShallowProjection';

export const INSPECTOR_CORRIDOR_NAMESPACE = 'react-preview-inspector-corridor';

export const INSPECTOR_CORRIDOR_PLACEHOLDER_PATH = 'omitted-deferred-route';

export const INSPECTOR_STATIC_CORRIDOR_NAMESPACE = 'react-preview-inspector-static-corridor';

export const INSPECTOR_SHALLOW_CORRIDOR_NAMESPACE = 'react-preview-inspector-shallow-corridor';

export const INSPECTOR_VIRTUAL_PAGE_COMPONENT_NAMESPACE =
  'react-preview-inspector-virtual-page-component';

export const INSPECTOR_VIRTUAL_PAGE_COMPONENT_RUNTIME_NAMESPACE =
  'react-preview-inspector-virtual-page-component-runtime';

export const MAX_DYNAMIC_IMPORTER_SOURCE_BYTES = 1024 * 1024;

export const MAX_SMALL_DYNAMIC_IMPORTS = 24;

export const MAX_SMALL_STATIC_ROUTE_IMPORTS = 0;

export const MINIMUM_SELECTED_PACKAGE_BARREL_EXPORTS = 64;

export const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

export interface PreviewDynamicImporterEvidence {
  readonly hasCorridorTarget: boolean;
  readonly isBroadRegistry: boolean;
  readonly renderedNextDynamicSpecifiers: ReadonlySet<string>;
}

export interface PreviewInspectorCorridorPluginOptions {
  /** Immutable optional-component demands recorded by the frozen frontier. */
  readonly authenticComponentExports?: readonly PreviewInspectorFrontierComponentExports[];
  readonly frozenAuthenticSourcePaths?: readonly string[];
  /** Exact omitted authored edges already proven by the frozen frontier. */
  readonly projectedEdges?: readonly PreviewInspectorProjectedEdge[];
  readonly packageDemandSourcePaths?: readonly string[];
  readonly maximumSmallDynamicImports?: number;
  readonly maximumSmallStaticRouteImports?: number;
  readonly optimizeSelectedPackageBarrels?: boolean;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly projectRoot: string;
  readonly readSource?: (sourcePath: string) => string | undefined;
  readonly resolveModule: ResolvePreviewRenderGraphModule;
  readonly workspaceRoot: string;
}

export interface PreviewInspectorFrozenProjectedEdge {
  readonly projection: PreviewInspectorShallowProjection;
  readonly targetPath: string;
}
