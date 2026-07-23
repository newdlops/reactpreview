/**
 * Converts an already proven target-to-entry render path into importable component checkpoints.
 * The render graph intentionally contains helper values, route arrays, lazy registries, and app
 * selectors; this adapter keeps only public component-shaped identities that a webview can mount.
 */
import path from 'node:path';
import {
  analyzePreviewLocalParentSlices,
  analyzePreviewParentSlices,
  type MatchesPreviewParentSliceTargetImport,
  type PreviewParentSliceStaticProps,
} from '../parentSlice';
import type { PreviewRenderChainCandidate, PreviewRenderInvocationMode } from '../renderGraph';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';
import { collectPreviewRouterRequirement } from '../previewRouterRequirement';
import {
  collectReactExportPropInference,
  type PreviewInferredExportProps,
} from '../staticResources/reactExportPropInference';
import { isPreviewInspectorComponentShapedExport } from './previewInspectorOwnerShape';

const MAX_RENDER_PATH_ROOTS = 12;
const MAX_EXPORT_COMPONENT_TRANSPORT_DEPTH = 8;

/** Minimal public component identity shared structurally with the ancestor planner. */
export interface PreviewInspectorRenderPathReference {
  readonly exportName: string;
  readonly sourcePath: string;
}

/** One mountable export recovered from a value-flow/lazy/render graph step. */
export interface PreviewInspectorRenderPathRoot {
  /** True when this is the last public component before a proven ReactDOM entry. */
  readonly outermost: boolean;
  /** Importable component export that can reproduce this level of authored context. */
  readonly reference: PreviewInspectorRenderPathReference;
  /** Index into the candidate's inner-to-outer render steps. */
  readonly stepIndex: number;
}

/** Shared fulfilled-read cache used across alternative render paths and root inference. */
export type PreviewInspectorSourcePromiseCache = Map<string, Promise<string | undefined>>;

/** Inputs for extracting public component checkpoints from one exact render path. */
export interface CollectPreviewInspectorRenderPathRootsOptions {
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly renderPath: PreviewRenderChainCandidate;
  readonly sourceCache: PreviewInspectorSourcePromiseCache;
  readonly target: PreviewInspectorRenderPathReference;
}

/** Inputs for recovering literal props from the exact next render-path caller modules. */
export interface ReadPreviewInspectorRenderPathRootPropsOptions {
  readonly acceptedImportSpecifiers: readonly string[];
  readonly matchesTargetImport?: MatchesPreviewParentSliceTargetImport;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly renderPath: PreviewRenderChainCandidate;
  readonly root: PreviewInspectorRenderPathRoot;
  readonly sourceCache: PreviewInspectorSourcePromiseCache;
}

/** Inputs for deciding whether one independently mounted page root already contains a Router. */
export interface ReadPreviewInspectorRootRouterOwnershipOptions {
  readonly ownershipCache: Map<string, Promise<boolean>>;
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly reference: PreviewInspectorRenderPathReference;
  readonly renderPath: PreviewRenderChainCandidate | undefined;
  readonly rootStepIndex: number | undefined;
  readonly sourceCache: PreviewInspectorSourcePromiseCache;
}

/**
 * Returns inner-to-outer public component exports while excluding route/configuration values.
 * Export participation in a proven render path is the safety boundary: arbitrary PascalCase
 * constants elsewhere in the file are never promoted merely because of their spelling.
 */
