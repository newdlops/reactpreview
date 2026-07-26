/** Creates the bounded, deterministic authored import closure before esbuild resolution. */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';
import type {
  PreviewCompilerFrontierPolicy,
  PreviewCompilerFrontierReason,
} from '../../../domain/previewCompilerFrontier';
import type { PreviewInspectorAncestorPlan } from './previewInspectorAncestorPlan';
import type { PreviewInspectorPageExecutionCandidate } from './previewInspectorPageExecutionTypes';
import { collectPreviewInspectorRuntimeImportInventory } from './previewInspectorRuntimeImportInventory';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
} from './previewInspectorMountSurfaceSlice';
import { collectPreviewInspectorShallowProjectionInventory } from './previewInspectorShallowProjection';
import type {
  PreviewInspectorBundleFrontier,
  PreviewInspectorProjectedEdge,
  PreviewInspectorRuntimeImportEdge,
} from './previewInspectorBundleFrontierTypes';

const FRONTIER_FORMAT_VERSION = 1;
const PAGE_EXECUTION_FRONTIER_FORMAT_VERSION = 2;
const MAX_SINGLE_AUTHORED_SOURCE_BYTES = 1024 * 1024;
const SOURCE_MODULE_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;
const STYLE_OR_ASSET_PATTERN =
  /\.(?:css|less|sass|scss|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|eot)$/iu;

export interface PreparePreviewInspectorBundleFrontierOptions {
  readonly additionalCriticalSourcePaths?: readonly string[];
  /** A frozen Page Execution candidate switches exact admission from broad evidence to surfaces. */
  readonly executionCandidate?: PreviewInspectorPageExecutionCandidate;
  readonly plan: PreviewInspectorAncestorPlan;
  readonly policy: PreviewCompilerFrontierPolicy;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule: (specifier: string, importer: string) => string | undefined;
  readonly workspaceRoot: string;
}

export interface PreparedPreviewInspectorBundleFrontier {
  readonly frontier: PreviewInspectorBundleFrontier;
  readonly rejected: boolean;
}

interface FrontierSourceQueueItem {
  /** Undefined means that the source's complete public surface is required. */
  readonly demandedExportNames?: readonly string[];
  readonly depth: number;
  readonly kind: 'exact' | 'optional-component' | 'optional-support' | 'support';
  readonly optionalEdge?: Omit<PreviewInspectorProjectedEdge, 'reason'>;
  readonly sourcePath: string;
}

type AdmittedKind = FrontierSourceQueueItem['kind'];

interface SourceInventory {
  readonly byteLength: number;
  readonly edges: readonly PreviewInspectorRuntimeImportEdge[];
}

interface OptionalProposal {
  readonly authoredEdgeCount: number;
  readonly barePackages: ReadonlySet<string>;
  readonly packageDemandPaths: ReadonlySet<string>;
  readonly sourceBytes: number;
  readonly sourcePaths: readonly string[];
  readonly styleAndAssetEdgeCount: number;
  readonly supportPaths: ReadonlySet<string>;
}

