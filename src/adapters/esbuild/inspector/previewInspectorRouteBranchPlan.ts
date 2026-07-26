/**
 * Resolves one lightweight, hierarchical router branch without bundling sibling pages.
 *
 * A selected App can own hundreds of routes, and one route can mount another router module. This
 * planner keeps every currently discovered sibling as inert metadata, follows only the selected
 * branch, and automatically descends through router-only modules until a renderable leaf is found.
 * It never imports or executes application code in the extension host.
 */
import path from 'node:path';
import type { PreviewInspectorRouteSelectionStep } from '../../../domain/preview';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import {
  collectPreviewInspectorRouteLocationInventory,
  type PreviewInspectorRouteLocation,
} from './previewInspectorRouteLocation';
import {
  materializePreviewInspectorRoutePattern,
  normalizePreviewInspectorRoutePattern,
} from './previewInspectorRoutePattern';
import { createPreviewInspectorRouteBranchId } from './previewInspectorRouteBranchIdentity';

const MAXIMUM_ROUTE_OWNER_DEPTH = 8;

/** Browser-safe hierarchy record for one statically proven route choice. */
export interface PreviewInspectorRouteBranch {
  /** A disabled branch remains visible when static route proof is incomplete. */
  readonly availability?:
    | 'catalog-unresolved'
    | 'component-unresolved'
    | 'submodule-base-unresolved'
    | 'factory-contract-unresolved';
  /** Whether the selected analysis path proved children, proved a leaf, or has not inspected it. */
  readonly childState: 'expanded' | 'leaf' | 'unknown';
  /** Public component/export identity rendered by this branch. */
  readonly componentName: string;
  /** Nesting depth below the selected source router owner. */
  readonly depth: number;
  /** Stable opaque identity used by the route explorer and diagnostics. */
  readonly id: string;
  /** Parent route identity when this choice belongs to a nested router module. */
  readonly parentId?: string;
  /** Browser-ready path with neutral values substituted for dynamic parameters. */
  readonly pathname: string;
  /** Authored absolute route pattern. */
  readonly pattern: string;
  /** Full compiler-verifiable branch chain sent back when the user chooses this item. */
  readonly selectionPath: readonly PreviewInspectorRouteSelectionStep[];
  /** Only selectable branches can produce a route-selection protocol payload. */
  readonly selectable?: boolean;
  /** Resolved page/router module retained only by compiler-side corridor planning. */
  readonly sourcePath?: string;
}

/** Active leaf plus all metadata needed to browse its direct and recursively selected siblings. */
export interface PreviewInspectorRouteBranchPlan {
  /** Final leaf route imported by the generated page candidate. */
  readonly activeLocation?: PreviewInspectorRouteLocation;
  /** Every choice at the root plus the expanded choices along the active route chain. */
  readonly branches: readonly PreviewInspectorRouteBranch[];
  /** Route owner/catalog files that should invalidate hierarchy metadata during hot reload. */
  readonly dependencyPaths: readonly string[];
  /** Outermost importable route owner needed to preserve nested Router params/providers. */
  readonly executionRoot?: {
    readonly basePattern: string;
    readonly exportName: string;
    readonly sourcePath: string;
  };
  /** Historical direct location for non-router targets and route-owner diagnostics. */
  readonly primary?: PreviewInspectorRouteLocation;
  /** Opaque active branch identity serialized beside browser route metadata. */
  readonly selectedBranchId?: string;
  /** Explains whether the requested route was accepted or the deterministic default was used. */
  readonly selectionResolution?: 'automatic' | 'exact' | 'fallback';
}

/** Inputs reuse the existing route analyzer and package-bounded source resolver. */
export interface CollectPreviewInspectorRouteBranchPlanOptions {
  /** Selected source module that begins route exploration. */
  readonly documentPath: string;
  /** Exact selected runtime export, including `default`. */
  readonly exportName: string;
  /** Snapshot-aware source reader. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Project-aware resolver for route page imports and catalogs. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Target-to-entry evidence used to rank routes and materialize dynamic parameters. */
  readonly renderChain: PreviewRenderChainPlan;
  /** User-selected nested route chain; stale/unproven steps are ignored safely. */
  readonly selection?: readonly PreviewInspectorRouteSelectionStep[];
  /** Existing bounded source inventory shared with ordinary route analysis. */
  readonly sourcePaths: readonly string[];
}