export async function collectPreviewInspectorRenderPathRoots(
  options: CollectPreviewInspectorRenderPathRootsOptions,
): Promise<readonly PreviewInspectorRenderPathRoot[]> {
  const roots: Omit<PreviewInspectorRenderPathRoot, 'outermost'>[] = [];
  const seen = new Set<string>();

  for (const [stepIndex, step] of options.renderPath.steps.entries()) {
    if (roots.length >= MAX_RENDER_PATH_ROOTS) break;
    const normalizedSourcePath = path.normalize(step.sourcePath);
    const sourceText = await readCachedSource(
      normalizedSourcePath,
      options.readSource,
      options.sourceCache,
    );
    if (sourceText === undefined) continue;
    const reference = selectStepComponentReference(normalizedSourcePath, sourceText, step.label);
    if (reference === undefined || isSameReference(reference, options.target)) continue;
    const key = createReferenceKey(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    roots.push({ reference, stepIndex });
  }

  const outermostIndex = roots.at(-1)?.stepIndex;
  return Object.freeze(
    roots.map((root) => Object.freeze({ ...root, outermost: root.stepIndex === outermostIndex })),
  );
}

/**
 * Reads one candidate root's neutral props recipe without importing or evaluating its module.
 * Results, including the absence of inference, are cached per exact module/export identity.
 */
export async function readPreviewInspectorRootInference(
  reference: PreviewInspectorRenderPathReference,
  readSource: (sourcePath: string) => Promise<string | undefined>,
  sourceCache: PreviewInspectorSourcePromiseCache,
  inferenceCache: Map<string, Promise<PreviewInferredExportProps | undefined>>,
): Promise<PreviewInferredExportProps | undefined> {
  const key = createReferenceKey(reference);
  const cached = inferenceCache.get(key);
  if (cached !== undefined) return cached;
  const inferencePromise = (async (): Promise<PreviewInferredExportProps | undefined> => {
    const sourceText = await readCachedSource(reference.sourcePath, readSource, sourceCache);
    return sourceText === undefined
      ? undefined
      : collectReactExportPropInference(reference.sourcePath, sourceText)[reference.exportName];
  })();
  inferenceCache.set(key, inferencePromise);
  return inferencePromise;
}

/**
 * Reports whether the selected mount root's target-facing render branch creates its own Router.
 * Graph-wide ownership is intentionally insufficient here: Page Inspector can mount a component
 * that normally lives below an application Router without mounting that Router itself. Only
 * modules at or below this exact root checkpoint participate in the decision.
 */
export async function readPreviewInspectorRootOwnsRouter(
  options: ReadPreviewInspectorRootRouterOwnershipOptions,
): Promise<boolean> {
  const inferredRootStepIndex =
    options.rootStepIndex ?? findReferenceStepIndex(options.reference, options.renderPath);
  const sourcePaths = new Set<string>([path.normalize(options.reference.sourcePath)]);
  if (inferredRootStepIndex !== undefined) {
    for (const step of options.renderPath?.steps.slice(0, inferredRootStepIndex + 1) ?? []) {
      sourcePaths.add(path.normalize(step.sourcePath));
    }
  }
  for (const sourcePath of sourcePaths) {
    let ownership = options.ownershipCache.get(sourcePath);
    if (ownership === undefined) {
      ownership = readCachedSource(sourcePath, options.readSource, options.sourceCache).then(
        (sourceText) =>
          sourceText === undefined
            ? false
            : collectPreviewRouterRequirement(sourcePath, sourceText).ownsRouter,
      );
      options.ownershipCache.set(sourcePath, ownership);
    }
    if (await ownership) return true;
  }
  return false;
}

/**
 * Reads primitive props from the nearest exact caller on the selected render path.
 * Only path modules are inspected, avoiding another workspace-wide reverse scan for each offered
 * root. Dynamic expressions remain the responsibility of root-local type/usage inference.
 */
export async function readPreviewInspectorRenderPathRootAutomaticProps(
  options: ReadPreviewInspectorRenderPathRootPropsOptions,
): Promise<PreviewParentSliceStaticProps> {
  const rootStep = options.renderPath.steps[options.root.stepIndex];
  const expectedOccurrence = rootStep?.occurrenceStart;
  for (const step of options.renderPath.steps.slice(options.root.stepIndex + 1)) {
    const consumerPath = path.normalize(step.sourcePath);
    const sourceText = await readCachedSource(
      consumerPath,
      options.readSource,
      options.sourceCache,
    );
    if (!sourceText?.includes('<')) continue;
    const slices =
      consumerPath === path.normalize(options.root.reference.sourcePath)
        ? analyzePreviewLocalParentSlices({
            consumerPath,
            localComponentName: normalizeStepLabel(rootStep?.label ?? ''),
            sourceText,
          }).slices
        : analyzePreviewParentSlices({
            acceptedTargetImportSpecifiers: options.acceptedImportSpecifiers,
            consumerPath,
            ...(options.matchesTargetImport === undefined
              ? {}
              : { matchesTargetImport: options.matchesTargetImport }),
            sourceText,
            targetExportNames: [options.root.reference.exportName],
            targetPath: options.root.reference.sourcePath,
          }).slices;
    const selected = selectNearestOccurrence(slices, expectedOccurrence);
    if (selected !== undefined) return selected.targetProps;
  }
  return Object.freeze({});
}

/** Selects the occurrence that contributed the render edge when several callers share one file. */
function selectNearestOccurrence<T extends { readonly occurrenceStart: number }>(
  slices: readonly T[],
  expectedOccurrence: number | undefined,
): T | undefined {
  if (expectedOccurrence === undefined) return slices[0];
  return [...slices].sort(
    (left, right) =>
      Math.abs(left.occurrenceStart - expectedOccurrence) -
      Math.abs(right.occurrenceStart - expectedOccurrence),
  )[0];
}

/** Finds the outermost path step supplied by the same module as a non-checkpoint candidate root. */
function findReferenceStepIndex(
  reference: PreviewInspectorRenderPathReference,
  renderPath: PreviewRenderChainCandidate | undefined,
): number | undefined {
  const normalizedReferencePath = path.normalize(reference.sourcePath);
  for (let index = (renderPath?.steps.length ?? 0) - 1; index >= 0; index -= 1) {
    if (path.normalize(renderPath?.steps[index]?.sourcePath ?? '') === normalizedReferencePath) {
      return index;
    }
  }
  return undefined;
}

/** Maps a render node label back to a public export supplied by the same top-level value. */
function selectStepComponentReference(
  sourcePath: string,
  sourceText: string,
  stepLabel: string,
): PreviewInspectorRenderPathReference | undefined {
  const facts = collectPreviewRenderModuleFacts(sourcePath, sourceText);
  const label = normalizeStepLabel(stepLabel);
  const matchingValues = facts.values.filter(
    (value) => value.localName === label || value.label === label,
  );
  const matchingLocalNames = new Set(matchingValues.map((value) => value.localName));
  const matchingExports = facts.exports.filter(
    (exportFact) =>
      !exportFact.wildcard &&
      (exportFact.exportName === 'default' || /^\p{Lu}/u.test(exportFact.exportName)) &&
      ((exportFact.localName !== undefined && matchingLocalNames.has(exportFact.localName)) ||
        (exportFact.localName !== undefined &&
          doesExportTransportComponentLabel(facts, exportFact.localName, label)) ||
        (matchingValues.length === 0 && exportFact.exportName === label)),
  );
  const exportNames = matchingExports.map((exportFact) => exportFact.exportName);
  if (exportNames.length === 0 || !isComponentLikeStepLabel(label)) return undefined;
  const exportName = selectPreferredExportName(exportNames, label);
  const exportFact = matchingExports.find((candidate) => candidate.exportName === exportName);
  if (
    !isPreviewInspectorComponentShapedExport({
      exportName,
      ...(exportFact?.localName === undefined ? {} : { localName: exportFact.localName }),
      sourcePath,
      sourceText,
    })
  ) {
    return undefined;
  }
  return Object.freeze({
    exportName,
    sourcePath,
  });
}

/**
 * Follows a bounded component-only value pipeline from a public export to one render-path label.
 *
 * `export default withPermission(withStaff(Page))` exposes `@default` in module facts while the
 * render path correctly names `Page`. Requiring the same-module HOC/memo/styled/forward-ref edge
 * reconnects those identities without promoting arbitrary default-exported route data or helper
 * expressions into mount roots.
 */
function doesExportTransportComponentLabel(
  facts: ReturnType<typeof collectPreviewRenderModuleFacts>,
  exportLocalName: string,
  componentLabel: string,
): boolean {
  if (!isComponentLikeStepLabel(componentLabel)) return false;
  const valueByLocalName = new Map(facts.values.map((value) => [value.localName, value]));
  const pending: { readonly depth: number; readonly localName: string }[] = [
    { depth: 0, localName: exportLocalName },
  ];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(current.localName)) continue;
    visited.add(current.localName);
    if (current.localName === componentLabel) return true;
    if (current.depth >= MAX_EXPORT_COMPONENT_TRANSPORT_DEPTH) continue;
    const value = valueByLocalName.get(current.localName);
    if (value === undefined) continue;
    for (const edge of facts.localEdges) {
      if (
        edge.ownerId !== value.id ||
        !isComponentTransportInvocation(edge.invocation?.mode) ||
        visited.has(edge.childLocalName)
      ) {
        continue;
      }
      pending.push({ depth: current.depth + 1, localName: edge.childLocalName });
    }
  }
  return false;
}