/** Builds the same frontier for equal source snapshots regardless of resolve callback timing. */
export async function preparePreviewInspectorBundleFrontier(
  options: PreparePreviewInspectorBundleFrontierOptions,
): Promise<PreparedPreviewInspectorBundleFrontier> {
  const pending: FrontierSourceQueueItem[] = [
    ...collectExactSeedPaths(options.plan, options.executionCandidate),
    ...(options.additionalCriticalSourcePaths ?? []),
  ]
    .filter((sourcePath) => isAuthoredPath(options.workspaceRoot, sourcePath))
    .map((sourcePath) => ({ depth: 0, kind: 'exact', sourcePath }));
  const projectedEdges: PreviewInspectorProjectedEdge[] = [];
  const optionalExportsByPath = new Map<string, Set<string>>();
  const optionalIdentities = new Set<string>();
  for (const visualPath of options.executionCandidate === undefined
    ? [...(options.plan.shallowVisualPaths ?? [])].sort(compareVisualPaths)
    : []) {
    if (
      visualPath.relation === 'route-alternative' ||
      !isAuthoredPath(options.workspaceRoot, visualPath.sourcePath)
    )
      continue;
    const sourcePath = path.normalize(visualPath.sourcePath);
    const edge = Object.freeze({
      exportNames: Object.freeze([visualPath.exportName]),
      importerPath: path.normalize(visualPath.importerPath),
      moduleSpecifier: visualPath.moduleSpecifier,
      occurrenceStart: visualPath.occurrenceStart,
      runtimeHookExportNames: Object.freeze([]),
      targetPath: sourcePath,
    });
    const identity = `${sourcePath}\0${visualPath.exportName}`;
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    if (optionalIdentities.size > maximumOptionalSurfaceCount(options)) {
      projectedEdges.push(Object.freeze({ ...edge, reason: 'optional-component-count' }));
      continue;
    }
    const exports = optionalExportsByPath.get(sourcePath) ?? new Set<string>();
    exports.add(visualPath.exportName);
    optionalExportsByPath.set(sourcePath, exports);
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }
  for (const reference of options.executionCandidate === undefined
    ? collectExactVisualRoots(options.plan)
    : []) {
    await collectExactVisualAdmissions(
      options,
      reference,
      optionalExportsByPath,
      optionalIdentities,
      pending,
      projectedEdges,
    );
  }
  for (const surface of options.executionCandidate?.optionalSurfaces ?? []) {
    const sourcePath = path.normalize(surface.sourcePath);
    if (!isAuthoredPath(options.workspaceRoot, sourcePath)) continue;
    const identity = `${sourcePath}\0${surface.exportName}`;
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    const edge = Object.freeze({
      exportNames: Object.freeze([surface.exportName]),
      importerPath: sourcePath,
      moduleSpecifier: surface.sourcePath,
      occurrenceStart: 0,
      runtimeHookExportNames: Object.freeze([]),
      targetPath: sourcePath,
    });
    if (optionalIdentities.size > maximumOptionalSurfaceCount(options)) {
      projectedEdges.push(Object.freeze({ ...edge, reason: 'optional-component-count' }));
      continue;
    }
    optionalExportsByPath.set(sourcePath, new Set(edge.exportNames));
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }

  const sourceCache = new Map<string, Promise<SourceInventory | PreviewCompilerFrontierReason>>();
  const admittedKinds = new Map<string, AdmittedKind>();
  const barePackages = new Set<string>();
  const packageDemandPaths = new Set<string>();
  const reasons = new Set<PreviewCompilerFrontierReason>();
  let authoredEdgeCount = 0;
  let maximumDepth = 0;
  let sourceBytes = 0;
  let styleAndAssetEdgeCount = 0;
  const processedStaticEdges = new Set<string>();

  const readInventory = (
    sourcePath: string,
  ): Promise<SourceInventory | PreviewCompilerFrontierReason> => {
    const cached = sourceCache.get(sourcePath);
    if (cached !== undefined) return cached;
    const read = options.readSource(sourcePath).then((sourceText) => {
      if (sourceText === undefined) return 'exact-source-unreadable' as const;
      const slicedSurface = options.executionCandidate?.criticalSurfaces.find(
        (surface) =>
          (surface.strategy === 'selected-export-slice' ||
            surface.strategy === 'inner-local-component-slice') &&
          path.normalize(surface.sourcePath) === path.normalize(sourcePath),
      );
      const slice =
        slicedSurface === undefined
          ? undefined
          : slicedSurface.strategy === 'inner-local-component-slice' &&
              slicedSurface.localName !== undefined
            ? createPreviewInspectorLocalComponentSlice({
                localName: slicedSurface.localName,
                preservedWrapperKinds: slicedSurface.preservedWrapperKinds ?? [],
                sourcePath,
                sourceText,
              })
            : createPreviewInspectorSelectedExportSlice({
                exportName: slicedSurface.exportName,
                sourcePath,
                sourceText,
              });
      const inventorySource = slice?.kind === 'success' ? slice.slice.contents : sourceText;
      const byteLength = Buffer.byteLength(inventorySource, 'utf8');
      if (byteLength > MAX_SINGLE_AUTHORED_SOURCE_BYTES) return 'single-source-bytes' as const;
      if (hasSourceParseFailure(sourcePath, inventorySource))
        return 'source-parse-failure' as const;
      return Object.freeze({
        byteLength,
        edges: collectPreviewInspectorRuntimeImportInventory(sourcePath, inventorySource),
      });
    });
    sourceCache.set(sourcePath, read);
    return read;
  };

  while (pending.length > 0) {
    pending.sort(compareQueueItems);
    const item = pending.shift();
    if (item === undefined || admittedKinds.has(item.sourcePath)) continue;
    if (item.kind === 'optional-component') {
      if (item.depth > maximumOptionalDepth(options)) {
        appendProjection(projectedEdges, item, 'component-depth');
        continue;
      }
      const proposal = await probeOptionalClosure(
        item.sourcePath,
        admittedKinds,
        options,
        readInventory,
      );
      if (typeof proposal === 'string') {
        appendProjection(projectedEdges, item, optionalFailureReason(proposal));
        continue;
      }
      const reason = findOptionalOverflow(
        proposal,
        {
          authoredEdgeCount,
          barePackages,
          packageDemandPaths,
          sourceBytes,
          styleAndAssetEdgeCount,
          totalAuthoredModuleCount: admittedKinds.size,
          supportModuleCount: countKinds(admittedKinds, 'optional-support'),
        },
        options.policy,
        options.executionCandidate !== undefined,
      );
      if (reason !== undefined) {
        appendProjection(projectedEdges, item, reason);
        continue;
      }
      for (const sourcePath of proposal.sourcePaths)
        admittedKinds.set(
          sourcePath,
          sourcePath === item.sourcePath ? 'optional-component' : 'optional-support',
        );
      for (const sourcePath of proposal.supportPaths) {
        if (sourcePath !== item.sourcePath && admittedKinds.get(sourcePath) !== 'exact')
          admittedKinds.set(sourcePath, 'optional-support');
      }
      authoredEdgeCount += proposal.authoredEdgeCount;
      sourceBytes += proposal.sourceBytes;
      styleAndAssetEdgeCount += proposal.styleAndAssetEdgeCount;
      for (const packageName of proposal.barePackages) barePackages.add(packageName);
      for (const sourcePath of proposal.packageDemandPaths) packageDemandPaths.add(sourcePath);
      maximumDepth = Math.max(maximumDepth, item.depth);
      const rootInventory = await readInventory(item.sourcePath);
      if (typeof rootInventory !== 'string') {
        for (const edge of rootInventory.edges) {
          if (edge.kind !== 'dynamic-import') continue;
          const resolved = options.resolveModule(edge.moduleSpecifier, item.sourcePath);
          if (resolved === undefined || !isAuthoredPath(options.workspaceRoot, resolved)) continue;
          const sourcePath = path.normalize(resolved);
          const identity = `${sourcePath}\0default`;
          const edgeRecord = Object.freeze({
            exportNames: Object.freeze(
              edge.importedNames.length === 0 ? ['default'] : edge.importedNames,
            ),
            importerPath: item.sourcePath,
            moduleSpecifier: edge.moduleSpecifier,
            occurrenceStart: edge.occurrenceStart,
            runtimeHookExportNames: Object.freeze([]),
            targetPath: sourcePath,
          });
          if (optionalIdentities.has(identity) || admittedKinds.has(sourcePath)) continue;
          optionalIdentities.add(identity);
          if (optionalIdentities.size > maximumOptionalSurfaceCount(options)) {
            projectedEdges.push(
              Object.freeze({ ...edgeRecord, reason: 'optional-component-count' }),
            );
            continue;
          }
          optionalExportsByPath.set(sourcePath, new Set(edgeRecord.exportNames));
          pending.push({
            depth: item.depth + 1,
            kind: 'optional-component',
            optionalEdge: edgeRecord,
            sourcePath,
          });
        }
      }
      continue;
    }
    const inventory = await readInventory(item.sourcePath);
    if (typeof inventory === 'string') {
      reasons.add(inventory);
      continue;
    }
    admittedKinds.set(item.sourcePath, item.kind);
    sourceBytes += inventory.byteLength;
    for (const edge of inventory.edges) {
      if (edge.kind === 'dynamic-import') {
        /* A lazy child reached from a selected critical surface is still part of the executable
         * page slice. Legacy v1 treated it as an optional visual transaction; v2 must admit its
         * authored closure before strict metafile verification can allow the emitted lazy chunk. */
        if (options.executionCandidate === undefined) continue;
        const resolved = options.resolveModule(edge.moduleSpecifier, item.sourcePath);
        if (
          resolved !== undefined &&
          isAuthoredPath(options.workspaceRoot, resolved) &&
          isSelectedDynamicVisualPath(options.plan, item.sourcePath, resolved)
        ) {
          const resolvedSourcePath = path.normalize(resolved);
          const edgeIdentity = `${item.sourcePath}\0${edge.occurrenceStart.toString()}\0${edge.moduleSpecifier}`;
          if (!processedStaticEdges.has(edgeIdentity)) {
            processedStaticEdges.add(edgeIdentity);
            authoredEdgeCount += 1;
            pending.push({
              depth: item.depth + 1,
              kind: 'support',
              sourcePath: resolvedSourcePath,
            });
          }
        }
        continue;
      }
      const edgeIdentity = `${item.sourcePath}\0${edge.occurrenceStart.toString()}\0${edge.moduleSpecifier}`;
      if (processedStaticEdges.has(edgeIdentity)) continue;
      if (STYLE_OR_ASSET_PATTERN.test(edge.moduleSpecifier)) {
        processedStaticEdges.add(edgeIdentity);
        styleAndAssetEdgeCount += 1;
        continue;
      }
      const resolved = options.resolveModule(edge.moduleSpecifier, item.sourcePath);
      if (resolved !== undefined && isAuthoredPath(options.workspaceRoot, resolved)) {
        const resolvedSourcePath = path.normalize(resolved);
        if (!(await shouldTraverseStaticEdge(item, edge, resolvedSourcePath, options))) continue;
        processedStaticEdges.add(edgeIdentity);
        authoredEdgeCount += 1;
        // A proven rendered child owns an optional transaction; treating its static import as
        // mandatory support would bypass projection and expand every modal/form subtree eagerly.
        if (!optionalExportsByPath.has(resolvedSourcePath)) {
          const demandedExportNames = demandedExportsForStaticEdge(item, edge);
          pending.push({
            ...(demandedExportNames === undefined ? {} : { demandedExportNames }),
            depth: item.depth,
            kind: 'support',
            sourcePath: resolvedSourcePath,
          });
        }
        continue;
      }
      processedStaticEdges.add(edgeIdentity);
      const packageName = normalizeBarePackageSpecifier(edge.moduleSpecifier);
      if (packageName !== undefined) {
        barePackages.add(packageName);
        packageDemandPaths.add(item.sourcePath);
      }
    }
  }

  const authenticSourcePaths = Object.freeze([...admittedKinds.keys()].sort());
  const exactSourcePaths = Object.freeze(
    authenticSourcePaths.filter((sourcePath) => admittedKinds.get(sourcePath) === 'exact'),
  );
  const optionalSourcePaths = authenticSourcePaths.filter(
    (sourcePath) => admittedKinds.get(sourcePath) === 'optional-component',
  );
  const supportModuleCount =
    countKinds(admittedKinds, 'support') + countKinds(admittedKinds, 'optional-support');
  if (exactSourcePaths.length > options.policy.maximumExactModuleCount)
    reasons.add('exact-module-count');
  if (sourceBytes > options.policy.maximumTotalSourceBytes) reasons.add('source-byte-count');
  if (authenticSourcePaths.length > options.policy.maximumTotalAuthoredModuleCount)
    reasons.add('total-module-count');
  if (authoredEdgeCount > options.policy.maximumAuthoredImportEdgeCount)
    reasons.add('authored-edge-count');
  if (packageDemandPaths.size > options.policy.maximumPackageDemandSourceCount)
    reasons.add('package-demand-count');
  if (barePackages.size > options.policy.maximumDistinctBarePackageSpecifiers)
    reasons.add('bare-package-count');
  if (styleAndAssetEdgeCount > options.policy.maximumStyleAndAssetEdgeCount)
    reasons.add('style-asset-count');
  const boundedPackageDemandPaths = Object.freeze(
    [...packageDemandPaths].sort().slice(0, options.policy.maximumPackageDemandSourceCount),
  );
  const truncationReasons = Object.freeze(sortReasons(reasons));
  const summary = Object.freeze({
    authoredEdgeCount,
    exactModuleCount: exactSourcePaths.length,
    maximumDepth,
    optionalComponentCount: optionalSourcePaths.length,
    packageDemandSourceCount: boundedPackageDemandPaths.length,
    projectedEdgeCount: projectedEdges.length,
    sourceBytes,
    supportModuleCount,
    totalAuthoredModuleCount: authenticSourcePaths.length,
    truncationReasons,
  });
  const components = Object.freeze(
    optionalSourcePaths.map((sourcePath) =>
      Object.freeze({
        exportNames: Object.freeze([...(optionalExportsByPath.get(sourcePath) ?? [])].sort()),
        runtimeHookExportNames: Object.freeze([]),
        sourcePath,
      }),
    ),
  );
  const sortedProjections = Object.freeze([...projectedEdges].sort(compareProjectedEdges));
  return {
    frontier: Object.freeze({
      authenticComponentExports: components,
      authenticSourcePaths,
      exactSourcePaths,
      identity: createFrontierIdentity(
        options.policy,
        options.executionCandidate,
        authenticSourcePaths,
        exactSourcePaths,
        boundedPackageDemandPaths,
        components,
        sortedProjections,
        summary,
      ),
      packageDemandSourcePaths: boundedPackageDemandPaths,
      projectedEdges: sortedProjections,
      summary,
      version:
        options.executionCandidate === undefined
          ? FRONTIER_FORMAT_VERSION
          : PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
      ...(options.executionCandidate === undefined
        ? {}
        : {
            executionCandidateId: options.executionCandidate.id,
            sourceKinds: Object.freeze(
              Object.fromEntries(
                [...admittedKinds.entries()].map(([sourcePath, kind]) => [
                  sourcePath,
                  kind === 'exact'
                    ? ('critical-surface' as const)
                    : kind === 'optional-component'
                      ? ('optional-surface' as const)
                      : kind === 'optional-support'
                        ? ('optional-support' as const)
                        : ('critical-support' as const),
                ]),
              ),
            ),
          }),
    }),
    rejected: truncationReasons.length > 0,
  };
}