/** Mutable branch record used only while a selected nested owner is being inspected. */
interface MutableRouteBranch {
  readonly availability?: PreviewInspectorRouteBranch['availability'];
  childState: PreviewInspectorRouteBranch['childState'];
  readonly componentName: string;
  readonly depth: number;
  readonly id: string;
  readonly parentId?: string;
  readonly pathname: string;
  readonly pattern: string;
  readonly selectionPath: readonly PreviewInspectorRouteSelectionStep[];
  readonly selectable: boolean;
  readonly sourcePath?: string;
}

/**
 * Collects all immediate choices but recursively analyzes only the selected branch.
 *
 * With no user selection the shortest/index-like route becomes the initial branch. If that choice
 * is another router owner, its first route is followed in the same bounded pass so Provider-only
 * intermediate components do not become a misleading “ran but nothing visible” endpoint.
 */
export async function collectPreviewInspectorRouteBranchPlan(
  options: CollectPreviewInspectorRouteBranchPlanOptions,
): Promise<PreviewInspectorRouteBranchPlan> {
  const branches: MutableRouteBranch[] = [];
  const dependencies = new Set<string>([path.normalize(options.documentPath)]);
  const selectedComponentPaths: string[] = [];
  const visitedOwners = new Set<string>();
  let activeLocation: PreviewInspectorRouteLocation | undefined;
  let ownerPath = path.normalize(options.documentPath);
  let ownerExportName = options.exportName;
  let parentBranch: MutableRouteBranch | undefined;
  let primary: PreviewInspectorRouteLocation | undefined;
  let selectionPath: readonly PreviewInspectorRouteSelectionStep[] = Object.freeze([]);
  let selectionResolution: PreviewInspectorRouteBranchPlan['selectionResolution'];

  for (let depth = 0; depth < MAXIMUM_ROUTE_OWNER_DEPTH; depth += 1) {
    const ownerIdentity = `${ownerPath}\0${ownerExportName}`;
    if (visitedOwners.has(ownerIdentity)) break;
    visitedOwners.add(ownerIdentity);
    const inventory = await collectPreviewInspectorRouteLocationInventory({
      documentPath: ownerPath,
      exportName: ownerExportName,
      readSource: options.readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      renderChain: options.renderChain,
      sourcePaths: options.sourcePaths,
    });
    if (depth === 0) primary = inventory.primary;
    for (const dependencyPath of inventory.primary?.dependencyPaths ?? []) {
      if (
        inventory.primary?.componentSourcePath === undefined ||
        path.normalize(dependencyPath) !== path.normalize(inventory.primary.componentSourcePath)
      ) {
        dependencies.add(path.normalize(dependencyPath));
      }
    }
    const parentLocation = activeLocation;
    const levelChoices =
      parentLocation === undefined
        ? inventory.choices
        : inventory.choices.map((choice) => composeNestedRouteChoice(parentLocation, choice));
    collectRouteMetadataDependencies(levelChoices, dependencies);
    for (const unresolved of inventory.unresolvedFactoryOptions ?? []) {
      const unresolvedPath = Object.freeze([
        ...selectionPath,
        Object.freeze({ componentName: unresolved.componentName, pattern: '<unresolved>' }),
      ]);
      branches.push({
        availability: unresolved.availability,
        childState: 'unknown',
        componentName: unresolved.componentName,
        depth,
        id: createPreviewInspectorRouteBranchId(unresolvedPath),
        ...(parentBranch === undefined ? {} : { parentId: parentBranch.id }),
        pathname: '',
        pattern: '<unresolved>',
        selectable: false,
        selectionPath: Object.freeze([]),
      });
    }
    if (levelChoices.length === 0) {
      if (parentBranch !== undefined) parentBranch.childState = 'leaf';
      break;
    }

    const desired = options.selection?.[depth];
    const requested =
      desired === undefined
        ? undefined
        : levelChoices.find(
            (choice) =>
              choice.componentName === desired.componentName && choice.pattern === desired.pattern,
          );
    const selected = requested ?? selectDefaultRouteChoice(levelChoices, inventory.primary);
    if (selected === undefined) break;
    if (selectionResolution === undefined) {
      selectionResolution =
        desired === undefined ? 'automatic' : requested === undefined ? 'fallback' : 'exact';
    } else if (desired !== undefined && requested === undefined) {
      selectionResolution = 'fallback';
    }
    const levelBranches = levelChoices.map((choice) => {
      const nextSelectionPath = Object.freeze([
        ...selectionPath,
        Object.freeze({ componentName: choice.componentName, pattern: choice.pattern }),
      ]);
      const branch: MutableRouteBranch = {
        childState: 'unknown',
        componentName: choice.componentName,
        depth,
        id: createPreviewInspectorRouteBranchId(nextSelectionPath),
        ...(parentBranch === undefined ? {} : { parentId: parentBranch.id }),
        pathname: choice.pathname,
        pattern: choice.pattern,
        selectable: true,
        selectionPath: nextSelectionPath,
        ...(choice.componentSourcePath === undefined
          ? {}
          : { sourcePath: choice.componentSourcePath }),
      };
      branches.push(branch);
      return { branch, choice };
    });
    const selectedRecord = levelBranches.find((item) => item.choice === selected);
    if (selectedRecord === undefined) break;
    if (parentBranch !== undefined) parentBranch.childState = 'expanded';
    parentBranch = selectedRecord.branch;
    selectionPath = selectedRecord.branch.selectionPath;
    activeLocation = selected;
    for (const dependencyPath of selected.dependencyPaths) dependencies.add(dependencyPath);
    if (selected.componentSourcePath === undefined) {
      parentBranch.childState = 'leaf';
      break;
    }
    const selectedSourcePath = path.normalize(selected.componentSourcePath);
    selectedComponentPaths.push(selectedSourcePath);
    dependencies.add(selectedSourcePath);
    ownerPath = selectedSourcePath;
    ownerExportName = selected.componentExportName ?? 'default';
  }

  const activeWithCorridor =
    activeLocation === undefined
      ? undefined
      : Object.freeze({
          ...activeLocation,
          componentSourcePaths: Object.freeze([...new Set(selectedComponentPaths)]),
          dependencyPaths: Object.freeze(
            [...new Set([...activeLocation.dependencyPaths, ...selectedComponentPaths])].sort(),
          ),
        });
  return Object.freeze({
    ...(activeWithCorridor === undefined ? {} : { activeLocation: activeWithCorridor }),
    branches: Object.freeze(branches.map(freezeRouteBranch)),
    dependencyPaths: Object.freeze([...dependencies].sort()),
    ...(activeWithCorridor?.routeMounts?.[0] === undefined
      ? {}
      : {
          executionRoot: Object.freeze({
            basePattern: activeWithCorridor.routeMounts[0].basePath,
            exportName: activeWithCorridor.routeMounts[0].exportName,
            sourcePath: activeWithCorridor.routeMounts[0].sourcePath,
          }),
        }),
    ...(primary === undefined ? {} : { primary }),
    ...(parentBranch === undefined ? {} : { selectedBranchId: parentBranch.id }),
    ...(selectionResolution === undefined ? {} : { selectionResolution }),
  });
}

