/**
 * Public boundary for syntax-only parent JSX render-slice analysis.
 * Compiler plugins import this barrel instead of depending on parser implementation helpers.
 */
export {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
  type AnalyzePreviewLocalParentSlicesOptions,
  type AnalyzePreviewParentSlicesOptions,
  type MatchesPreviewParentSliceTargetImport,
  type PreviewParentSlice,
  type PreviewParentSliceAnalysis,
  type PreviewParentSliceOwner,
} from './previewParentSlice';
export {
  createPreviewParentSliceSource,
  type PreviewParentSliceChildMode,
  type PreviewParentSliceFrame,
  type PreviewParentSliceImportedFrame,
  type PreviewParentSliceImportReference,
  type PreviewParentSliceIntrinsicFrame,
  type PreviewParentSliceSourceOptions,
  type PreviewParentSliceStaticProps,
  type PreviewParentSliceStaticValue,
} from './previewParentSliceSource';
export {
  createPreviewParentSlicePlan,
  type CreatePreviewParentSlicePlanOptions,
  type PreviewParentSlicePlan,
  type PreviewParentSlicePlansByExport,
} from './previewParentSlicePlan';
export {
  climbPreviewParentSliceProject,
  type ClimbPreviewParentSliceProjectOptions,
  type ReadPreviewParentSliceSource,
} from './previewParentSliceProjectClimb';
