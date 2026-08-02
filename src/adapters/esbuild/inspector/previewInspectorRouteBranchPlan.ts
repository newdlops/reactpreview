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
  type CollectPreviewInspectorRouteLocationOptions,
  type PreviewInspectorRouteLocation,
  type PreviewInspectorRouteLocationInventory,
} from './previewInspectorRouteLocation';
import {
  composePreviewInspectorNestedRoutePattern,
  materializePreviewInspectorRoutePattern,
  normalizePreviewInspectorRoutePattern,
} from './previewInspectorRoutePattern';
import {
  createPreviewInspectorRouteBranchId,
  createPreviewInspectorRouteOccurrenceBranchId,
} from './previewInspectorRouteBranchIdentity';
import {
  createPreviewInspectorRouteSelectionPrefixProvider,
  type PreviewInspectorRouteSelectionPrefixProvider,
} from './previewInspectorRouteSelectionPrefixProvider';

/** Browser-safe hierarchy record for one statically proven route choice. */
export interface PreviewInspectorRouteBranch {
  /** A disabled branch remains visible when static route proof is incomplete. */
  readonly availability?:
    | 'catalog-unresolved'
    | 'component-unresolved'
    | 'submodule-base-unresolved'
    | 'factory-contract-unresolved'
    | 'route-provenance-ambiguous';
  /** Whether the selected analysis path proved children, proved a leaf, or has not inspected it. */
  readonly childState: 'expanded' | 'leaf' | 'unknown';
  /** Public component/export identity rendered by this branch. */
  readonly componentName: string;
  /** Exact public export resolved for the rendered component, when syntax proves it. */
  readonly exportName?: string;
  /** Nesting depth below the selected source router owner. */
  readonly depth: number;
  /** Exact canonical branch represented by one non-selectable semantic duplicate. */
  readonly duplicateOf?: string;
  /** Stable opaque identity used by the route explorer and diagnostics. */
  readonly id: string;
  /** Parent route identity when this choice belongs to a nested router module. */
  readonly parentId?: string;
  /** Browser-ready path with constraint-compatible values substituted for dynamic parameters. */
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
  /** Complete-inventory request memo for context-free owner analysis only. */
  readonly ownerLocationInventoryMemo?: PreviewInspectorRouteOwnerLocationInventoryMemo;
  /** Phase-local reuse of deeply frozen exact nonterminal selection prefixes only. */
  readonly selectionPrefixProvider?: PreviewInspectorRouteSelectionPrefixProvider<PreviewInspectorRouteSelectionPrefixState>;
}

/** Request-confined provider retaining only invariant owner-location inventory promises. */
export interface PreviewInspectorRouteOwnerLocationInventoryMemo {
  /** Returns one exact owner inventory under the provider's frozen request context. */
  readonly collect: (
    documentPath: string,
    exportName: string,
  ) => Promise<PreviewInspectorRouteLocationInventory>;
  /** Permanently releases every retained owner promise before replay or terminal propagation. */
  readonly release: () => void;
}

/**
 * Creates one owner-location memo whose ambient resolver and source context cannot drift.
 *
 * @param options Immutable analysis context shared by every owner in one enumeration request.
 * @returns Provider keyed only by collision-safe normalized owner path and exact export identity.
 */
export function createPreviewInspectorRouteOwnerLocationInventoryMemo(
  options: Omit<CollectPreviewInspectorRouteLocationOptions, 'documentPath' | 'exportName'>,
): PreviewInspectorRouteOwnerLocationInventoryMemo {
  const inventories = new Map<string, Promise<PreviewInspectorRouteLocationInventory>>();
  let released = false;
  return Object.freeze({
    collect(
      documentPath: string,
      exportName: string,
    ): Promise<PreviewInspectorRouteLocationInventory> {
      if (released) {
        return Promise.reject(
          new Error('Preview Inspector owner-location inventory memo was already released.'),
        );
      }
      const identity = JSON.stringify([path.normalize(documentPath), exportName]);
      const retained = inventories.get(identity);
      if (retained !== undefined) return retained;
      const pending = collectPreviewInspectorRouteLocationInventory({
        ...options,
        documentPath: path.normalize(documentPath),
        exportName,
      });
      inventories.set(identity, pending);
      return pending;
    },
    release(): void {
      released = true;
      inventories.clear();
    },
  });
}

/** Mutable branch record used only while a selected nested owner is being inspected. */
interface MutableRouteBranch {
  readonly availability?: PreviewInspectorRouteBranch['availability'];
  childState: PreviewInspectorRouteBranch['childState'];
  readonly componentName: string;
  readonly exportName?: string;
  readonly depth: number;
  readonly duplicateOf?: string;
  readonly id: string;
  readonly parentId?: string;
  readonly pathname: string;
  readonly pattern: string;
  readonly selectionPath: readonly PreviewInspectorRouteSelectionStep[];
  readonly selectable: boolean;
  readonly sourcePath?: string;
}

