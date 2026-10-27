/** Ranks source-proven target usages and owner names without executing modules. */
import path from 'node:path';
import { throwIfPreviewBuildCancelled } from '../../../domain/previewBuildExecution';
import {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
  type MatchesPreviewParentSliceTargetImport,
} from '../parentSlice';
import {
  collectPreviewRenderModuleSpecifiers,
  type ResolvePreviewRenderGraphModule,
} from '../renderGraph';
import {
  freezeReference,
  type InspectorCandidateSource,
  type InspectorUsageCandidate,
  type InspectorUsagePlanningContext,
  MAX_CONCURRENT_SOURCE_READS,
  type OwnerPromotionResult,
  type RankedInspectorUsageCandidate,
} from './previewInspectorAncestorModel';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import {
  collectPreviewInspectorModuleFrontiers,
  type PreviewInspectorModuleFrontier,
} from './previewInspectorModuleFrontiers';
import { isPreviewInspectorComponentShapedOwner } from './previewInspectorOwnerShape';
import { matchesPreviewInspectorRenderPathUsage } from './previewInspectorRenderPathUsage';

/** Selects the strongest page-like JSX usage across direct imports and bounded barrel chains. */
export async function findInspectorUsage(options: {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly preferredSourcePaths: ReadonlySet<string>;
  /** Exact authored use on the selected render path, checked against the analyzed candidate rows. */
  readonly preferredUsage?: { readonly consumerPath: string; readonly occurrenceStart: number };
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}): Promise<InspectorUsageCandidate | undefined> {
  const frontierKey = JSON.stringify([
    path.normalize(options.targetPath),
    [...options.targetExportNames].sort(),
    [...options.acceptedImportSpecifiers].sort(),
  ]);
  let rankedPromise = options.planningContext.rankedCandidatesByFrontier.get(frontierKey);
  if (rankedPromise === undefined) {
    rankedPromise = collectRankedInspectorUsageCandidates(options);
    options.planningContext.rankedCandidatesByFrontier.set(frontierKey, rankedPromise);
  }
  const candidates = await rankedPromise;
  const preferredUsage = options.preferredUsage;
  const exact =
    preferredUsage === undefined
      ? undefined
      : candidates.find(({ candidate }) =>
          matchesPreviewInspectorRenderPathUsage(candidate, preferredUsage),
        );
  if (exact !== undefined) return exact.candidate;
  const rankedCandidates = candidates.map((ranked) => ({
    candidate: ranked.candidate,
    score:
      ranked.score +
      (options.preferredSourcePaths.has(path.normalize(ranked.candidate.slice.consumerPath))
        ? 2_000
        : 0),
  }));
  rankedCandidates.sort(compareRankedInspectorUsageCandidates);
  return rankedCandidates[0]?.candidate;
}

/** Reads the bounded inventory once, then reuses it for every candidate path and owner frontier. */
export async function readInspectorCandidateSources(options: {
  readonly planningContext: InspectorUsagePlanningContext;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
}): Promise<readonly InspectorCandidateSource[]> {
  if (options.planningContext.sources !== undefined) {
    return options.planningContext.sources;
  }
  const sourcePromise = (async (): Promise<readonly InspectorCandidateSource[]> => {
    const sources: InspectorCandidateSource[] = [];
    for (
      let batchStart = 0;
      batchStart < options.sourcePaths.length;
      batchStart += MAX_CONCURRENT_SOURCE_READS
    ) {
      throwIfPreviewBuildCancelled(options.signal);
      const batchPaths = options.sourcePaths.slice(
        batchStart,
        batchStart + MAX_CONCURRENT_SOURCE_READS,
      );
      const batch = await Promise.all(
        batchPaths.map(async (sourcePath) => ({
          sourcePath,
          sourceText: await options.readSource(sourcePath),
        })),
      );
      throwIfPreviewBuildCancelled(options.signal);
      for (const source of batch) {
        if (
          source.sourceText === undefined ||
          (!source.sourceText.includes('import') && !source.sourceText.includes('export'))
        ) {
          continue;
        }
        sources.push({ sourcePath: source.sourcePath, sourceText: source.sourceText });
      }
    }
    return Object.freeze(sources);
  })();
  options.planningContext.sources = sourcePromise;
  return sourcePromise;
}

