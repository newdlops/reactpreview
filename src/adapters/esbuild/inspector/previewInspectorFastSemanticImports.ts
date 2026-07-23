/**
 * Classifies fast-corridor import edges with export-aware React render evidence.
 *
 * Module-path reachability alone is insufficient for barrel modules: an application shell may
 * render `PublicPage` from a barrel while the selected component belongs to `DashboardPage` from
 * the same file. Treating both imports as the same edge creates a short but impossible page path.
 * This module keeps the first-paint traversal bounded while attaching the requested child exports,
 * the owner exports that carry them, and syntax-proven JSX/lazy/HOC strength to every resolved
 * import. Project code is parsed as inert TypeScript syntax and is never evaluated.
 */
import path from 'node:path';
import { analyzePreviewRenderSource } from '../renderGraph/previewRenderSourceAnalysis';
import type { PreviewRenderInvocationMode } from '../renderGraph/previewRenderGraphTypes';
import type {
  PreviewRenderLocalEdgeFact,
  PreviewRenderModuleFacts,
} from '../renderGraph/previewRenderModuleFacts';

/** Minimal resolved identity supplied by the fast corridor's alias-aware resolver. */
export interface PreviewInspectorFastResolvedImport {
  /** Absolute authored module reached by this import. */
  readonly childPath: string;
  /** Literal specifier written in the owner source. */
  readonly moduleSpecifier: string;
}

/** One resolved edge enriched with static component and export-flow evidence. */
export interface PreviewInspectorFastSemanticImport {
  /** Absolute authored child source. */
  readonly childPath: string;
  /** Literal import specifier retained for diagnostics and deterministic matching. */
  readonly moduleSpecifier: string;
  /**
   * Public exports of the owner whose value-flow reaches this child.
   *
   * `*` means syntax could not narrow the carrying export and deliberately keeps the safe fallback
   * open rather than deleting a valid legacy CommonJS or generated-wrapper path.
   */
  readonly ownerExportNames: readonly string[];
  /** Public exports requested from the child by import, re-export, or React.lazy syntax. */
  readonly requestedExportNames: readonly string[];
  /** 0 = unresolved/plain import, 1 = value transport, 2 = JSX/lazy/HOC/route render evidence. */
  readonly renderStrength: 0 | 1 | 2;
}

/** React invocation modes that prove a component value is transported toward rendered output. */
const STRONG_INVOCATION_MODES: ReadonlySet<PreviewRenderInvocationMode> = new Set([
  'component-prop',
  'create-element',
  'forward-ref',
  'hoc',
  'jsx',
  'memo',
  'polymorphic-prop',
  'render-prop',
  'styled',
]);

/**
 * Enriches already-resolved imports without performing any additional filesystem or resolver work.
 *
 * One AST parse is shared by every edge from the owner. Local value-flow is walked from each
 * imported binding toward exported declarations, allowing ordinary wrapper functions, route
 * objects, HOCs, and lazy declarations to remain visible without mistaking an unused config import
 * for a rendered page relationship.
 */
export function analyzePreviewInspectorFastSemanticImports(
  ownerPath: string,
  sourceText: string,
  resolvedImports: readonly PreviewInspectorFastResolvedImport[],
): readonly PreviewInspectorFastSemanticImport[] {
  if (resolvedImports.length === 0) return Object.freeze([]);
  const facts = analyzePreviewRenderSource(ownerPath, sourceText).moduleFacts;
  return Object.freeze(
    resolvedImports.map((resolvedImport) =>
      analyzeResolvedImport(
        facts,
        path.normalize(resolvedImport.childPath),
        resolvedImport.moduleSpecifier,
      ),
    ),
  );
}

/**
 * Checks whether an import/re-export request can enter the target-side export corridor.
 *
 * Empty and wildcard sets are intentionally compatible: they represent conservative legacy or
 * CommonJS uncertainty. Two non-wildcard sets must share an exact export spelling, which prevents
 * unrelated exports from the same barrel from being joined.
 */
export function arePreviewInspectorFastExportDemandsCompatible(
  requestedNames: readonly string[],
  requiredNames: readonly string[] | undefined,
): boolean {
  if (
    requiredNames === undefined ||
    requiredNames.length === 0 ||
    requestedNames.length === 0 ||
    requestedNames.includes('*') ||
    requiredNames.includes('*')
  ) {
    return true;
  }
  const required = new Set(requiredNames);
  return requestedNames.some((name) => required.has(name));
}

