/** Public and compiler-only contracts produced by inert direct route collection. */
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type {
  PreviewInspectorDirectRoutePathComponentReference,
  PreviewInspectorDirectRoutePathEvidence,
} from './previewInspectorDirectRoutePathEvidence';
import type { PreviewInspectorRouteBasePathReference } from './previewInspectorRoutePathMetadata';

/** Resolved source identity for a component rendered by one direct route. */
export type PreviewInspectorDirectRouteComponentReference =
  PreviewInspectorDirectRoutePathComponentReference;

/** One component in an inline route element, including its optional exact source identity. */
export interface PreviewInspectorDirectRouteElementComponent {
  readonly componentName: string;
  readonly reference?: PreviewInspectorDirectRouteComponentReference;
}

/** One path/component pair offered by standard React Router syntax. */
export interface PreviewInspectorDirectRouteChoice {
  readonly componentName: string;
  readonly elementPath?: readonly PreviewInspectorDirectRouteElementComponent[];
  readonly reference?: PreviewInspectorDirectRouteComponentReference;
  readonly occurrenceIdentity: string;
  readonly occurrenceStart: number;
  readonly pattern: string;
  readonly pathEvidence: PreviewInspectorDirectRoutePathEvidence;
  readonly pathResolution: 'resolved' | 'unresolved';
  readonly routeBasePath?: PreviewInspectorRouteBasePathReference;
  readonly sourcePath: string;
}

/** Standard route choices plus router configuration files needed for hot reload. */
export interface PreviewInspectorDirectRouteChoiceInventory {
  readonly choices: readonly PreviewInspectorDirectRouteChoice[];
  readonly dependencyPaths: readonly string[];
}

/** Capabilities supplied by the existing package-bounded Inspector planner. */
export interface CollectPreviewInspectorDirectRouteChoicesOptions {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
  readonly sourceText: string | undefined;
}

/** Inputs for one already-read source pass without following RouterProvider configuration imports. */
export interface CollectPreviewInspectorDirectRouteChoicesFromSourceOptions {
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly sourcePath: string;
  readonly sourceText: string;
}