/** Deeply frozen deterministic continuation after one exact nonterminal selected prefix. */
interface PreviewInspectorRouteSelectionPrefixState {
  readonly activeLocation: PreviewInspectorRouteLocation;
  readonly branches: readonly PreviewInspectorRouteBranch[];
  readonly dependencyPaths: readonly string[];
  readonly nextDepth: number;
  readonly nextOwnerExportName: string;
  readonly nextOwnerSourcePath: string;
  readonly primary?: PreviewInspectorRouteLocation;
  readonly selectedBranchId: string;
  readonly selectedComponentSourcePaths: readonly string[];
  readonly selectionPrefix: readonly PreviewInspectorRouteSelectionStep[];
  readonly selectionResolution: 'exact';
  readonly visitedOwnerIdentities: readonly string[];
}

/** Creates the planner's opaque provider without exposing its private retained-state contract. */
export function createPreviewInspectorRouteBranchSelectionPrefixProvider(): NonNullable<
  CollectPreviewInspectorRouteBranchPlanOptions['selectionPrefixProvider']
> {
  return createPreviewInspectorRouteSelectionPrefixProvider((state) =>
    deepFreeze(structuredClone(state)),
  );
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
  let pendingRetention:
    | {
        readonly prefix: readonly PreviewInspectorRouteSelectionStep[];
        readonly state: PreviewInspectorRouteSelectionPrefixState;
      }
    | undefined;
  const rootOwner = Object.freeze({ exportName: options.exportName, sourcePath: ownerPath });

  for (let depth = 0; ; depth += 1) {
    const desiredPrefix =
      options.selection === undefined || depth >= options.selection.length - 1
        ? undefined
        : Object.freeze(
            options.selection
              .slice(0, depth + 1)
              .map((step) =>
                Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
              ),
          );
    const retained =
      desiredPrefix === undefined
        ? undefined
        : options.selectionPrefixProvider?.lookup(rootOwner, desiredPrefix);
    if (retained !== undefined) {
      branches.splice(0, branches.length, ...retained.branches.map(thawRouteBranch));
      dependencies.clear();
      for (const dependencyPath of retained.dependencyPaths) dependencies.add(dependencyPath);
      selectedComponentPaths.splice(
        0,
        selectedComponentPaths.length,
        ...retained.selectedComponentSourcePaths,
      );
      visitedOwners.clear();
      for (const identity of retained.visitedOwnerIdentities) visitedOwners.add(identity);
      activeLocation = retained.activeLocation;
      ownerPath = retained.nextOwnerSourcePath;
      ownerExportName = retained.nextOwnerExportName;
      parentBranch = branches.find((branch) => branch.id === retained.selectedBranchId);
      primary = retained.primary;
      selectionPath = retained.selectionPrefix;
      selectionResolution = retained.selectionResolution;
      depth = retained.nextDepth - 1;
      continue;
    }
    const ownerIdentity = `${ownerPath}\0${ownerExportName}`;
    if (visitedOwners.has(ownerIdentity)) break;
    visitedOwners.add(ownerIdentity);
    const inventory =
      options.ownerLocationInventoryMemo === undefined
        ? await collectPreviewInspectorRouteLocationInventory({
            documentPath: ownerPath,
            exportName: ownerExportName,
            readSource: options.readSource,
            ...(options.resolveModule === undefined
              ? {}
              : { resolveModule: options.resolveModule }),
            renderChain: options.renderChain,
            sourcePaths: options.sourcePaths,
          })
        : await options.ownerLocationInventoryMemo.collect(ownerPath, ownerExportName);
    if (depth === 0) primary = inventory.primary;
    for (const dependencyPath of inventory.primary?.dependencyPaths ?? []) {
      if (
        inventory.primary?.componentSourcePath === undefined ||
        path.normalize(dependencyPath) !== path.normalize(inventory.primary.componentSourcePath)
      ) {
        dependencies.add(path.normalize(dependencyPath));
      }
    }
    const parentLocation =
      activeLocation === undefined || inventory.choices.length === 0
        ? activeLocation
        : withNestedRouteOwnerMount(activeLocation, ownerPath, ownerExportName, inventory);
    const levelChoices = rematerializeShadowedTerminalWildcardChoices(
      parentLocation === undefined
        ? inventory.choices
        : inventory.choices.map((choice) => composeNestedRouteChoice(parentLocation, choice)),
    );
    if (pendingRetention !== undefined) {
      if (levelChoices.length > 0)
        options.selectionPrefixProvider?.retain(
          rootOwner,
          pendingRetention.prefix,
          pendingRetention.state,
        );
      pendingRetention = undefined;
    }
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
        id:
          unresolved.occurrenceIdentity === undefined
            ? createPreviewInspectorRouteBranchId(unresolvedPath)
            : createPreviewInspectorRouteOccurrenceBranchId(
                unresolvedPath,
                unresolved.occurrenceIdentity,
              ),
        ...(parentBranch === undefined ? {} : { parentId: parentBranch.id }),
        pathname: '',
        pattern: '<unresolved>',
        selectable: false,
        selectionPath: Object.freeze([]),
      });
    }
    for (const duplicate of inventory.directRouteDuplicates ?? []) {
      const composedPattern =
        parentLocation === undefined
          ? duplicate.pattern
          : (composePreviewInspectorNestedRoutePattern(parentLocation.pattern, duplicate.pattern)
              ?.pattern ?? duplicate.pattern);
      const canonical = levelChoices.find(
        (choice) =>
          choice.componentName === duplicate.componentName && choice.pattern === composedPattern,
      );
      if (canonical === undefined) continue;
      const duplicateSelectionPath = Object.freeze([
        ...selectionPath,
        Object.freeze({
          componentName: duplicate.componentName,
          pattern: canonical.pattern,
        }),
      ]);
      branches.push({
        childState: 'leaf',
        componentName: duplicate.componentName,
        depth,
        duplicateOf: createPreviewInspectorRouteBranchId(duplicateSelectionPath),
        exportName: duplicate.componentExportName,
        id: createPreviewInspectorRouteOccurrenceBranchId(
          duplicateSelectionPath,
          duplicate.occurrenceIdentity,
        ),
        ...(parentBranch === undefined ? {} : { parentId: parentBranch.id }),
        pathname: canonical.pathname,
        pattern: canonical.pattern,
        selectable: false,
        selectionPath: duplicateSelectionPath,
        sourcePath: duplicate.componentSourcePath,
      });
    }
    if (levelChoices.length === 0) {
      // A factory can prove that this owner has children while being unable to prove a safe
      // pathname for any of them. Keep that distinction visible to the explorer: marking the
      // owner as a leaf would incorrectly imply that the selected application has terminated.
      if (parentBranch !== undefined && (inventory.unresolvedFactoryOptions?.length ?? 0) === 0)
        parentBranch.childState = 'leaf';
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
        ...(choice.componentExportName === undefined
          ? {}
          : { exportName: choice.componentExportName }),
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
    if (
      desiredPrefix !== undefined &&
      requested !== undefined &&
      selectionResolution === 'exact' &&
      parentBranch !== undefined
    ) {
      pendingRetention = {
        prefix: desiredPrefix,
        state: {
          activeLocation,
          branches: branches.map(freezeRouteBranch),
          dependencyPaths: [...dependencies].sort(),
          nextDepth: depth + 1,
          nextOwnerExportName: ownerExportName,
          nextOwnerSourcePath: ownerPath,
          ...(primary === undefined ? {} : { primary }),
          selectedBranchId: parentBranch.id,
          selectedComponentSourcePaths: [...selectedComponentPaths],
          selectionPrefix: desiredPrefix,
          selectionResolution,
          visitedOwnerIdentities: [...visitedOwners],
        },
      };
    }
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
  if (
    options.selection !== undefined &&
    !options.selection.every((step, index) => {
      const selected = selectionPath[index];
      return step.componentName === selected?.componentName && step.pattern === selected.pattern;
    })
  ) {
    selectionResolution = 'fallback';
  }
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
  const composed = composePreviewInspectorNestedRoutePattern(parent.pattern, child.pattern);
  if (
    composed === undefined ||
    (composed.pattern === child.pattern && composed.pathname === child.pathname)
  ) {
    return withComposedRouteMounts(parent, child);
  }
  return withComposedRouteMounts(
    parent,
    Object.freeze({
      ...child,
      pathname: composed.pathname,
      pattern: composed.pattern,
    }),
  );
}