/** Requires existing one-hop render evidence before a dynamic import can enter a v2 slice. */
function isSelectedDynamicVisualPath(
  plan: PreviewInspectorAncestorPlan,
  importerPath: string,
  sourcePath: string,
): boolean {
  return (plan.shallowVisualPaths ?? []).some(
    (visualPath) =>
      path.normalize(visualPath.importerPath) === path.normalize(importerPath) &&
      path.normalize(visualPath.sourcePath) === path.normalize(sourcePath) &&
      visualPath.relation !== 'route-alternative',
  );
}

/** Promotes proven JSX children of an exact render root when broad plan evidence omits them. */
async function collectExactVisualAdmissions(
  options: PreparePreviewInspectorBundleFrontierOptions,
  reference: { readonly exportName: string; readonly sourcePath: string },
  optionalExportsByPath: Map<string, Set<string>>,
  optionalIdentities: Set<string>,
  pending: FrontierSourceQueueItem[],
  projectedEdges: PreviewInspectorProjectedEdge[],
): Promise<void> {
  const importerPath = path.normalize(reference.sourcePath);
  const sourceText = await options.readSource(importerPath);
  if (sourceText === undefined) return;
  const inventory = collectPreviewInspectorRuntimeImportInventory(importerPath, sourceText);
  const projections = collectPreviewInspectorShallowProjectionInventory(
    importerPath,
    sourceText,
    new Set([reference.exportName]),
  );
  if (projections.truncated) return;
  for (const projection of projections.projectionsBySpecifier.values()) {
    const importEdge = inventory.find(
      (edge) =>
        edge.kind !== 'dynamic-import' && edge.moduleSpecifier === projection.moduleSpecifier,
    );
    if (importEdge === undefined) continue;
    const resolved = options.resolveModule(projection.moduleSpecifier, importerPath);
    if (resolved === undefined || !isAuthoredPath(options.workspaceRoot, resolved)) continue;
    const sourcePath = path.normalize(resolved);
    const existingExports = optionalExportsByPath.get(sourcePath);
    if (existingExports !== undefined) {
      for (const exportName of projection.exportNames) existingExports.add(exportName);
      continue;
    }
    const identity = `${sourcePath}\0${projection.exportNames.join('\0')}`;
    const edge = Object.freeze({
      exportNames: Object.freeze([...projection.exportNames]),
      importerPath,
      moduleSpecifier: projection.moduleSpecifier,
      occurrenceStart: importEdge.occurrenceStart,
      runtimeHookExportNames: Object.freeze([...projection.runtimeHookExportNames]),
      targetPath: sourcePath,
    });
    if (optionalIdentities.has(identity)) continue;
    optionalIdentities.add(identity);
    if (optionalIdentities.size > maximumOptionalSurfaceCount(options)) {
      projectedEdges.push(Object.freeze({ ...edge, reason: 'optional-component-count' }));
      continue;
    }
    optionalExportsByPath.set(sourcePath, new Set(projection.exportNames));
    pending.push({ depth: 1, kind: 'optional-component', optionalEdge: edge, sourcePath });
  }
}