/** Restricts public-export traversal to React component identity-preserving wrappers. */
function isComponentTransportInvocation(mode: PreviewRenderInvocationMode | undefined): boolean {
  return mode === 'hoc' || mode === 'memo' || mode === 'styled' || mode === 'forward-ref';
}

/** Removes the display-only suffix used for a named declaration exported as default. */
function normalizeStepLabel(stepLabel: string): string {
  return stepLabel.replace(/ \(default\)$/u, '');
}

/** Requires a conventional component declaration label even for default exports. */
function isComponentLikeStepLabel(label: string): boolean {
  return /^\p{Lu}/u.test(label) && !/^[A-Z\d_]+$/u.test(label);
}

/** Prefers default for one declaration, otherwise its matching public/component export name. */
function selectPreferredExportName(exportNames: readonly string[], label: string): string {
  if (exportNames.includes('default')) return 'default';
  if (exportNames.includes(label)) return label;
  return [...exportNames].sort()[0] ?? 'default';
}

/** Memoizes project reads by normalized path without retaining parser nodes. */
function readCachedSource(
  sourcePath: string,
  readSource: (sourcePath: string) => Promise<string | undefined>,
  sourceCache: PreviewInspectorSourcePromiseCache,
): Promise<string | undefined> {
  const normalizedPath = path.normalize(sourcePath);
  const cached = sourceCache.get(normalizedPath);
  if (cached !== undefined) return cached;
  const sourcePromise = readSource(normalizedPath);
  sourceCache.set(normalizedPath, sourcePromise);
  return sourcePromise;
}

/** Produces a stable cache/deduplication identity for one exact public export. */
function createReferenceKey(reference: PreviewInspectorRenderPathReference): string {
  return `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
}

/** Compares references after path normalization so aliases cannot duplicate a checkpoint. */
function isSameReference(
  left: PreviewInspectorRenderPathReference,
  right: PreviewInspectorRenderPathReference,
): boolean {
  return (
    left.exportName === right.exportName &&
    path.normalize(left.sourcePath) === path.normalize(right.sourcePath)
  );
}
