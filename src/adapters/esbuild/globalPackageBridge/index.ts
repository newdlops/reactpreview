/** Public API for statically discovered, package-backed implicit global compatibility. */
export { PREVIEW_GLOBAL_PACKAGE_BRIDGE_NAMESPACE } from '../previewPluginProtocol';
export {
  discoverPreviewGlobalPackageBridges,
  type PreviewGlobalPackageBridgeDiscoveryOptions,
} from './previewGlobalPackageBridgeDiscovery';
export {
  createPreviewGlobalPackageBridgeEvidencePolicy,
  createPreviewGlobalPackageBridgeHintsFromEvidence,
  type PreviewGlobalPackageBridgeEvidencePolicy,
} from './previewGlobalPackageBridgeEvidence';
export {
  createPreviewGlobalPackageBridgePlugin,
  type PreviewGlobalPackageBridgePluginOptions,
} from './previewGlobalPackageBridgePlugin';
export { createPreviewGlobalPackageBridgeSource } from './previewGlobalPackageBridgeSource';
export {
  createPreviewGlobalPackageBridgePlan,
  type PreviewGlobalPackageBridgePlanOptions,
} from './previewGlobalPackageBridgePlan';
export type {
  PreviewGlobalPackageBridge,
  PreviewGlobalPackageBridgeCandidate,
  PreviewGlobalPackageBridgeHint,
  PreviewGlobalPackageBridgeInventoryItem,
  PreviewGlobalPackageBridgePlan,
  PreviewGlobalPackageEvidence,
  PreviewGlobalPackageExportKind,
} from './previewGlobalPackageBridge';