/** Analyzes one child specifier against the shared module facts. */
function analyzeResolvedImport(
  facts: PreviewRenderModuleFacts,
  childPath: string,
  moduleSpecifier: string,
): PreviewInspectorFastSemanticImport {
  const cleanSpecifier = stripLoaderSuffix(moduleSpecifier);
  const staticImports = facts.imports.filter(
    (fact) => stripLoaderSuffix(fact.moduleSpecifier) === cleanSpecifier,
  );
  const lazyImports = facts.lazyImports.filter(
    (fact) => stripLoaderSuffix(fact.moduleSpecifier) === cleanSpecifier,
  );
  const directReexports = facts.exports.filter(
    (fact) =>
      fact.moduleSpecifier !== undefined &&
      stripLoaderSuffix(fact.moduleSpecifier) === cleanSpecifier,
  );
  const requestedExportNames = new Set<string>();
  const reachableLocalNames = new Set<string>();
  const reachableOwnerIds = new Set<string>();
  const directOwnerExports = new Set<string>();

  for (const fact of staticImports) {
    requestedExportNames.add(fact.importedName);
    reachableLocalNames.add(fact.localName);
  }
  for (const fact of lazyImports) {
    requestedExportNames.add(fact.importedName);
    reachableOwnerIds.add(fact.ownerId);
  }
  for (const fact of directReexports) {
    requestedExportNames.add(fact.wildcard ? '*' : (fact.reexportedName ?? fact.exportName));
    directOwnerExports.add(fact.wildcard ? '*' : fact.exportName);
  }

  const ownerById = new Map(facts.values.map((value) => [value.id, value]));
  for (const ownerId of reachableOwnerIds) {
    const owner = ownerById.get(ownerId);
    if (owner !== undefined) reachableLocalNames.add(owner.localName);
  }
  const traversedEdges = collectCarryingEdges(facts, reachableLocalNames, ownerById);
  const ownerExportNames = new Set(directOwnerExports);
  for (const fact of facts.exports) {
    if (fact.localName !== undefined && reachableLocalNames.has(fact.localName)) {
      ownerExportNames.add(fact.exportName);
    }
  }

  return Object.freeze({
    childPath,
    moduleSpecifier,
    ownerExportNames: freezeNames(ownerExportNames.size > 0 ? ownerExportNames : new Set(['*'])),
    requestedExportNames: freezeNames(
      requestedExportNames.size > 0 ? requestedExportNames : new Set(['*']),
    ),
    renderStrength: classifyRenderStrength(
      staticImports.map((fact) => fact.localName),
      lazyImports.length > 0 || directReexports.length > 0,
      traversedEdges,
    ),
  });
}

/** Propagates imported values outward through declarations until a fixed point is reached. */
function collectCarryingEdges(
  facts: PreviewRenderModuleFacts,
  reachableLocalNames: Set<string>,
  ownerById: ReadonlyMap<string, PreviewRenderModuleFacts['values'][number]>,
): readonly PreviewRenderLocalEdgeFact[] {
  const carryingEdges: PreviewRenderLocalEdgeFact[] = [];
  const seenEdges = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of facts.localEdges) {
      if (!reachableLocalNames.has(edge.childLocalName)) continue;
      const edgeKey = `${edge.ownerId}\0${edge.childLocalName}\0${edge.occurrenceStart.toString()}`;
      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        carryingEdges.push(edge);
      }
      const owner = ownerById.get(edge.ownerId);
      if (owner !== undefined && !reachableLocalNames.has(owner.localName)) {
        reachableLocalNames.add(owner.localName);
        changed = true;
      }
    }
  }
  return Object.freeze(carryingEdges);
}

/** Assigns a compact semantic priority without embedding project-specific component names. */
function classifyRenderStrength(
  importedLocalNames: readonly string[],
  hasLazyOrReexport: boolean,
  edges: readonly PreviewRenderLocalEdgeFact[],
): 0 | 1 | 2 {
  if (hasLazyOrReexport) return 2;
  if (edges.some(isStrongRenderEdge)) return 2;
  if (edges.length > 0 || importedLocalNames.some(isComponentShapedName)) return 1;
  return 0;
}

/** Requires component-shaped route values so ordinary route/path helpers remain weak evidence. */
function isStrongRenderEdge(edge: PreviewRenderLocalEdgeFact): boolean {
  if (edge.kind === 'component-render' || edge.kind === 'create-element') return true;
  if (edge.invocation !== undefined && STRONG_INVOCATION_MODES.has(edge.invocation.mode)) {
    return true;
  }
  return edge.kind === 'route-branch' && isComponentShapedName(edge.childLocalName);
}

/** Default imports and PascalCase bindings are the only name-only component hints admitted. */
function isComponentShapedName(name: string): boolean {
  return name === 'default' || /^[A-Z][A-Za-z0-9_$]*$/u.test(name);
}

/** Removes loader query/hash syntax before matching facts to the coarse import inventory. */
function stripLoaderSuffix(moduleSpecifier: string): string {
  return moduleSpecifier.split(/[?#]/u, 1)[0] ?? moduleSpecifier;
}

/** Produces deterministic immutable export-name arrays for candidate state keys and diagnostics. */
function freezeNames(names: ReadonlySet<string>): readonly string[] {
  return Object.freeze([...names].sort((left, right) => left.localeCompare(right)));
}
