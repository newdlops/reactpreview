/** Explicit prepared inputs and session-owned service contracts for native build phases. */
import { type PreviewBuildRequest } from '../../domain/preview';
import { type PreviewBuildExecutionContext } from '../../domain/previewBuildExecution';
import type { PreviewCompilerGraphSummary } from '../../domain/previewCompilerActivity';
import type { PreviewDependencyProfile } from '../node/previewDependencyProfile';
import { type PreviewManagedDependencyEnvironment } from '../node/previewManagedDependencyStore';
import { type PreviewGlobalPackageBridgePlan } from './globalPackageBridge';
import type { PreviewGlobalPackageBridgeEvidencePolicy } from './globalPackageBridge/previewGlobalPackageBridgeEvidence';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorExecutionRootModuleContract,
  PreviewInspectorPageExecutionCandidate,
  PreviewInspectorTargetModuleContract,
} from './inspector';
import type { PreparedPreviewInspectorBundleExecution } from './preparePreviewInspectorBundleExecution';
import type { PreparedPreviewStyleContext } from './preparePreviewStyleContext';
import { PreviewAdapterStrategyLearner } from './previewAdapterStrategyLearner';
import { PreviewAdaptiveBuildPlanCache } from './previewAdaptiveBuildPlanCache';
import type { PreviewAdaptiveBuildSeed } from './previewAdaptiveBuildSeed';
import type { PreviewApplicationStylesheetImportSelection } from './previewApplicationStylesheetSelection';
import { type PreviewCompilerBuildExecution } from './previewCompilerBundleFinalizer';
import { type PreviewRouterBuildSelection } from './previewCompilerDefaults';
import { type PreviewDependencyResolutionNeuralScore } from './previewDependencyResolutionNeuralModel';
import type { PreviewDocumentShellEvidence } from './previewDocumentShell';
import type { PreviewDragDropRequirement } from './previewDragDropRequirement';
import type { PreviewGlobalStyleImportSelection } from './previewGlobalStyleSelection';
import type { PreviewCompilerTargetSelection } from './previewImperativeEntryTarget';
import { PreviewIncrementalBuildCache } from './previewIncrementalBuildCache';
import { type PreviewDependencyResolutionHintPlan } from './previewMissingDependencyRequirements';
import type { PreviewNextI18nConfig } from './previewNextConfigI18n';
import type { PreviewNextRuntimeEvidence } from './previewNextRuntimeEvidence';
import type { PreviewPreparationPolicy } from './previewPreparationPolicy';
import type { PreviewVirtualTypeModule } from './previewPrismaClientTypes';
import { PreviewProjectUsageCache } from './previewProjectUsageCache';
import type { PreviewReactDomRootKind } from './previewReactDomRootRuntimeSource';
import type { PreviewReduxAutomaticStateParts } from './previewReduxAutomaticState';
import type { NormalizedPreviewResolutionConfinement } from './previewResolutionConfinement';
import type { PreviewRouterRequirement } from './previewRouterRequirement';
import type { PreviewRuntimeWatchInputs } from './previewRuntimeEnvironment';
import { type PreviewRuntimeEnvironment } from './previewRuntimeEnvironment';
import { PreviewSetupFallbackBoundary } from './previewSetupFallbackBoundary';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';
import type { PreviewTargetExportSlot, PreviewThemeImportSelection } from './previewTargetExports';
import type { PreviewTargetUsageProps } from './previewTargetUsageProps';
import { PreviewSourceTransformer } from './staticResources/previewSourceTransformer';
import type { PreviewInferredExportProps } from './staticResources/reactExportPropInference';
import { PreviewTypeOracle } from './typeOracle/previewTypeOracle';
/** Inputs prepared before a single native graph build; mutable pass state is shared by reference. */
export interface PreviewCompilerBuildInputs {
  /** Prepared stylesheet engines, theme evidence, and style dependency contracts. */
  readonly styleContext: PreparedPreviewStyleContext;
  /** Captured target, editor snapshots, workspace, and user options for this build revision. */
  readonly request: PreviewBuildRequest;
  /** Authored parent JSX prop evidence retained for the selected target. */
  readonly targetUsageProps: PreviewTargetUsageProps;
  /** Selected authored ancestry plan, absent outside Inspector context preparation. */
  readonly activeInspectorPlan: PreviewInspectorAncestorPlan | undefined;
  /** Declared NextAuth type augmentation files retained as build dependencies. */
  readonly nextAuthAugmentationPaths: readonly string[];
  /** Optional compiler-owned Prisma type module used without executing project tooling. */
  readonly prismaClientTypes: PreviewVirtualTypeModule | undefined;
  /** Admitted installed dependency roots and their managed-store evidence. */
  readonly managedDependencyEnvironment: PreviewManagedDependencyEnvironment;
  /** Current editor source snapshots keyed by normalized source path. */
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
  /** Current bounded dependency recovery hints, when a prior pass supplied them. */
  readonly activeDependencyResolutionHints: PreviewDependencyResolutionHintPlan | undefined;
  /** Nearest project package boundary used for runtime and package resolution. */
  readonly projectRoot: string;
  /** Optional verified dependency profile used by the managed environment. */
  readonly dependencyProfile: PreviewDependencyProfile | undefined;
  /** Exact authored source paths that the selected execution must retain. */
  readonly criticalSurfaceSourcePaths: readonly string[];
  /** Preparation budgets and admission choices frozen for this build phase. */
  readonly policy: PreviewPreparationPolicy;
  /** Optional selected-route-leaf ownership mode; omission retains the active target. */
  readonly runtimeTargetMode: 'selected-route-leaf' | undefined;
  /** Exact source and export that owns the runtime target boundary. */
  readonly runtimeOwnershipTarget:
    | {
        /** Export name identifying this exact authored runtime role. */
        readonly exportName: string;
        /** Authored source path that identifies this exact runtime role. */
        readonly sourcePath: string;
      }
    | undefined;
  /** Selected admitted execution candidate, when route or page execution is available. */
  readonly activePageExecutionCandidate: PreviewInspectorPageExecutionCandidate | undefined;
  /** Build-scoped static resolver; resolution never executes project configuration. */
  readonly staticModuleResolver: PreviewStaticModuleResolver;
  /** Prepared contract for the directly selected local target module. */
  readonly localTargetModuleContract: PreviewInspectorTargetModuleContract | undefined;
  /** Neutral prop evidence for the exact exports used as runtime targets. */
  readonly runtimeTargetInferredPropsByExport: Readonly<Record<string, PreviewInferredExportProps>>;
  /** Target exports whose proven local effect controllers require instrumentation. */
  readonly effectControllerTargetExportNames: string[];
  /** Target exports whose relevant effects are confined to navigation behavior. */
  readonly navigationOnlyTargetExportNames: string[];
  /** Bounded static Next.js runtime evidence discovered during preparation. */
  readonly nextEvidence: PreviewNextRuntimeEvidence;
  /** Canonical workspace root used by confinement and native build metadata. */
  readonly canonicalWorkspaceRoot: string;
  /** Prepared target export selection and source transformation callbacks. */
  readonly targetSelection: PreviewCompilerTargetSelection;
  /** Optional static document-shell evidence admitted for browser initialization. */
  readonly documentShellEvidence: PreviewDocumentShellEvidence | undefined;
  /** Target-scoped signing secret delivered only to the local Inspector runtime. */
  readonly inspectorSourceGestureSecret: string | undefined;
  /** ReactDOM mount API selected from the admitted runtime capability profile. */
  readonly reactDomRootKind: PreviewReactDomRootKind;
  /** Mutable pass outputs shared by reference so adaptive passes retain closure updates. */
  readonly buildState: {
    /** Free CommonJS globals proved necessary by the current build pass. */
    legacyCommonJsGlobalNames: readonly string[];
    /** Authored portal container identifiers discovered for local browser initialization. */
    portalHostIds: readonly string[];
    /** Current setup-free fallback boundary after an admitted automatic Storybook failure. */
    activeStorybookFallbackBoundary: PreviewSetupFallbackBoundary | undefined;
  };
  /** Scores of recovery hints actually used by this build sequence. */
  readonly appliedDependencyHintScores: Set<PreviewDependencyResolutionNeuralScore>;
  /** Prepared exact-target module contract supplied to the Inspector facade. */
  readonly targetModuleContract: PreviewInspectorTargetModuleContract | undefined;
  /** Final admitted frontier and selected candidate immediately preceding native bundling. */
  readonly preparedBundleExecution: PreparedPreviewInspectorBundleExecution | undefined;
  /** Static drag-and-drop provider requirement found before native bundling. */
  readonly initialDragDropRequirement: PreviewDragDropRequirement | undefined;
  /** Generated Redux container and selector evidence admitted for local preview execution. */
  readonly automaticRedux: PreviewReduxAutomaticStateParts | undefined;
  /** Static Pages Router locale configuration when the selected application declares it. */
  readonly nextPagesI18n: PreviewNextI18nConfig | undefined;
  /** Conventional application stylesheet imports admitted independently of root execution. */
  readonly applicationStylesheetImports: readonly PreviewApplicationStylesheetImportSelection[];
  /** Selected runtime-capable exports used to generate the preview entry. */
  readonly targetExports: readonly PreviewTargetExportSlot[];
  /** Present only when bounded context discovery reached its admission limit. */
  readonly contextDiscoveryTruncated: true | undefined;
  /** Selected source export used for Inspector ownership and prop correlation. */
  readonly inspectorExportName: string | undefined;
  /** Admitted authored theme import, when static evidence proves one. */
  readonly selectedThemeImport: PreviewThemeImportSelection | undefined;
  /** Neutral inferred prop contracts keyed by the selected module’s export names. */
  readonly inferredPropsByExport: Readonly<Record<string, PreviewInferredExportProps>>;
  /** Admitted global style modules retained by the generated preview entry. */
  readonly globalStyleImports: readonly PreviewGlobalStyleImportSelection[];
  /** Prepared module contract for the exact component mounted as the execution root. */
  readonly executionRootModuleContract: PreviewInspectorExecutionRootModuleContract | undefined;
  /** Bounded executable page candidates supplied to the Inspector root facade. */
  readonly pageExecutionCandidates: readonly PreviewInspectorPageExecutionCandidate[];
  /** Tailwind compiler package required by the selected stylesheet pipeline, when any. */
  readonly requiredTailwindCompilerPackage: string | undefined;
  /** Normalized source, dependency, and namespace confinement for this native invocation. */
  readonly resolutionConfinement: NormalizedPreviewResolutionConfinement | undefined;
  /** Converts native metadata source names to the compiler’s stable workspace-relative identity. */
  readonly normalizePreviewMetafileSourceIdentity: (
    sourcefile: string,
    workingDirectory: string,
  ) => string;
  /** Optional revision-scoped progress, cancellation, and diagnostic observers. */
  readonly context: PreviewBuildExecutionContext | undefined;
  /** Source-free graph admission counters reported for this prepared build. */
  readonly compilerGraphSummary: PreviewCompilerGraphSummary;
  /** Cancellation signal shared by preparation, native work, and adaptive retries. */
  readonly buildSignal: AbortSignal;
  /** Physical and future configuration paths whose edits invalidate this runtime environment. */
  readonly runtimeWatchInputs: PreviewRuntimeWatchInputs;
}