/**
 * Gives a terminal splat one synthetic segment when its zero-segment pathname has an exact owner.
 *
 * React Router ranks an exact owner/index route ahead of a sibling `*` route at that pathname.
 * The fallback remains a real route at a deterministic non-empty splat while unshadowed wildcard
 * choices preserve their original materialization byte-for-byte.
 */
function rematerializeShadowedTerminalWildcardChoices(
  choices: readonly PreviewInspectorRouteLocation[],
): readonly PreviewInspectorRouteLocation[] {
  return choices.map((choice) => {
    if (!/(?:^|\/)\*+$/u.test(choice.pattern)) return choice;
    const wildcardBase =
      normalizePreviewInspectorRoutePattern(choice.pattern.replace(/\/\*+$/u, '')) ?? '/';
    const shadowed = choices.some(
      (sibling) =>
        sibling !== choice &&
        sibling.pathname === choice.pathname &&
        normalizePreviewInspectorRoutePattern(sibling.pattern) === wildcardBase,
    );
    if (!shadowed) return choice;
    const occupiedPathnames = new Set(
      choices
        .filter((sibling) => !/(?:^|\/)\*+$/u.test(sibling.pattern))
        .map((sibling) => sibling.pathname),
    );
    const fillerPathname = materializePreviewInspectorRoutePattern(
      `${choice.pathname}/:previewInspectorSplat`,
    );
    let ordinal = 1;
    let pathname: string;
    do {
      pathname = ordinal === 1 ? fillerPathname : `${fillerPathname}-${ordinal.toString()}`;
      ordinal += 1;
    } while (occupiedPathnames.has(pathname));
    return Object.freeze({ ...choice, pathname });
  });
}

