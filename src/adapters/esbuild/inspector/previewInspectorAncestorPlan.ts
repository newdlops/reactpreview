/**
 * Discovers an importable ancestor component for the opt-in Page Inspector preview mode.
 * Unlike a pinpoint parent slice, this plan intentionally mounts an authored owner export so its
 * real descendants, siblings, hooks, and event-driven UI are present in the browser React tree.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
  type MatchesPreviewParentSliceTargetImport,
  type PreviewParentSlice,
  type PreviewParentSliceStaticProps,
} from '../parentSlice';
import { matchesPreviewParentSliceTargetImport } from '../parentSlice/previewParentSliceImports';
import { isPreviewInspectorComponentShapedOwner } from './previewInspectorOwnerShape';

const MAX_PROJECT_ANCESTOR_DEPTH = 8;
const MAX_LOCAL_OWNER_DEPTH = 12;
const MAX_CONCURRENT_SOURCE_READS = 16;
const MAX_REEXPORT_DEPTH = 8;

/** Importable component identity retained without loading its module in the extension host. */
export interface PreviewInspectorComponentReference {
  /** Runtime export name, including the string `default`. */
  readonly exportName: string;
  /** Absolute authored source path containing the export. */
  readonly sourcePath: string;
}

/**
 * One proven child-to-owner relationship in the selected inspector ancestry.
 * Mounting the `owner` executes the complete authored component, including JSX siblings that the
 * pinpoint preview deliberately omits.
 */
export interface PreviewInspectorAncestorEdge {
  /** Import spelling used at this exact occurrence; aliases still identify the same child value. */
  readonly child: PreviewInspectorComponentReference;
  /** Primitive props statically visible on the child occurrence. */
  readonly childAutomaticProps: PreviewParentSliceStaticProps;
  /** Number of source-private component owners crossed before reaching `owner`. */
  readonly localOwnerDepth: number;
  /** Private owner names crossed in inner-to-outer order for diagnostics. */
  readonly localOwnerNames: readonly string[];
  /** Source offset of the selected imported child JSX occurrence. */
  readonly occurrenceStart: number;
  /** Nearest importable authored owner containing the child occurrence. */
  readonly owner: PreviewInspectorComponentReference;
}

/** Why reverse owner discovery stopped at the returned importable root. */
export type PreviewInspectorAncestorStopReason =
  'cycle' | 'depth-limit' | 'non-component-owner' | 'private-owner' | 'root-reached';

/**
 * Immutable build-time recipe for mounting one real ancestor and instrumenting its nested target.
 */
export interface PreviewInspectorAncestorPlan {
  /** `true` only when the scan naturally reached an export with no further package-local usage. */
  readonly complete: boolean;
  /** Files selected by the ancestry and therefore relevant to inspector hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Proven import relationships ordered from the selected target out toward the mounted root. */
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  /** Actual authored export imported by the Page Inspector entry. */
  readonly root: PreviewInspectorComponentReference;
  /** Props usable when a private owner prevents mounting the next outer component. */
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  /** Stable explanation shown when the ancestry is necessarily partial. */
  readonly stopReason: PreviewInspectorAncestorStopReason;
  /** Original selected export that nested instrumentation must intercept. */
  readonly target: PreviewInspectorComponentReference;
  /** Primitive props observed at the first selected target occurrence, if any. */
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}

/** Lazily supplies current editor-or-disk source under caller-owned package and byte budgets. */
export type ReadPreviewInspectorSource = (sourcePath: string) => Promise<string | undefined>;

/** Resolves tsconfig/package aliases that cannot be proven by lexical suffix matching alone. */
export type ReadPreviewInspectorAcceptedSpecifiers = (
  target: PreviewInspectorComponentReference,
) => readonly string[];