/** Session-owned services used by this phase; ownership and shutdown remain with the compiler. */
export interface PreviewCompilerBuildInputsServices {
  /** Borrowed typed-declaration oracle; the owning compiler retains shutdown responsibility. */
  readonly typeOracle: PreviewTypeOracle;
  /** Borrowed authored-source analysis cache shared across compatible revisions. */
  readonly projectUsageCache: PreviewProjectUsageCache;
  /** Optional compiler-owned strategy learner receiving only observed build outcomes. */
  readonly adapterStrategyLearner: PreviewAdapterStrategyLearner | undefined;
  /** Compiler-owned native context cache reused only for compatible build identities. */
  readonly incrementalBuildCache: PreviewIncrementalBuildCache;
}

/** Inputs prepared before a bounded adaptive build sequence; mutable pass state is shared by reference. */
export interface PreviewCompilerAdaptiveInputs {
  /** Exact native phase invocation forwarded by the compiler’s adaptive coordinator. */
  readonly runBuild: PreviewCompilerBuildRun;
  /** Current bounded dependency recovery hints, when a prior pass supplied them. */
  readonly activeDependencyResolutionHints: PreviewDependencyResolutionHintPlan | undefined;
  /** Captured target, editor snapshots, workspace, and user options for this build revision. */
  readonly request: PreviewBuildRequest;
  /** Admitted installed dependency roots and their managed-store evidence. */
  readonly managedDependencyEnvironment: PreviewManagedDependencyEnvironment;
  /** Nearest project package boundary used for runtime and package resolution. */
  readonly projectRoot: string;
  /** Canonical workspace root used by confinement and native build metadata. */
  readonly canonicalWorkspaceRoot: string;
  /** Mutable pass outputs shared by reference so adaptive passes retain closure updates. */
  readonly buildState: {
    /** Free CommonJS globals proved necessary by the current build pass. */
    legacyCommonJsGlobalNames: readonly string[];
    /** Authored portal container identifiers discovered for local browser initialization. */
    portalHostIds: readonly string[];
    /** Current setup-free fallback boundary after an admitted automatic Storybook failure. */
    activeStorybookFallbackBoundary: PreviewSetupFallbackBoundary | undefined;
  };
  /** Prepared stylesheet engines, theme evidence, and style dependency contracts. */
  readonly styleContext: PreparedPreviewStyleContext;
  /** Static evidence limits controlling which implicit package globals may be bridged. */
  readonly globalBridgeEvidencePolicy: PreviewGlobalPackageBridgeEvidencePolicy;
  /** Prepared bounded recovery seed used to select native build strategies. */
  readonly adaptiveBuildSeed: PreviewAdaptiveBuildSeed;
  /** Statically proven router requirement before selecting an adaptive runtime strategy. */
  readonly routerNeed: PreviewRouterRequirement;
  /** Derives a setup-free fallback boundary only for the supplied prepared environment. */
  readonly createStorybookFallbackBoundary: (
    environment: PreviewRuntimeEnvironment,
  ) => PreviewSetupFallbackBoundary | undefined;
  /** Cancellation signal shared by preparation, native work, and adaptive retries. */
  readonly buildSignal: AbortSignal;
}