/** Lists only named exports the generated VirtualPage can mount or compose as authored roots. */
function collectExactVisualRoots(
  plan: PreviewInspectorAncestorPlan,
): readonly { readonly exportName: string; readonly sourcePath: string }[] {
  const roots = new Map<string, { readonly exportName: string; readonly sourcePath: string }>();
  const add = (reference: { readonly exportName: string; readonly sourcePath: string }): void => {
    roots.set(`${path.normalize(reference.sourcePath)}\0${reference.exportName}`, {
      exportName: reference.exportName,
      sourcePath: path.normalize(reference.sourcePath),
    });
  };
  add(plan.target);
  add(plan.root);
  const active = plan.pageCandidates[0];
  if (active !== undefined) {
    add(active.root);
    if (active.target !== undefined) add(active.target);
    for (const edge of active.edges) {
      add(edge.child);
      add(edge.owner);
    }
  }
  return [...roots.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.exportName.localeCompare(right.exportName),
  );
}

/** Carries named imports through a barrel while preserving side-effect import semantics. */
function demandedExportsForStaticEdge(
  item: FrontierSourceQueueItem,
  edge: PreviewInspectorRuntimeImportEdge,
): readonly string[] | undefined {
  if (edge.kind === 'export') return item.demandedExportNames;
  return edge.importedNames.length === 0 || edge.importedNames.includes('*')
    ? undefined
    : edge.importedNames;
}

