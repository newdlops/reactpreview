/** Public contracts for statically inferred Page Inspector browser locations. */
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { PreviewInspectorFactoryRouteAvailability } from './previewInspectorRouteFactoryManifestTypes';

/** Static evidence retained with the inferred location for diagnostics and hot reload. */
export interface PreviewInspectorRouteLocation {
  readonly componentExportName?: string;
  readonly componentName: string;
  readonly componentSourcePath?: string;
  readonly componentSourcePaths?: readonly string[];
  readonly evidenceKind: 'route-catalog' | 'route-jsx';
  readonly dependencyPaths: readonly string[];
  readonly directRouteOwnerSourcePath?: string;
  readonly elementWrappers?: readonly PreviewInspectorRouteElementWrapperEvidence[];
  readonly pathname: string;
  readonly routeMounts?: readonly PreviewInspectorRouteMountEvidence[];
  readonly pattern: string;
  readonly sourcePath: string;
}

/** One immutable app-module mount used to localize a directly mounted route owner. */
export interface PreviewInspectorRouteMountEvidence {
  readonly basePath: string;
  readonly contextPattern?: string;
  readonly exportName: string;
  readonly hasWildcardFallback: boolean;
  readonly routeSlotCount: number;
  readonly sourcePath: string;
}

/** One exact outer-to-inner component wrapper authored in a selected route element. */
export interface PreviewInspectorRouteElementWrapperEvidence {
  readonly componentName: string;
  readonly exportName: string;
  readonly sourcePath: string;
}

/** One target route plus the concrete descendant pages owned by a selected route factory. */
export interface PreviewInspectorRouteLocationInventory {
  readonly primary?: PreviewInspectorRouteLocation;
  readonly choices: readonly PreviewInspectorRouteLocation[];
  readonly fallbackCount: number;
  readonly unresolvedFactoryRoutes: boolean;
  readonly unresolvedFactoryOptionNames?: readonly string[];
  readonly unresolvedFactoryOptions?: readonly {
    readonly availability: Exclude<PreviewInspectorFactoryRouteAvailability, 'selectable'>;
    readonly componentName: string;
    readonly kind: 'direct' | 'page' | 'submodule';
    readonly occurrenceIdentity?: string;
    readonly pattern?: string;
  }[];
  readonly directRouteDuplicates?: readonly {
    readonly componentExportName: string;
    readonly componentName: string;
    readonly componentSourcePath: string;
    readonly occurrenceIdentity: string;
    readonly pattern: string;
  }[];
}

/** Inputs kept independent from the ancestor planner so route inference is unit-testable. */
export interface CollectPreviewInspectorRouteLocationOptions {
  readonly documentPath: string;
  readonly exportName: string;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly renderChain: PreviewRenderChainPlan;
  readonly sourcePaths: readonly string[];
}