/** Inputs for one bounded package-local reverse JSX owner traversal. */
export interface CreatePreviewInspectorAncestorPlanOptions {
  /** Optional project-aware aliases for each changing reverse-graph frontier. */
  readonly acceptedImportSpecifiers?: ReadPreviewInspectorAcceptedSpecifiers;
  /** Absolute source path selected by the editor command. */
  readonly documentPath: string;
  /** Exact selected runtime export within `documentPath`. */
  readonly exportName: string;
  /** Optional tsconfig/jsconfig-aware import identity check for every reverse frontier. */
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  /** Current source reader; dirty editor snapshots should take precedence in the caller. */
  readonly readSource: ReadPreviewInspectorSource;
  /** Bounded nearest-package or monorepo-package inventory in any order. */
  readonly sourcePaths: readonly string[];
}

/** Successful exported-owner result after crossing private declarations in one file. */
interface SuccessfulOwnerPromotion {
  readonly exportNames: readonly string[];
  readonly kind: 'promoted';
  readonly localOwnerNames: readonly string[];
  readonly root: PreviewInspectorComponentReference;
}

/** Fail-closed result when no outer declaration can become an actual React mount root. */
interface StoppedOwnerPromotion {
  readonly kind: 'stopped';
  readonly stopReason: Extract<
    PreviewInspectorAncestorStopReason,
    'non-component-owner' | 'private-owner'
  >;
}

/** Result of crossing private owners toward the nearest component-shaped exported declaration. */
type OwnerPromotionResult = SuccessfulOwnerPromotion | StoppedOwnerPromotion;

/** One selected JSX occurrence plus its already parsed consumer text. */
interface InspectorUsageCandidate {
  readonly reexportPaths: readonly string[];
  readonly slice: PreviewParentSlice;
  readonly sourceText: string;
}

/** One importable module/export frontier, including barrels crossed from the real component. */
interface InspectorModuleFrontier {
  readonly dependencyPaths: readonly string[];
  readonly exportNames: readonly string[];
  readonly sourcePath: string;
}

/** One already-read source retained only for the duration of a bounded planner call. */
interface InspectorCandidateSource {
  readonly sourcePath: string;
  readonly sourceText: string;
}

/**
 * Finds the outermost bounded exported owner that can reproduce the target's authored page branch.
 *
 * Dynamic props and wrapper components do not block this inspector-only traversal: they will be
 * evaluated by React when the real owner export is mounted. The algorithm still fails closed on
 * private terminal owners, cycles, and fixed depth limits, and never imports application code in
 * the extension host.
 *
 * @param options Selected target, package inventory, source reader, and optional alias resolver.
 * @returns Frozen ancestor plan suitable for a generated browser entry.
 */