/** Session-owned services used by this phase; ownership and shutdown remain with the compiler. */
export interface PreviewCompilerAdaptiveInputsServices {
  /** Compiler-owned cache of bounded recovery plans for compatible target graphs. */
  readonly adaptiveBuildPlanCache: PreviewAdaptiveBuildPlanCache;
  /** Borrowed authored-source analysis cache shared across compatible revisions. */
  readonly projectUsageCache: PreviewProjectUsageCache;
}

/** Inert evidence prepared before exact target-role contracts are constructed. */
export interface PreviewCompilerTargetContractInputs {
  /** Selected authored ancestry plan, absent outside Inspector context preparation. */
  readonly activeInspectorPlan:
    import('./inspector/previewInspectorAncestorTypes').PreviewInspectorAncestorPlan | undefined;
  /** Authored parent JSX prop evidence retained for the selected target. */
  readonly targetUsageProps: import('./previewTargetUsageProps').PreviewTargetUsageProps;
  /** Captured target, editor snapshots, workspace, and user options for this build revision. */
  readonly request: import('../../domain/preview').PreviewBuildRequest;
  /** Optional exact route execution plan prepared before target-role contracts. */
  readonly plannedRouteExecution:
    | import('./preparePreviewRouteExecutionPlanner').PreparedPreviewRouteExecutionPlanner
    | undefined;
  /** Selected admitted execution candidate, when route or page execution is available. */
  readonly activePageExecutionCandidate:
    | import('./inspector/previewInspectorPageExecutionTypes').PreviewInspectorPageExecutionCandidate
    | undefined;
  /** Current editor source snapshots keyed by normalized source path. */
  readonly snapshotSourceByPath: ReadonlyMap<string, string>;
  /** Cancellation signal shared by preparation, native work, and adaptive retries. */
  readonly buildSignal: AbortSignal;
  /** Prepared target export selection and source transformation callbacks. */
  readonly targetSelection: import('./previewImperativeEntryTarget').PreviewCompilerTargetSelection;
  /** Selected source export used for Inspector ownership and prop correlation. */
  readonly inspectorExportName: string | undefined;
  /** Neutral inferred prop contracts keyed by the selected module’s export names. */
  readonly inferredPropsByExport: Readonly<
    Record<string, import('./staticResources/reactPropInferenceModel').PreviewInferredExportProps>
  >;
  /** Collects compile-scoped neutral prop evidence from an exact source snapshot. */
  readonly collectTargetInferredProps: (
    sourcePath: string,
    sourceText: string,
  ) => Readonly<
    Record<string, import('./staticResources/reactPropInferenceModel').PreviewInferredExportProps>
  >;
  /** Static evidence limits controlling which implicit package globals may be bridged. */
  readonly globalBridgeEvidencePolicy: import('./globalPackageBridge/previewGlobalPackageBridgeEvidence').PreviewGlobalPackageBridgeEvidencePolicy;
  /** Admitted installed dependency roots and their managed-store evidence. */
  readonly managedDependencyEnvironment: import('../node/previewManagedDependencyStore').PreviewManagedDependencyEnvironment;
  /** Nearest project package boundary used for runtime and package resolution. */
  readonly projectRoot: string;
  /** Final admitted frontier and selected candidate immediately preceding native bundling. */
  readonly preparedBundleExecution:
    | import('./preparePreviewInspectorBundleExecution').PreparedPreviewInspectorBundleExecution
    | undefined;
  /** Physical authored dependencies retained by the current Inspector plan. */
  readonly activeInspectorDependencyPaths: readonly string[];
  /** Static resolver used for source analysis before native build resolution. */
  readonly analysisStaticModuleResolver: import('./previewStaticModuleResolver').PreviewStaticModuleResolver;
  /** Canonical workspace root used by confinement and native build metadata. */
  readonly canonicalWorkspaceRoot: string;
}
/** Borrowed source cache; its owner retains cancellation and shutdown responsibility. */
export interface PreviewCompilerTargetContractServices {
  /** Borrowed authored-source analysis cache shared across compatible revisions. */
  readonly projectUsageCache: import('./previewProjectUsageCache').PreviewProjectUsageCache;
}
/** Exact runtime, selected-target, and execution-root contracts shared by every native build pass. */
export interface PreviewCompilerTargetContracts {
  /** Optional selected-route-leaf ownership mode; omission retains the active target. */
  readonly runtimeTargetMode: 'selected-route-leaf' | undefined;
  /** Exact source and export that owns the runtime target boundary. */
  readonly runtimeOwnershipTarget:
    | import('./inspector/previewInspectorAncestorTypes').PreviewInspectorComponentReference
    | undefined;
  /** Prepared contract for the directly selected local target module. */
  readonly localTargetModuleContract:
    | import('./inspector/previewInspectorTargetModuleContract').PreviewInspectorTargetModuleContract
    | undefined;
  /** Neutral prop evidence for the exact exports used as runtime targets. */
  readonly runtimeTargetInferredPropsByExport: Readonly<
    Record<string, import('./staticResources/reactPropInferenceModel').PreviewInferredExportProps>
  >;
  /** Target exports whose proven local effect controllers require instrumentation. */
  readonly effectControllerTargetExportNames: string[];
  /** Target exports whose relevant effects are confined to navigation behavior. */
  readonly navigationOnlyTargetExportNames: string[];
  /** Prepared exact-target module contract supplied to the Inspector facade. */
  readonly targetModuleContract:
    | import('./inspector/previewInspectorTargetModuleContract').PreviewInspectorTargetModuleContract
    | undefined;
  /** Static drag-and-drop provider requirement found before native bundling. */
  readonly initialDragDropRequirement:
    import('./previewDragDropRequirement').PreviewDragDropRequirement | undefined;
  /** Prepared module contract for the exact component mounted as the execution root. */
  readonly executionRootModuleContract:
    | import('./inspector/previewInspectorExecutionRootModuleContract').PreviewInspectorExecutionRootModuleContract
    | undefined;
  /** Prepared bounded recovery seed used to select native build strategies. */
  readonly adaptiveBuildSeed: import('./previewAdaptiveBuildSeed').PreviewAdaptiveBuildSeed;
}

/** Exact native build invocation forwarded by the compiler and its adaptive coordinator. */
export type PreviewCompilerBuildRun = (
  environment: PreviewRuntimeEnvironment,
  routerSelection: PreviewRouterBuildSelection,
  globalPackagePlan: PreviewGlobalPackageBridgePlan,
  adaptivePass: 1 | 2,
  fallbackBoundary?: PreviewSetupFallbackBoundary,
) => Promise<
  PreviewCompilerBuildExecution & {
    /** Free global names observed in the completed native source transformation. */
    readonly referencedGlobalNames: readonly string[];
    /** Router demand discovered by the source transformer during the completed pass. */
    readonly routerRequirement: ReturnType<PreviewSourceTransformer['getRouterRequirement']>;
  }
>;