/**
 * Retains the smallest direct route owner only after its child inventory has been proven.
 *
 * A direct `<Route>` whose component calls `useRoutes` cannot be replaced by its child page: the
 * child needs the component's Router context. Factory-provided mounts already carry that evidence;
 * this supplements them for direct nested Route components without making sibling branches live.
 */
function withNestedRouteOwnerMount(
  parent: PreviewInspectorRouteLocation,
  sourcePath: string,
  exportName: string,
  inventory: Awaited<ReturnType<typeof collectPreviewInspectorRouteLocationInventory>>,
): PreviewInspectorRouteLocation {
  const basePath = normalizePreviewInspectorRoutePattern(
    parent.pattern.replace(/\/\*+$/u, '').replace(/\/+$/u, ''),
  );
  const mount = Object.freeze({
    basePath: basePath ?? '/',
    contextPattern: parent.pattern,
    exportName,
    hasWildcardFallback: inventory.fallbackCount > 0,
    routeSlotCount: inventory.choices.length,
    sourcePath,
  });
  const routeMounts = [...(parent.routeMounts ?? []), mount];
  const uniqueMounts = routeMounts.filter(
    (candidate, index, values) =>
      values.findIndex(
        (item) =>
          item.sourcePath === candidate.sourcePath &&
          item.exportName === candidate.exportName &&
          item.basePath === candidate.basePath,
      ) === index,
  );
  return Object.freeze({ ...parent, routeMounts: Object.freeze(uniqueMounts) });
}

/** Combines outer and inner route ownership plus inline JSX wrappers without duplicate contracts. */
function withComposedRouteMounts(
  parent: PreviewInspectorRouteLocation,
  child: PreviewInspectorRouteLocation,
): PreviewInspectorRouteLocation {
  const mounts = [...(parent.routeMounts ?? []), ...(child.routeMounts ?? [])];
  const uniqueMounts = mounts.filter(
    (mount, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.sourcePath === mount.sourcePath &&
          candidate.exportName === mount.exportName &&
          candidate.basePath === mount.basePath,
      ) === index,
  );
  const wrappers = [...(parent.elementWrappers ?? []), ...(child.elementWrappers ?? [])];
  const uniqueWrappers = wrappers.filter(
    (wrapper, index, values) =>
      values.findIndex(
        (candidate) =>
          candidate.sourcePath === wrapper.sourcePath &&
          candidate.exportName === wrapper.exportName,
      ) === index,
  );
  if (uniqueMounts.length === 0 && uniqueWrappers.length === 0) return child;
  return Object.freeze({
    ...child,
    ...(uniqueWrappers.length === 0 ? {} : { elementWrappers: Object.freeze(uniqueWrappers) }),
    ...(uniqueMounts.length === 0 ? {} : { routeMounts: Object.freeze(uniqueMounts) }),
  });
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
    ...(branch.exportName === undefined ? {} : { exportName: branch.exportName }),
    depth: branch.depth,
    ...(branch.duplicateOf === undefined ? {} : { duplicateOf: branch.duplicateOf }),
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

/** Restores one fresh mutable accumulator record without mutating the retained branch. */
function thawRouteBranch(branch: PreviewInspectorRouteBranch): MutableRouteBranch {
  return {
    ...branch,
    selectable: branch.selectable === true,
    selectionPath: Object.freeze(
      branch.selectionPath.map((step) =>
        Object.freeze({ componentName: step.componentName, pattern: step.pattern }),
      ),
    ),
  };
}

/** Recursively freezes a structured clone owned exclusively by one retained prefix. */
function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