export async function createPreviewInspectorAncestorPlan(
  options: CreatePreviewInspectorAncestorPlanOptions,
): Promise<PreviewInspectorAncestorPlan> {
  assertInspectorTarget(options.documentPath, options.exportName);
  const sourcePaths = [
    ...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath))),
  ].sort();
  const target = freezeReference(options.documentPath, options.exportName);
  const dependencies = new Set<string>([target.sourcePath]);
  const edges: PreviewInspectorAncestorEdge[] = [];
  const visitedReferences = new Set<string>([createReferenceKey(target)]);
  let currentAliases: readonly string[] = [target.exportName];
  let currentRoot = target;
  let rootAutomaticProps: PreviewParentSliceStaticProps = Object.freeze({});
  let targetAutomaticProps: PreviewParentSliceStaticProps = Object.freeze({});

  for (let depth = 0; depth < MAX_PROJECT_ANCESTOR_DEPTH; depth += 1) {
    const candidate = await findInspectorUsage({
      acceptedImportSpecifiers: options.acceptedImportSpecifiers?.(currentRoot) ?? [],
      ...(options.matchesTargetImport === undefined
        ? {}
        : { matchesTargetImport: options.matchesTargetImport }),
      readSource: options.readSource,
      sourcePaths,
      targetExportNames: currentAliases,
      targetPath: currentRoot.sourcePath,
    });
    if (candidate === undefined) {
      return freezePlan({
        complete: true,
        dependencies,
        edges,
        root: currentRoot,
        rootAutomaticProps,
        stopReason: 'root-reached',
        target,
        targetAutomaticProps,
      });
    }

    for (const reexportPath of candidate.reexportPaths) {
      dependencies.add(reexportPath);
    }

    if (edges.length === 0) {
      targetAutomaticProps = candidate.slice.targetProps;
    }
    if (candidate.slice.owner === null) {
      rootAutomaticProps = candidate.slice.targetProps;
      dependencies.add(candidate.slice.consumerPath);
      return freezePlan({
        complete: true,
        dependencies,
        edges,
        root: currentRoot,
        rootAutomaticProps,
        stopReason: 'root-reached',
        target,
        targetAutomaticProps,
      });
    }
    const promotion = promoteInspectorOwner(candidate);
    if (promotion.kind === 'stopped') {
      rootAutomaticProps = candidate.slice.targetProps;
      dependencies.add(candidate.slice.consumerPath);
      return freezePlan({
        complete: false,
        dependencies,
        edges,
        root: currentRoot,
        rootAutomaticProps,
        stopReason: promotion.stopReason,
        target,
        targetAutomaticProps,
      });
    }

    const promotedKey = createReferenceKey(promotion.root);
    if (visitedReferences.has(promotedKey)) {
      rootAutomaticProps = candidate.slice.targetProps;
      dependencies.add(candidate.slice.consumerPath);
      return freezePlan({
        complete: false,
        dependencies,
        edges,
        root: currentRoot,
        rootAutomaticProps,
        stopReason: 'cycle',
        target,
        targetAutomaticProps,
      });
    }

    visitedReferences.add(promotedKey);
    dependencies.add(candidate.slice.consumerPath);
    edges.push(
      Object.freeze({
        child: freezeReference(currentRoot.sourcePath, candidate.slice.targetExportName),
        childAutomaticProps: candidate.slice.targetProps,
        localOwnerDepth: promotion.localOwnerNames.length,
        localOwnerNames: Object.freeze([...promotion.localOwnerNames]),
        occurrenceStart: candidate.slice.occurrenceStart,
        owner: promotion.root,
      }),
    );
    currentAliases = promotion.exportNames;
    currentRoot = promotion.root;
    rootAutomaticProps = Object.freeze({});
  }

  return freezePlan({
    complete: false,
    dependencies,
    edges,
    root: currentRoot,
    rootAutomaticProps,
    stopReason: 'depth-limit',
    target,
    targetAutomaticProps,
  });
}