/**
 * Composes a child router's relative-looking normalized paths beneath its selected parent route.
 *
 * Every route analyzer emits absolute normalized strings, so `/settings` can mean either an actual
 * root path or a nested router's authored `settings`. React Router requires a nested absolute path
 * to include its parent prefix; therefore a child already under that prefix is preserved, while
 * every other child is safely joined below the parent's non-splat base.
 */
function composeNestedRouteChoice(
  parent: PreviewInspectorRouteLocation,
  child: PreviewInspectorRouteLocation,
): PreviewInspectorRouteLocation {
  const parentBase = parent.pattern.replace(/\/\*+$/u, '').replace(/\/+$/u, '');
  if (
    parentBase.length === 0 ||
    child.pattern === parentBase ||
    child.pattern.startsWith(`${parentBase}/`)
  ) {
    return withComposedRouteMounts(parent, child);
  }
  const childSuffix = child.pattern === '/' ? '' : child.pattern.replace(/^\/+/u, '');
  const pattern = normalizePreviewInspectorRoutePattern(`${parentBase}/${childSuffix}`);
  if (pattern === undefined) return withComposedRouteMounts(parent, child);
  return withComposedRouteMounts(
    parent,
    Object.freeze({
      ...child,
      pathname: materializePreviewInspectorRoutePattern(pattern),
      pattern,
    }),
  );
}