/** Skips unrequested `export *` branches, the source of unbounded barrel expansion. */
async function shouldTraverseStaticEdge(
  item: FrontierSourceQueueItem,
  edge: PreviewInspectorRuntimeImportEdge,
  resolvedSourcePath: string,
  options: PreparePreviewInspectorBundleFrontierOptions,
): Promise<boolean> {
  if (edge.kind !== 'export' || item.demandedExportNames === undefined) return true;
  if (edge.importedNames.every((exportName) => exportName !== '*'))
    return edge.importedNames.some((exportName) => item.demandedExportNames?.includes(exportName));
  return sourceProvidesAnyExport(
    resolvedSourcePath,
    new Set(item.demandedExportNames),
    options,
    new Set<string>(),
  );
}

/** Proves a requested symbol exists below one star-export branch without admitting its siblings. */
async function sourceProvidesAnyExport(
  sourcePath: string,
  demandedExportNames: ReadonlySet<string>,
  options: PreparePreviewInspectorBundleFrontierOptions,
  seen: Set<string>,
): Promise<boolean> {
  const normalizedPath = path.normalize(sourcePath);
  if (seen.has(normalizedPath) || seen.size >= options.policy.maximumComponentDepth) return false;
  seen.add(normalizedPath);
  const sourceText = await options.readSource(normalizedPath);
  if (sourceText === undefined) return false;
  const sourceFile = ts.createSourceFile(
    normalizedPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    normalizedPath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  for (const statement of sourceFile.statements) {
    if (hasRequestedLocalExport(statement, demandedExportNames)) return true;
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier === undefined) continue;
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue;
    if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      if (
        statement.exportClause.elements.some((element) =>
          demandedExportNames.has(element.name.text),
        )
      )
        return true;
      continue;
    }
    const nextPath = options.resolveModule(statement.moduleSpecifier.text, normalizedPath);
    if (
      nextPath !== undefined &&
      isAuthoredPath(options.workspaceRoot, nextPath) &&
      (await sourceProvidesAnyExport(nextPath, demandedExportNames, options, seen))
    )
      return true;
  }
  return false;
}