/** Selects the strongest page-like JSX usage across direct imports and bounded barrel chains. */
async function findInspectorUsage(options: {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly readSource: ReadPreviewInspectorSource;
  readonly sourcePaths: readonly string[];
  readonly targetExportNames: readonly string[];
  readonly targetPath: string;
}): Promise<InspectorUsageCandidate | undefined> {
  const sources: InspectorCandidateSource[] = [];
  const sourceFileByPath = new Map<string, ts.SourceFile>();
  const candidates: InspectorUsageCandidate[] = [];
  for (
    let batchStart = 0;
    batchStart < options.sourcePaths.length;
    batchStart += MAX_CONCURRENT_SOURCE_READS
  ) {
    const batchPaths = options.sourcePaths.slice(
      batchStart,
      batchStart + MAX_CONCURRENT_SOURCE_READS,
    );
    const batch = await Promise.all(
      batchPaths.map(async (sourcePath) => ({
        sourcePath,
        sourceText:
          sourcePath === path.normalize(options.targetPath)
            ? undefined
            : await options.readSource(sourcePath),
      })),
    );
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

  const frontiers = collectInspectorModuleFrontiers(options, sources, sourceFileByPath);
  for (const source of sources) {
    if (!source.sourceText.includes('<')) {
      continue;
    }
    for (const frontier of frontiers) {
      if (path.normalize(source.sourcePath) === path.normalize(frontier.sourcePath)) {
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
  return rankedCandidates[0]?.candidate;
}

/**
 * Expands `export { X } from` and `export * from` edges without treating barrels as React owners.
 * Each pass adds at most one new module frontier per source path and a hard depth ceiling prevents
 * cyclic re-export graphs from consuming unbounded work.
 */
function collectInspectorModuleFrontiers(
  options: {
    readonly acceptedImportSpecifiers: readonly string[];
    readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
    readonly targetExportNames: readonly string[];
    readonly targetPath: string;
  },
  sources: readonly InspectorCandidateSource[],
  sourceFileByPath: Map<string, ts.SourceFile>,
): readonly InspectorModuleFrontier[] {
  const initialFrontier: InspectorModuleFrontier = {
    dependencyPaths: Object.freeze([]),
    exportNames: Object.freeze([...options.targetExportNames]),
    sourcePath: path.normalize(options.targetPath),
  };
  const frontierByPath = new Map<string, InspectorModuleFrontier>([
    [initialFrontier.sourcePath, initialFrontier],
  ]);

  for (let depth = 0; depth < MAX_REEXPORT_DEPTH; depth += 1) {
    let changed = false;
    const knownFrontiers = [...frontierByPath.values()];
    for (const source of sources) {
      const normalizedSourcePath = path.normalize(source.sourcePath);
      const sourceFile = readInspectorSourceFile(source, sourceFileByPath);
      const discoveredNames = new Set(frontierByPath.get(normalizedSourcePath)?.exportNames ?? []);
      const dependencyPaths = new Set(
        frontierByPath.get(normalizedSourcePath)?.dependencyPaths ?? [],
      );
      for (const statement of sourceFile.statements) {
        if (
          !ts.isExportDeclaration(statement) ||
          statement.isTypeOnly ||
          statement.moduleSpecifier === undefined ||
          !ts.isStringLiteralLike(statement.moduleSpecifier)
        ) {
          continue;
        }
        for (const frontier of knownFrontiers) {
          if (!doesInspectorReexportMatch(options, source.sourcePath, statement, frontier)) {
            continue;
          }
          for (const exportedName of readInspectorReexportNames(statement, frontier.exportNames)) {
            discoveredNames.add(exportedName);
          }
          for (const dependencyPath of frontier.dependencyPaths) {
            dependencyPaths.add(dependencyPath);
          }
        }
      }
      if (discoveredNames.size === 0) {
        continue;
      }
      dependencyPaths.add(normalizedSourcePath);
      const previous = frontierByPath.get(normalizedSourcePath);
      const nextNames = [...discoveredNames].sort();
      if (
        previous?.exportNames.length !== nextNames.length ||
        nextNames.some((name, index) => name !== previous.exportNames[index])
      ) {
        frontierByPath.set(normalizedSourcePath, {
          dependencyPaths: Object.freeze([...dependencyPaths].sort()),
          exportNames: Object.freeze(nextNames),
          sourcePath: normalizedSourcePath,
        });
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return [...frontierByPath.values()];
}

/** Parses one barrel candidate once while preserving the caller's bounded in-memory lifetime. */
function readInspectorSourceFile(
  source: InspectorCandidateSource,
  sourceFileByPath: Map<string, ts.SourceFile>,
): ts.SourceFile {
  const cached = sourceFileByPath.get(source.sourcePath);
  if (cached !== undefined) {
    return cached;
  }
  const sourceFile = ts.createSourceFile(
    source.sourcePath,
    source.sourceText,
    ts.ScriptTarget.Latest,
    true,
    source.sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  sourceFileByPath.set(source.sourcePath, sourceFile);
  return sourceFile;
}

/** Proves that one re-export declaration points at the current component/barrel frontier. */
function doesInspectorReexportMatch(
  options: {
    readonly acceptedImportSpecifiers: readonly string[];
    readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
    readonly targetPath: string;
  },
  consumerPath: string,
  statement: ts.ExportDeclaration,
  frontier: InspectorModuleFrontier,
): boolean {
  const moduleSpecifierNode = statement.moduleSpecifier;
  if (moduleSpecifierNode === undefined || !ts.isStringLiteralLike(moduleSpecifierNode)) {
    return false;
  }
  const moduleSpecifier = moduleSpecifierNode.text;
  const acceptedSpecifiers =
    path.normalize(frontier.sourcePath) === path.normalize(options.targetPath)
      ? new Set(options.acceptedImportSpecifiers)
      : new Set<string>();
  return (
    matchesPreviewParentSliceTargetImport(
      moduleSpecifier,
      consumerPath,
      frontier.sourcePath,
      acceptedSpecifiers,
    ) || options.matchesTargetImport?.(moduleSpecifier, consumerPath, frontier.sourcePath) === true
  );
}

/** Maps imported frontier names to the public names contributed by one re-export declaration. */
function readInspectorReexportNames(
  statement: ts.ExportDeclaration,
  frontierNames: readonly string[],
): readonly string[] {
  const clause = statement.exportClause;
  if (clause === undefined) {
    return frontierNames.filter((name) => name !== 'default');
  }
  if (!ts.isNamedExports(clause)) {
    return [];
  }
  const selectedNames = new Set(frontierNames);
  return clause.elements.flatMap((element) => {
    const importedName = (element.propertyName ?? element.name).text;
    return !element.isTypeOnly && selectedNames.has(importedName) ? [element.name.text] : [];
  });
}

/**
 * Climbs private same-module component usages until an importable owner export is reached.
 */
function promoteInspectorOwner(candidate: InspectorUsageCandidate): OwnerPromotionResult {
  const visitedLocalOwners = new Set<string>();
  const localOwnerNames: string[] = [];
  let currentSlice = candidate.slice;

  for (let depth = 0; depth <= MAX_LOCAL_OWNER_DEPTH; depth += 1) {
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
    if (
      owner.localName === null ||
      depth >= MAX_LOCAL_OWNER_DEPTH ||
      visitedLocalOwners.has(owner.localName)
    ) {
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
  return { kind: 'stopped', stopReason: 'private-owner' };
}

/**
 * Orders candidates by mountability and generic application source conventions before path order.
 * Stories, tests, examples, fixtures, demos, and mocks remain eligible fallbacks, but application
 * pages/layouts/routes and entry modules win when both branches are structurally renderable.
 */
function compareRankedInspectorUsageCandidates(
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
function scoreInspectorUsageCandidate(candidate: InspectorUsageCandidate): number {
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
function scoreInspectorSourcePath(sourcePath: string): number {
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
  if (/(?:^|\/)(?:examples?|demos?|fixtures?|mocks?|playgrounds?)(?:\/|$)/u.test(normalizedPath)) {
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
function scoreInspectorOwnerName(promotion: OwnerPromotionResult | undefined): number {
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
function selectPreferredExportName(exportNames: readonly string[]): string {
  return exportNames.includes('default') ? 'default' : (exportNames[0] ?? 'default');
}

/** Validates the public planner boundary before any package source is read. */
function assertInspectorTarget(documentPath: string, exportName: string): void {
  if (!path.isAbsolute(documentPath)) {
    throw new RangeError('Preview inspector target path must be absolute.');
  }
  if (exportName.length === 0 || exportName === '*') {
    throw new TypeError('Preview inspector target export must be explicit.');
  }
}

/** Creates a normalized, immutable component reference. */
function freezeReference(
  sourcePath: string,
  exportName: string,
): PreviewInspectorComponentReference {
  return Object.freeze({ exportName, sourcePath: path.normalize(sourcePath) });
}

/** Produces a cycle identity stable across path separator and alias spelling differences. */
function createReferenceKey(reference: PreviewInspectorComponentReference): string {
  return `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
}

/** Freezes one successful or safely partial plan without retaining parser nodes/source text. */
function freezePlan(options: {
  readonly complete: boolean;
  readonly dependencies: ReadonlySet<string>;
  readonly edges: readonly PreviewInspectorAncestorEdge[];
  readonly root: PreviewInspectorComponentReference;
  readonly rootAutomaticProps: PreviewParentSliceStaticProps;
  readonly stopReason: PreviewInspectorAncestorStopReason;
  readonly target: PreviewInspectorComponentReference;
  readonly targetAutomaticProps: PreviewParentSliceStaticProps;
}): PreviewInspectorAncestorPlan {
  return Object.freeze({
    complete: options.complete,
    dependencyPaths: Object.freeze([...options.dependencies].sort()),
    edges: Object.freeze([...options.edges]),
    root: options.root,
    rootAutomaticProps: options.rootAutomaticProps,
    stopReason: options.stopReason,
    target: options.target,
    targetAutomaticProps: options.targetAutomaticProps,
  });
}