/** Combines outer and inner app-module mounts without exposing duplicate owner contracts. */
function withComposedRouteMounts(
  parent: PreviewInspectorRouteLocation,
  child: PreviewInspectorRouteLocation,
): PreviewInspectorRouteLocation {
  const mounts = [...(parent.routeMounts ?? []), ...(child.routeMounts ?? [])];
  if (mounts.length === 0) return child;
  const unique = mounts.filter(
    (mount, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.sourcePath === mount.sourcePath &&
          candidate.exportName === mount.exportName &&
          candidate.basePath === mount.basePath,
      ) === index,
  );
  return Object.freeze({ ...child, routeMounts: Object.freeze(unique) });
}

/** Keeps route catalogs/owners hot without treating every unselected page module as a dependency. */
function collectRouteMetadataDependencies(
  choices: readonly PreviewInspectorRouteLocation[],
  dependencies: Set<string>,
): void {
  for (const choice of choices) {
    dependencies.add(path.normalize(choice.sourcePath));
    for (const dependencyPath of choice.dependencyPaths) {
      if (
        choice.componentSourcePath === undefined ||
        path.normalize(dependencyPath) !== path.normalize(choice.componentSourcePath)
      ) {
        dependencies.add(path.normalize(dependencyPath));
      }
    }
  }
}

/** Prefers an exact owner/index pathname, then the structurally shortest authored route. */
function selectDefaultRouteChoice(
  choices: readonly PreviewInspectorRouteLocation[],
  primary: PreviewInspectorRouteLocation | undefined,
): PreviewInspectorRouteLocation | undefined {
  return [...choices].sort((left, right) => {
    const leftPrimary = left.pathname === primary?.pathname ? 0 : 1;
    const rightPrimary = right.pathname === primary?.pathname ? 0 : 1;
    return (
      leftPrimary - rightPrimary ||
      countRouteSegments(left.pattern) - countRouteSegments(right.pattern) ||
      left.pattern.localeCompare(right.pattern) ||
      left.componentName.localeCompare(right.componentName)
    );
  })[0];
}

/** Counts only non-empty route segments for an index/default preference independent of string size. */
function countRouteSegments(pattern: string): number {
  return pattern.split('/').filter(Boolean).length;
}

/** Freezes nested selection arrays so cache entries cannot be mutated by later planning passes. */
function freezeRouteBranch(branch: MutableRouteBranch): PreviewInspectorRouteBranch {
  return Object.freeze({
    ...(branch.availability === undefined ? {} : { availability: branch.availability }),
    childState: branch.childState,
    componentName: branch.componentName,
    depth: branch.depth,
    id: branch.id,
    ...(branch.parentId === undefined ? {} : { parentId: branch.parentId }),
    pathname: branch.pathname,
    pattern: branch.pattern,
    selectionPath: Object.freeze(
      branch.selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    ),
    selectable: branch.selectable,
    ...(branch.sourcePath === undefined ? {} : { sourcePath: branch.sourcePath }),
  });
}