/** Recognizes public declarations without evaluating the exported module. */
function hasRequestedLocalExport(
  statement: ts.Statement,
  demandedExportNames: ReadonlySet<string>,
): boolean {
  const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
  const exported = modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  if (!exported) return false;
  if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword))
    return demandedExportNames.has('default');
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name !== undefined
  )
    return demandedExportNames.has(statement.name.text);
  if (ts.isVariableStatement(statement))
    return statement.declarationList.declarations.some(
      (declaration) =>
        ts.isIdentifier(declaration.name) && demandedExportNames.has(declaration.name.text),
    );
  return false;
}

/** Probes an optional component and every required static local import without mutating admission. */
async function probeOptionalClosure(
  rootPath: string,
  admittedKinds: ReadonlyMap<string, AdmittedKind>,
  options: PreparePreviewInspectorBundleFrontierOptions,
  readInventory: (sourcePath: string) => Promise<SourceInventory | PreviewCompilerFrontierReason>,
): Promise<OptionalProposal | PreviewCompilerFrontierReason> {
  const pending = [rootPath];
  const sourcePaths = new Set<string>();
  const supportPaths = new Set<string>();
  const barePackages = new Set<string>();
  const packageDemandPaths = new Set<string>();
  let authoredEdgeCount = 0;
  let sourceBytes = 0;
  let styleAndAssetEdgeCount = 0;
  while (pending.length > 0) {
    pending.sort();
    const sourcePath = pending.shift();
    if (sourcePath === undefined || admittedKinds.has(sourcePath) || sourcePaths.has(sourcePath))
      continue;
    const inventory = await readInventory(sourcePath);
    if (typeof inventory === 'string') return inventory;
    sourcePaths.add(sourcePath);
    sourceBytes += inventory.byteLength;
    if (sourcePath !== rootPath) supportPaths.add(sourcePath);
    for (const edge of inventory.edges) {
      if (edge.kind === 'dynamic-import') continue;
      if (STYLE_OR_ASSET_PATTERN.test(edge.moduleSpecifier)) {
        styleAndAssetEdgeCount += 1;
        continue;
      }
      const resolved = options.resolveModule(edge.moduleSpecifier, sourcePath);
      if (resolved !== undefined && isAuthoredPath(options.workspaceRoot, resolved)) {
        authoredEdgeCount += 1;
        pending.push(path.normalize(resolved));
        continue;
      }
      const packageName = normalizeBarePackageSpecifier(edge.moduleSpecifier);
      if (packageName !== undefined) {
        barePackages.add(packageName);
        packageDemandPaths.add(sourcePath);
      }
    }
  }
  return {
    authoredEdgeCount,
    barePackages,
    packageDemandPaths,
    sourceBytes,
    sourcePaths: [...sourcePaths].sort(),
    styleAndAssetEdgeCount,
    supportPaths,
  };
}

/** Checks a candidate against the fixed limits before exposing any of its authored sources. */
function findOptionalOverflow(
  proposal: OptionalProposal,
  state: {
    readonly authoredEdgeCount: number;
    readonly barePackages: ReadonlySet<string>;
    readonly packageDemandPaths: ReadonlySet<string>;
    readonly sourceBytes: number;
    readonly styleAndAssetEdgeCount: number;
    readonly supportModuleCount: number;
    readonly totalAuthoredModuleCount: number;
  },
  policy: PreviewCompilerFrontierPolicy,
  useSoftEnvelope: boolean,
): PreviewInspectorProjectedEdge['reason'] | undefined {
  const maximumSourceBytes = useSoftEnvelope
    ? policy.softMaximumTotalSourceBytes
    : policy.maximumTotalSourceBytes;
  const maximumModules = useSoftEnvelope
    ? policy.softMaximumTotalAuthoredModuleCount
    : policy.maximumTotalAuthoredModuleCount;
  const maximumSupport = useSoftEnvelope
    ? policy.softMaximumOptionalSupportModuleCount
    : policy.maximumOptionalSupportModuleCount;
  const maximumEdges = useSoftEnvelope
    ? policy.softMaximumAuthoredImportEdgeCount
    : policy.maximumAuthoredImportEdgeCount;
  const maximumPackageDemand = useSoftEnvelope
    ? policy.softMaximumPackageDemandSourceCount
    : policy.maximumPackageDemandSourceCount;
  const maximumBarePackages = useSoftEnvelope
    ? policy.softMaximumDistinctBarePackageSpecifiers
    : policy.maximumDistinctBarePackageSpecifiers;
  const maximumStyleEdges = useSoftEnvelope
    ? policy.softMaximumStyleAndAssetEdgeCount
    : policy.maximumStyleAndAssetEdgeCount;
  const unionSize = (left: ReadonlySet<string>, right: ReadonlySet<string>): number =>
    new Set([...left, ...right]).size;
  if (state.sourceBytes + proposal.sourceBytes > maximumSourceBytes)
    return 'source-byte-count';
  if (state.totalAuthoredModuleCount + proposal.sourcePaths.length > maximumModules)
    return 'total-module-count';
  if (state.supportModuleCount + proposal.supportPaths.size > maximumSupport)
    return 'optional-support-count';
  if (state.authoredEdgeCount + proposal.authoredEdgeCount > maximumEdges)
    return 'authored-edge-count';
  if (unionSize(state.packageDemandPaths, proposal.packageDemandPaths) > maximumPackageDemand)
    return 'package-demand-count';
  if (unionSize(state.barePackages, proposal.barePackages) > maximumBarePackages)
    return 'bare-package-count';
  if (state.styleAndAssetEdgeCount + proposal.styleAndAssetEdgeCount > maximumStyleEdges)
    return 'style-asset-count';
  return undefined;
}

