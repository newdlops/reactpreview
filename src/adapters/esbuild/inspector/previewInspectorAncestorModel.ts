/** Ancestor planning contracts and bounded candidate state. */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';
import {
  type MatchesPreviewParentSliceTargetImport,
  type PreviewParentSlice,
} from '../parentSlice';
import {
  type PreviewRenderChainPlan,
  type PreviewRenderChainPlansByExport,
  type ResolvePreviewRenderGraphModule,
  type AnalyzePreviewRenderSource,
  type CollectPreviewRenderModuleSpecifiers,
} from '../renderGraph';
import type { PreviewInferredExportProps } from '../staticResources/reactExportPropInference';
import type {
  PreviewInspectorAncestorPlan,
  PreviewInspectorAncestorStopReason,
  PreviewInspectorComponentReference,
  PreviewInspectorPageCandidate,
  ReadPreviewInspectorAcceptedSpecifiers,
  ReadPreviewInspectorSource,
} from './previewInspectorAncestorTypes';
import { type PreviewInspectorModuleFrontier } from './previewInspectorModuleFrontiers';
import {
  createPreviewInspectorNextPagesShellRefiner,
  type PreviewInspectorNextPagesShellRefiner,
} from './previewInspectorNextPagesParameterEvidence';
import { type PreviewInspectorSourcePromiseCache } from './previewInspectorRenderPathRoots';
import { type CollectPreviewInspectorRouteBranchPlanOptions } from './previewInspectorRouteBranchPlan';

export const MAX_CONCURRENT_SOURCE_READS = 64;

export interface CreatePreviewInspectorAncestorPlanOptions {
  /** Exact-source render facts supplied by the compiler's existing bounded file cache. */
  readonly analyzeSource?: AnalyzePreviewRenderSource;
  /** Exact-source literal import facts sharing that same file cache and invalidation policy. */
  readonly collectModuleSpecifiers?: CollectPreviewRenderModuleSpecifiers;
  readonly acceptedImportSpecifiers?: ReadPreviewInspectorAcceptedSpecifiers;
  readonly documentPath: string;
  readonly exportName: string;
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly renderChainsByExport?: PreviewRenderChainPlansByExport;
  readonly routeSelection?: readonly PreviewInspectorRouteSelectionStep[];
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly usageContext?: PreviewInspectorAncestorUsageContext;
}

export interface PreviewInspectorAncestorPrelude {
  readonly dependencyPaths: readonly string[];
  readonly renderChain: PreviewRenderChainPlan;
  readonly renderChainsByExport: PreviewRenderChainPlansByExport;
  readonly renderOutcomesByExport: NonNullable<
    PreviewInspectorAncestorPlan['renderOutcomesByExport']
  >;
  readonly sourcePaths: readonly string[];
  readonly target: PreviewInspectorComponentReference;
}

export interface PreviewInspectorAncestorCandidateTemplates {
  readonly candidates: readonly PreviewInspectorPageCandidate[];
}

export interface PreviewInspectorAncestorUsageContext {
  readonly getAncestorPrelude: (
    compute: () => Promise<PreviewInspectorAncestorPrelude>,
  ) => Promise<PreviewInspectorAncestorPrelude>;
  readonly getCandidateTemplates: (
    compute: () => Promise<PreviewInspectorAncestorCandidateTemplates>,
  ) => Promise<PreviewInspectorAncestorCandidateTemplates>;
  readonly selectionPrefixProvider?: CollectPreviewInspectorRouteBranchPlanOptions['selectionPrefixProvider'];
}

export interface SuccessfulOwnerPromotion {
  readonly exportNames: readonly string[];
  readonly kind: 'promoted';
  readonly localOwnerNames: readonly string[];
  readonly root: PreviewInspectorComponentReference;
}

export interface StoppedOwnerPromotion {
  readonly kind: 'stopped';
  readonly stopReason: Extract<
    PreviewInspectorAncestorStopReason,
    'non-component-owner' | 'private-owner'
  >;
}

export type OwnerPromotionResult = SuccessfulOwnerPromotion | StoppedOwnerPromotion;

export interface InspectorUsageCandidate {
  readonly frontier: PreviewInspectorModuleFrontier;
  readonly reexportPaths: readonly string[];
  readonly slice: PreviewParentSlice;
  readonly sourceText: string;
}

export interface InspectorCandidateSource {
  readonly sourcePath: string;
  readonly sourceText: string;
}

export interface InspectorUsagePlanningContext {
  readonly inferenceByReference: Map<string, Promise<PreviewInferredExportProps | undefined>>;
  readonly nextPagesShellRefiner: PreviewInspectorNextPagesShellRefiner;
  readonly routerOwnershipBySource: Map<string, Promise<boolean>>;
  readonly rankedCandidatesByFrontier: Map<
    string,
    Promise<readonly RankedInspectorUsageCandidate[]>
  >;
  readonly sourceFileByPath: Map<string, ts.SourceFile>;
  readonly sourceTextByPath: PreviewInspectorSourcePromiseCache;
  sources?: Promise<readonly InspectorCandidateSource[]>;
}

export interface RankedInspectorUsageCandidate {
  readonly candidate: InspectorUsageCandidate;
  readonly score: number;
}

/** Creates request-local caches for one bounded candidate-materialization pass. */
export function createInspectorUsagePlanningContext(
  options: CreatePreviewInspectorAncestorPlanOptions,
  sourcePaths: readonly string[],
): InspectorUsagePlanningContext {
  return {
    inferenceByReference: new Map(),
    nextPagesShellRefiner: createPreviewInspectorNextPagesShellRefiner({
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      sourcePaths,
    }),
    rankedCandidatesByFrontier: new Map(),
    routerOwnershipBySource: new Map(),
    sourceFileByPath: new Map(),
    sourceTextByPath: new Map(),
  };
}

/** Creates a normalized, immutable component reference. */
export function freezeReference(
  sourcePath: string,
  exportName: string,
): PreviewInspectorComponentReference {
  return Object.freeze({ exportName, sourcePath: path.normalize(sourcePath) });
}

/** Produces a cycle identity stable across path separator and alias spelling differences. */
export function createReferenceKey(reference: PreviewInspectorComponentReference): string {
  return `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
}
