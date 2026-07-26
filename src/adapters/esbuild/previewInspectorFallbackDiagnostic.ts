import type { PreviewBuildRequest, PreviewDiagnostic } from '../../domain/preview';

/** Produces the rate-limited full-workspace Inspector fallback warning. */
export function createPreviewInspectorFallbackDiagnostics(options: {
  readonly admit: (key: string) => boolean;
  readonly documentName: string;
  readonly hasInspectorPlan: boolean;
  readonly outputStrategyKey: string;
  readonly request: PreviewBuildRequest;
}): readonly PreviewDiagnostic[] {
  if (
    options.request.renderMode !== 'page-inspector' ||
    options.request.preparationMode === 'fast' ||
    options.request.preparationMode === 'corridor' ||
    options.hasInspectorPlan ||
    !options.admit(`inspector-fallback:${options.outputStrategyKey}`)
  )
    return [];
  return [
    {
      message: `Page Inspector could not prove an exported ancestor for ${options.documentName}. The direct export fallback remains interactive, but parent and sibling context is unavailable. Open a direct default/PascalCase component export or configure a preview harness if this file only re-exports unknown wildcard values.`,
      severity: 'warning',
    },
  ];
}
