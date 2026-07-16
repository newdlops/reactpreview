/** Public build-time boundary for the opt-in Page Inspector ancestor and target facade modules. */
export {
  createPreviewInspectorAncestorPlan,
  type CreatePreviewInspectorAncestorPlanOptions,
  type PreviewInspectorAncestorEdge,
  type PreviewInspectorAncestorPlan,
  type PreviewInspectorAncestorStopReason,
  type PreviewInspectorComponentReference,
  type ReadPreviewInspectorAcceptedSpecifiers,
  type ReadPreviewInspectorSource,
} from './previewInspectorAncestorPlan';
export {
  createPreviewInspectorRootPlugin,
  createPreviewInspectorRootSource,
  type PreviewInspectorRootPluginOptions,
  type PreviewInspectorRootSourceOptions,
} from './previewInspectorRootPlugin';
export {
  createPreviewInspectorTargetFacadeSource,
  createPreviewInspectorTargetPlugin,
  PREVIEW_INSPECTOR_RUNTIME_SPECIFIER,
  PREVIEW_INSPECTOR_TARGET_FACADE_SPECIFIER,
  type PreviewInspectorTargetFacadeSourceOptions,
  type PreviewInspectorTargetMetadata,
  type PreviewInspectorTargetPluginOptions,
} from './previewInspectorTargetPlugin';