/** Computes path-independent usage scores once for a changing imported component frontier. */
export async function collectRankedInspectorUsageCandidates(options: {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly planningContext: InspectorUsagePlanningContext;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}): Promise<readonly RankedInspectorUsageCandidate[]> {
  const sources = await readInspectorCandidateSources(options);
  const candidates: InspectorUsageCandidate[] = [];
  const frontiers = collectPreviewInspectorModuleFrontiers(
    {
      acceptedImportSpecifiers: options.acceptedImportSpecifiers,
      ...(options.matchesTargetImport === undefined
        ? {}
        : { matchesTargetImport: options.matchesTargetImport }),
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      targetExportNames: options.targetExportNames,
      targetPath: options.targetPath,
    },
    sources,
    options.planningContext.sourceFileByPath,
  );
  const moduleSpecifiersBySource = new Map<string, readonly string[]>();
  for (const source of sources) {
    if (!source.sourceText.includes('<')) {
      continue;
    }
    for (const frontier of frontiers) {
      if (path.normalize(source.sourcePath) === path.normalize(frontier.sourcePath)) {
        /*
         * An exported file component can be consumed only by a sibling export in the same module:
         * `Modal <- ModalButton <- importing page`. Import-only reverse search cannot see the first
         * edge, so promote exact named JSX uses before continuing through ordinary external imports.
         * Local analysis accepts no module specifier and therefore cannot recurse through a barrel
         * or mistake a similarly named component from another source for this frontier.
         */
        for (const exportName of frontier.exportNames) {
          if (
            exportName === 'default' ||
            !/^[$_\p{ID_Start}][$\u200C\u200D\p{ID_Continue}]*$/u.test(exportName)
          ) {
            continue;
          }
          const localAnalysis = analyzePreviewLocalParentSlices({
            consumerPath: source.sourcePath,
            localComponentName: exportName,
            sourceText: source.sourceText,
          });
          for (const slice of localAnalysis.slices) {
            candidates.push({
              frontier,
              reexportPaths: frontier.dependencyPaths,
              slice,
              sourceText: source.sourceText,
            });
          }
        }
        continue;
      }
      let moduleSpecifiers = moduleSpecifiersBySource.get(source.sourcePath);
      if (moduleSpecifiers === undefined) {
        moduleSpecifiers = collectPreviewRenderModuleSpecifiers(
          source.sourcePath,
          source.sourceText,
        );
        moduleSpecifiersBySource.set(source.sourcePath, moduleSpecifiers);
      }
      if (!mayContainInspectorUsage(options, source, frontier, moduleSpecifiers)) {
        continue;
      }
      const initialFrontier =
        path.normalize(frontier.sourcePath) === path.normalize(options.targetPath);
      const analysis = analyzePreviewParentSlices({
        ...(initialFrontier
          ? { acceptedTargetImportSpecifiers: options.acceptedImportSpecifiers }
          : {}),
        consumerPath: source.sourcePath,
        ...(options.matchesTargetImport === undefined
          ? {}
          : { matchesTargetImport: options.matchesTargetImport }),
        sourceText: source.sourceText,
        targetExportNames: frontier.exportNames,
        targetPath: frontier.sourcePath,
      });
      for (const slice of analysis.slices) {
        candidates.push({
          frontier,
          reexportPaths: frontier.dependencyPaths,
          slice,
          sourceText: source.sourceText,
        });
      }
    }
  }
  const rankedCandidates = candidates.map((candidate) => ({
    candidate,
    score: scoreInspectorUsageCandidate(candidate),
  }));
  rankedCandidates.sort(compareRankedInspectorUsageCandidates);
  return Object.freeze(rankedCandidates);
}

/** Proves a plausible import before allocating a TypeScript AST. */
export function mayContainInspectorUsage(
  options: Parameters<typeof collectRankedInspectorUsageCandidates>[0],
  source: InspectorCandidateSource,
  frontier: PreviewInspectorModuleFrontier,
  moduleSpecifiers: readonly string[],
): boolean {
  const basename = path.basename(frontier.sourcePath).replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
  const directoryName = path.basename(path.dirname(frontier.sourcePath));
  if (
    (basename.length > 1 && source.sourceText.includes(basename)) ||
    (basename === 'index' &&
      directoryName.length > 1 &&
      source.sourceText.includes(directoryName)) ||
    frontier.exportNames.some(
      (exportName) => exportName !== 'default' && source.sourceText.includes(exportName),
    ) ||
    options.acceptedImportSpecifiers.some((specifier) => source.sourceText.includes(specifier))
  ) {
    return true;
  }
  return moduleSpecifiers.some((specifier) => {
    const resolvedPath = options.resolveModule?.(specifier, source.sourcePath);
    return (
      (resolvedPath !== undefined &&
        path.normalize(resolvedPath) === path.normalize(frontier.sourcePath)) ||
      (options.resolveModule === undefined &&
        options.matchesTargetImport?.(specifier, source.sourcePath, frontier.sourcePath) === true)
    );
  });
}