/** Converts optional source failures into a safe component-edge projection reason. */
function optionalFailureReason(
  reason: PreviewCompilerFrontierReason,
): PreviewInspectorProjectedEdge['reason'] {
  return reason === 'single-source-bytes' ? reason : 'source-byte-count';
}

/** Records only an incoming optional edge, never a partially admitted component. */
function appendProjection(
  projections: PreviewInspectorProjectedEdge[],
  item: FrontierSourceQueueItem,
  reason: PreviewInspectorProjectedEdge['reason'],
): void {
  if (item.optionalEdge !== undefined)
    projections.push(Object.freeze({ ...item.optionalEdge, reason }));
}

/** Keeps exact closure ahead of optional transactions and preserves their source order. */
function compareQueueItems(left: FrontierSourceQueueItem, right: FrontierSourceQueueItem): number {
  return (
    queuePriority(left.kind) - queuePriority(right.kind) ||
    left.depth - right.depth ||
    (left.optionalEdge?.importerPath ?? '').localeCompare(right.optionalEdge?.importerPath ?? '') ||
    (left.optionalEdge?.occurrenceStart ?? 0) - (right.optionalEdge?.occurrenceStart ?? 0) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

/** Finishes mandatory exact closure before bounded optional component transactions. */
function queuePriority(kind: FrontierSourceQueueItem['kind']): number {
  return kind === 'exact' ? 0 : kind === 'support' ? 1 : 2;
}

/** Counts current optional support entries; exact sources are deliberately never charged to it. */
function countKinds(kinds: ReadonlyMap<string, AdmittedKind>, kind: AdmittedKind): number {
  return [...kinds.values()].filter((value) => value === kind).length;
}

/** Optional page chrome is bounded by the preferred envelope for Page Execution v2 only. */
function maximumOptionalSurfaceCount(options: PreparePreviewInspectorBundleFrontierOptions): number {
  return options.executionCandidate === undefined
    ? options.policy.maximumOptionalComponentIdentityCount
    : options.policy.softMaximumOptionalComponentIdentityCount;
}

/** Applies the same soft-only rule to recursively discovered optional component identities. */
function maximumOptionalDepth(options: PreparePreviewInspectorBundleFrontierOptions): number {
  return options.executionCandidate === undefined
    ? options.policy.maximumComponentDepth
    : options.policy.softMaximumComponentDepth;
}

/** Preserves visual relation ordering before stable source/export tie breakers. */
function compareVisualPaths(
  left: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
  right: NonNullable<PreviewInspectorAncestorPlan['shallowVisualPaths']>[number],
): number {
  return (
    visualRelationPriority(left.relation) - visualRelationPriority(right.relation) ||
    path.normalize(left.importerPath).localeCompare(path.normalize(right.importerPath)) ||
    left.renderBoundaryStart - right.renderBoundaryStart ||
    left.occurrenceStart - right.occurrenceStart ||
    path.normalize(left.sourcePath).localeCompare(path.normalize(right.sourcePath)) ||
    left.exportName.localeCompare(right.exportName)
  );
}

/** Keeps owner/wrapper paths ahead of sibling and component-prop alternatives. */
function visualRelationPriority(relation: string): number {
  return relation === 'wrapper'
    ? 0
    : relation === 'sibling'
      ? 1
      : relation === 'component-prop'
        ? 2
        : 3;
}

/** Sorts public projection records independently of source read or resolver completion timing. */
function compareProjectedEdges(
  left: PreviewInspectorProjectedEdge,
  right: PreviewInspectorProjectedEdge,
): number {
  return (
    left.importerPath.localeCompare(right.importerPath) ||
    left.occurrenceStart - right.occurrenceStart ||
    left.moduleSpecifier.localeCompare(right.moduleSpecifier)
  );
}

/** Selects only active structured Inspector evidence as exact authored seeds. */
function collectExactSeedPaths(
  plan: PreviewInspectorAncestorPlan,
  executionCandidate: PreviewInspectorPageExecutionCandidate | undefined,
): readonly string[] {
  if (executionCandidate !== undefined)
    return executionCandidate.criticalSurfaces.map((surface) => surface.sourcePath);
  const active = plan.pageCandidates[0];
  const paths = new Set<string>([plan.target.sourcePath, plan.root.sourcePath]);
  const addReference = (reference: { readonly sourcePath: string } | undefined): void => {
    if (reference !== undefined) paths.add(reference.sourcePath);
  };
  if (active !== undefined) {
    addReference(active.root);
    addReference(active.target);
    for (const edge of active.edges) {
      addReference(edge.child);
      addReference(edge.owner);
    }
    /* TODO(plan7 Phase 7/8): replace this broad compatibility inventory with the selected Page
     * Execution Candidate's critical and admitted optional surfaces. Until composition surfaces
     * are wired into the root plugin, retaining it keeps strict metafile membership sound. */
    for (const step of active.renderPath?.steps.slice(active.rootStepIndex ?? 0) ?? []) {
      paths.add(step.sourcePath);
      for (const evidencePath of step.evidenceSourcePaths ?? []) paths.add(evidencePath);
    }
    if (active.routeLocation !== undefined && 'routeMounts' in active.routeLocation) {
      for (const mount of active.routeLocation.routeMounts ?? []) paths.add(mount.sourcePath);
    }
    for (const layout of active.nextAppLayoutChain ?? []) paths.add(layout.sourcePath);
    addReference(active.nextPagesShell?.app);
    for (const contextPath of active.contextModule?.importPath ?? []) paths.add(contextPath);
  }
  for (const edge of plan.edges) {
    addReference(edge.child);
    addReference(edge.owner);
  }
  for (const contextPath of plan.contextModule?.importPath ?? []) paths.add(contextPath);
  return [...paths].map((sourcePath) => path.normalize(sourcePath)).sort();
}

/** Excludes installed dependencies and non-source resources from authored graph accounting. */
function isAuthoredPath(workspaceRoot: string, sourcePath: string): boolean {
  const relative = path.relative(path.normalize(workspaceRoot), path.normalize(sourcePath));
  return (
    relative.length > 0 &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !relative.split(path.sep).includes('node_modules') &&
    SOURCE_MODULE_PATTERN.test(sourcePath)
  );
}

/** Detects syntax failures before native esbuild can allocate an unbounded graph. */
function hasSourceParseFailure(sourcePath: string, sourceText: string): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return (
    ((sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics?.length ?? 0) > 0
  );
}

/** Normalizes package subpaths so each package consumes one demand identity. */
function normalizeBarePackageSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:'))
    return undefined;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

/** Returns reasons in the documented deterministic budget-check order. */
function sortReasons(
  reasons: ReadonlySet<PreviewCompilerFrontierReason>,
): readonly PreviewCompilerFrontierReason[] {
  const ordered: readonly PreviewCompilerFrontierReason[] = [
    'single-source-bytes',
    'exact-module-count',
    'source-byte-count',
    'total-module-count',
    'optional-component-count',
    'optional-support-count',
    'authored-edge-count',
    'component-depth',
    'package-demand-count',
    'bare-package-count',
    'style-asset-count',
    'exact-source-bytes',
    'exact-source-unreadable',
    'source-parse-failure',
    'frontier-mismatch',
  ];
  return ordered.filter((reason) => reasons.has(reason));
}

/** Produces a context-reuse key from immutable membership and fixed policy values. */
function createFrontierIdentity(
  policy: PreviewCompilerFrontierPolicy,
  executionCandidate: PreviewInspectorPageExecutionCandidate | undefined,
  authenticSourcePaths: readonly string[],
  exactSourcePaths: readonly string[],
  packageDemandSourcePaths: readonly string[],
  components: PreviewInspectorBundleFrontier['authenticComponentExports'],
  projectedEdges: readonly PreviewInspectorProjectedEdge[],
  summary: PreviewInspectorBundleFrontier['summary'],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        authenticSourcePaths,
        components,
        executionCandidate:
          executionCandidate === undefined
            ? undefined
            : {
                compositionEdges: executionCandidate.compositionEdges,
                fidelity: executionCandidate.fidelity,
                id: executionCandidate.id,
                optionalSurfaces: executionCandidate.optionalSurfaces,
                routeRecipe: executionCandidate.routeRecipe,
                surfaces: executionCandidate.criticalSurfaces,
              },
        exactSourcePaths,
        packageDemandSourcePaths,
        policy,
        projectedEdges,
        summary,
        version:
          executionCandidate === undefined
            ? FRONTIER_FORMAT_VERSION
            : PAGE_EXECUTION_FRONTIER_FORMAT_VERSION,
      }),
    )
    .digest('hex');
}