/** Climbs private same-module component usages to an importable owner export. */
export function promoteInspectorOwner(candidate: InspectorUsageCandidate): OwnerPromotionResult {
  const visitedLocalOwners = new Set<string>();
  const localOwnerNames: string[] = [];
  let currentSlice = candidate.slice;
  for (;;) {
    const owner = currentSlice.owner;
    if (owner === null) {
      return { kind: 'stopped', stopReason: 'private-owner' };
    }
    if (owner.exportNames.length > 0) {
      if (
        !isPreviewInspectorComponentShapedOwner({
          occurrenceStart: currentSlice.occurrenceStart,
          owner,
          sourcePath: currentSlice.consumerPath,
          sourceText: candidate.sourceText,
        })
      ) {
        return { kind: 'stopped', stopReason: 'non-component-owner' };
      }
      const exportName = selectPreferredExportName(owner.exportNames);
      return {
        exportNames: Object.freeze([...owner.exportNames]),
        kind: 'promoted',
        localOwnerNames: Object.freeze(localOwnerNames),
        root: freezeReference(currentSlice.consumerPath, exportName),
      };
    }
    if (owner.localName === null || visitedLocalOwners.has(owner.localName)) {
      return { kind: 'stopped', stopReason: 'private-owner' };
    }

    visitedLocalOwners.add(owner.localName);
    localOwnerNames.push(owner.localName);
    const localAnalysis = analyzePreviewLocalParentSlices({
      consumerPath: currentSlice.consumerPath,
      localComponentName: owner.localName,
      sourceText: candidate.sourceText,
    });
    const nextSlice = localAnalysis.slices[0];
    if (nextSlice === undefined) {
      return { kind: 'stopped', stopReason: 'private-owner' };
    }
    currentSlice = nextSlice;
  }
}

/** Orders candidates by mountability and application conventions before path order. */
export function compareRankedInspectorUsageCandidates(
  left: { readonly candidate: InspectorUsageCandidate; readonly score: number },
  right: { readonly candidate: InspectorUsageCandidate; readonly score: number },
): number {
  const scoreDifference = right.score - left.score;
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  const leftPath = left.candidate.slice.consumerPath;
  const rightPath = right.candidate.slice.consumerPath;
  const pathDifference = leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  return pathDifference !== 0
    ? pathDifference
    : left.candidate.slice.occurrenceStart - right.candidate.slice.occurrenceStart;
}

/** Assigns one bounded deterministic score without importing or evaluating candidate modules. */
export function scoreInspectorUsageCandidate(candidate: InspectorUsageCandidate): number {
  const promotion = candidate.slice.owner === null ? undefined : promoteInspectorOwner(candidate);
  const mountabilityScore =
    candidate.slice.owner === null
      ? 800
      : promotion?.kind === 'promoted'
        ? 1_000 + Math.min(promotion.localOwnerNames.length, 12) * 3
        : 0;
  return (
    mountabilityScore +
    scoreInspectorSourcePath(candidate.slice.consumerPath) +
    scoreInspectorOwnerName(promotion)
  );
}

/** Applies framework-neutral filename conventions and strongly demotes non-application sources. */
export function scoreInspectorSourcePath(sourcePath: string): number {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  const fileName = path.basename(normalizedPath).replace(/\.[^.]+$/u, '');
  let score = 0;

  if (
    /(?:^|\/)(?:__tests__|tests?|specs?)(?:\/|$)/u.test(normalizedPath) ||
    /(?:\.test|\.spec)$/u.test(fileName)
  ) {
    score -= 500;
  }
  if (
    /(?:^|\/)(?:stories|storybook)(?:\/|$)/u.test(normalizedPath) ||
    /\.stories?$/u.test(fileName)
  ) {
    score -= 420;
  }
  if (
    /(?:^|\/)(?:__templates__|examples?|demos?|fixtures?|generators?|mocks?|playgrounds?|scaffolds?|templates?)(?:\/|$)/u.test(
      normalizedPath,
    )
  ) {
    score -= 260;
  }

  if (/(?:^|\/)(?:pages?|layouts?|routes?|screens?|views?)(?:\/|$)/u.test(normalizedPath)) {
    score += 150;
  }
  if (/(?:page|layout|route|screen|view)$/u.test(fileName)) {
    score += 90;
  }
  if (/^(?:app|bootstrap|entry|main|root)$/u.test(fileName)) {
    score += 130;
  }
  return score;
}

/** Gives conventional page-root export names a small tie-break advantage over generic wrappers. */
export function scoreInspectorOwnerName(promotion: OwnerPromotionResult | undefined): number {
  if (promotion?.kind !== 'promoted') {
    return 0;
  }
  const exportName = promotion.root.exportName;
  if (/^(?:App|Root)$/u.test(exportName)) {
    return 80;
  }
  if (/(?:Page|Layout|Route|Screen|View)$/u.test(exportName)) {
    return 60;
  }
  return exportName === 'default' ? 20 : 0;
}

/** Prefers a conventional default export while retaining deterministic named-export fallback. */
export function selectPreferredExportName(exportNames: readonly string[]): string {
  return exportNames.includes('default') ? 'default' : (exportNames[0] ?? 'default');
}
