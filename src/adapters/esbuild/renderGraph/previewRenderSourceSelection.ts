/**
 * Selects the smallest source inventory capable of connecting a target export to an application.
 * A cheap literal-import pass runs before the exact AST graph so large unrelated feature trees do
 * not consume parser memory or edge budgets. Exact TypeScript resolution remains the authority for
 * aliases; lexical checks only decide when invoking that comparatively expensive resolver is useful.
 */
import path from 'node:path';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../../shared/pathIdentity';
import type { ResolvePreviewRenderGraphModule } from './previewRenderGraphTypes';
import {
  collectPreviewRenderModuleSpecifiers,
  type CollectPreviewRenderModuleSpecifiers,
} from './previewRenderSourceAnalysis';

/** One non-relative literal import retained until its project resolver result is needed. */
interface IndexedRenderAliasImport {
  readonly candidateKey: string;
  readonly consumerIdentity: string;
  readonly consumerPath: string;
  readonly moduleSpecifier: string;
}

/**
 * Reverse indexes used by the coarse target-to-entry closure.
 *
 * Relative imports have a complete lexical destination at index time. Aliases intentionally remain
 * candidates until a reachable module asks for their basename/suffix bucket; the project's exact
 * TypeScript resolver remains the authority over whether a candidate really reaches that module.
 */
interface PreviewRenderReverseImportIndex {
  readonly aliasImportsByCandidateKey: ReadonlyMap<string, readonly IndexedRenderAliasImport[]>;
  readonly aliasImportsByConsumer: ReadonlyMap<string, readonly IndexedRenderAliasImport[]>;
  readonly authoredPathByIdentity: ReadonlyMap<string, string>;
  readonly consumerOrderByIdentity: ReadonlyMap<string, number>;
  readonly relativeConsumersByDependencyKey: ReadonlyMap<string, ReadonlySet<string>>;
}

/**
 * Selects the nearest configured application/package first, retaining full-workspace fallback.
 *
 * @param sourcePaths Complete bounded workspace inventory.
 * @param targetPath Current source path whose nearest config/package is preferred.
 * @returns Local package paths, or the original inventory when no closer boundary is proven.
 */
export function selectNearestPreviewRenderPackageSourcePaths(
  sourcePaths: readonly string[],
  targetPath: string,
): readonly string[] {
  const workspaceBoundary = findCommonRenderSourceDirectory(sourcePaths, targetPath);
  let directory = path.dirname(targetPath);
  while (isRenderPathInside(workspaceBoundary, directory)) {
    if (
      ['tsconfig.json', 'jsconfig.json', 'package.json'].some((name) =>
        ts.sys.fileExists(path.join(directory, name)),
      )
    ) {
      const selected = sourcePaths.filter((sourcePath) =>
        isRenderPathInside(directory, sourcePath),
      );
      return selected.includes(path.normalize(targetPath))
        ? selected
        : [...selected, path.normalize(targetPath)].sort();
    }
    if (directory === workspaceBoundary) {
      break;
    }
    directory = path.dirname(directory);
  }
  return sourcePaths;
}

/**
 * Computes the reverse literal-import closure of a selected target before full AST analysis.
 *
 * @param sourceTextByPath Current source text indexed by authored absolute path.
 * @param targetPath Selected target module.
 * @param resolveModule Exact project resolver used only for plausible or fallback aliases.
 * @returns Target and every transitive consumer that can participate in a target-to-entry path.
 */
export function selectPreviewRenderRelevantSourcePaths(
  sourceTextByPath: ReadonlyMap<string, string>,
  targetPath: string,
  resolveModule: ResolvePreviewRenderGraphModule,
  collectModuleSpecifiers: CollectPreviewRenderModuleSpecifiers = collectPreviewRenderModuleSpecifiers,
): readonly string[] {
  const reverseIndex = createPreviewRenderReverseImportIndex(
    sourceTextByPath,
    collectModuleSpecifiers,
  );

  const targetIdentity = normalizeRenderModuleIdentity(targetPath);
  const selectedIdentities = new Set<string>([targetIdentity]);
  const pendingIdentities = [targetIdentity];
  const resolvedAliasIdentityByImport = new Map<IndexedRenderAliasImport, string | null>();
  const resolvedAliasConsumersByCandidateKey = new Map<string, Map<string, Set<string>>>();
  const hydratedAliasCandidateKeys = new Set<string>();
  climbPlausibleConsumers();
  if (selectedIdentities.size === 1) {
    for (const consumerIdentity of collectBroadAliasConsumers(targetIdentity, reverseIndex)) {
      if (!selectedIdentities.has(consumerIdentity)) {
        selectedIdentities.add(consumerIdentity);
        pendingIdentities.push(consumerIdentity);
      }
    }
    climbPlausibleConsumers();
  }
  return [...selectedIdentities].flatMap((identity) => {
    const authoredPath = reverseIndex.authoredPathByIdentity.get(identity);
    return authoredPath === undefined ? [] : [authoredPath];
  });

  /**
   * Admits one breadth layer from reverse indexes instead of scanning every remaining consumer.
   * Sorting candidate consumers by inventory order preserves the old deterministic traversal order,
   * which matters when the later exact graph reaches its explicit edge budget.
   */
  function climbPlausibleConsumers(): void {
    while (pendingIdentities.length > 0) {
      const dependencyIdentities = pendingIdentities.splice(0);
      const candidateConsumers = new Set<string>();
      for (const dependencyIdentity of dependencyIdentities) {
        const dependencyKey = createRenderModuleEquivalenceKey(dependencyIdentity);
        for (const consumerIdentity of reverseIndex.relativeConsumersByDependencyKey.get(
          dependencyKey,
        ) ?? []) {
          candidateConsumers.add(consumerIdentity);
        }

        for (const candidateKey of collectRenderAliasCandidateKeys(dependencyIdentity)) {
          hydrateAliasCandidateKey(candidateKey);
          for (const consumerIdentity of resolvedAliasConsumersByCandidateKey
            .get(candidateKey)
            ?.get(dependencyKey) ?? []) {
            candidateConsumers.add(consumerIdentity);
          }
        }
      }

      const orderedConsumers = [...candidateConsumers].sort(
        (left, right) =>
          (reverseIndex.consumerOrderByIdentity.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (reverseIndex.consumerOrderByIdentity.get(right) ?? Number.MAX_SAFE_INTEGER),
      );
      for (const consumerIdentity of orderedConsumers) {
        if (!selectedIdentities.has(consumerIdentity)) {
          selectedIdentities.add(consumerIdentity);
          pendingIdentities.push(consumerIdentity);
        }
      }
    }
  }

  /** Resolves every alias in one plausible basename/suffix bucket at most once. */
  function hydrateAliasCandidateKey(candidateKey: string): void {
    if (hydratedAliasCandidateKeys.has(candidateKey)) {
      return;
    }
    hydratedAliasCandidateKeys.add(candidateKey);
    for (const aliasImport of reverseIndex.aliasImportsByCandidateKey.get(candidateKey) ?? []) {
      indexResolvedAliasImport(aliasImport);
    }
  }

  /** Resolves and records one alias under both its candidate and exact destination identities. */
  function indexResolvedAliasImport(aliasImport: IndexedRenderAliasImport): string | undefined {
    const resolvedIdentity = resolveAliasImport(aliasImport);
    if (resolvedIdentity === undefined) {
      return undefined;
    }
    const dependencyKey = createRenderModuleEquivalenceKey(resolvedIdentity);
    let consumersByDependency = resolvedAliasConsumersByCandidateKey.get(aliasImport.candidateKey);
    if (consumersByDependency === undefined) {
      consumersByDependency = new Map();
      resolvedAliasConsumersByCandidateKey.set(aliasImport.candidateKey, consumersByDependency);
    }
    let consumers = consumersByDependency.get(dependencyKey);
    if (consumers === undefined) {
      consumers = new Set();
      consumersByDependency.set(dependencyKey, consumers);
    }
    consumers.add(aliasImport.consumerIdentity);
    return resolvedIdentity;
  }

  /** Memoizes the exact project resolver so each literal alias costs at most one resolver call. */
  function resolveAliasImport(aliasImport: IndexedRenderAliasImport): string | undefined {
    const cachedIdentity = resolvedAliasIdentityByImport.get(aliasImport);
    if (cachedIdentity !== undefined) {
      return cachedIdentity ?? undefined;
    }
    const resolvedPath = resolveModule(aliasImport.moduleSpecifier, aliasImport.consumerPath);
    const resolvedIdentity =
      resolvedPath === undefined ? null : normalizeRenderModuleIdentity(resolvedPath);
    resolvedAliasIdentityByImport.set(aliasImport, resolvedIdentity);
    return resolvedIdentity ?? undefined;
  }

  /**
   * Tries every alias only for an otherwise isolated target, preserving arbitrary tsconfig aliases.
   * The fallback stays consumer-ordered and stops after that consumer's first exact match, matching
   * the previous broad scan while populating the same memoized indexes used by later BFS layers.
   */
  function collectBroadAliasConsumers(
    dependencyIdentity: string,
    index: PreviewRenderReverseImportIndex,
  ): readonly string[] {
    const consumers: string[] = [];
    for (const [consumerIdentity, aliasImports] of index.aliasImportsByConsumer) {
      for (const aliasImport of aliasImports) {
        const resolvedIdentity = indexResolvedAliasImport(aliasImport);
        if (
          resolvedIdentity !== undefined &&
          areRenderModuleStemsEquivalent(resolvedIdentity, dependencyIdentity)
        ) {
          consumers.push(consumerIdentity);
          break;
        }
      }
    }
    return consumers;
  }
}

/**
 * Parses every literal import once and builds indexes whose total size is linear in import edges.
 * Canonicalizing the consumer's existing parent before resolving relative text preserves macOS
 * `/var` to `/private/var` identity, including extensionless paths whose final file does not exist.
 */
function createPreviewRenderReverseImportIndex(
  sourceTextByPath: ReadonlyMap<string, string>,
  collectModuleSpecifiers: CollectPreviewRenderModuleSpecifiers,
): PreviewRenderReverseImportIndex {
  const aliasImportsByCandidateKey = new Map<string, IndexedRenderAliasImport[]>();
  const aliasImportsByConsumer = new Map<string, IndexedRenderAliasImport[]>();
  const authoredPathByIdentity = new Map<string, string>();
  const consumerOrderByIdentity = new Map<string, number>();
  const relativeConsumersByDependencyKey = new Map<string, Set<string>>();
  let consumerOrder = 0;

  for (const [consumerPath, sourceText] of sourceTextByPath) {
    const consumerIdentity = normalizeRenderModuleIdentity(consumerPath);
    const canonicalConsumerDirectory = canonicalizeExistingPath(path.dirname(consumerPath));
    authoredPathByIdentity.set(consumerIdentity, consumerPath);
    consumerOrderByIdentity.set(consumerIdentity, consumerOrder);
    consumerOrder += 1;

    for (const moduleSpecifier of collectModuleSpecifiers(consumerPath, sourceText)) {
      const cleanSpecifier = cleanRenderModuleSpecifier(moduleSpecifier);
      if (cleanSpecifier === undefined) {
        continue;
      }
      if (cleanSpecifier.startsWith('.')) {
        const dependencyIdentity = normalizeRenderModuleIdentity(
          path.resolve(canonicalConsumerDirectory, cleanSpecifier),
        );
        const dependencyKey = createRenderModuleEquivalenceKey(dependencyIdentity);
        let consumers = relativeConsumersByDependencyKey.get(dependencyKey);
        if (consumers === undefined) {
          consumers = new Set();
          relativeConsumersByDependencyKey.set(dependencyKey, consumers);
        }
        consumers.add(consumerIdentity);
        continue;
      }

      const candidateKey = createRenderAliasSpecifierCandidateKey(cleanSpecifier);
      const aliasImport: IndexedRenderAliasImport = Object.freeze({
        candidateKey,
        consumerIdentity,
        consumerPath,
        moduleSpecifier: cleanSpecifier,
      });
      appendRenderMapValue(aliasImportsByCandidateKey, candidateKey, aliasImport);
      appendRenderMapValue(aliasImportsByConsumer, consumerIdentity, aliasImport);
    }
  }

  return Object.freeze({
    aliasImportsByCandidateKey,
    aliasImportsByConsumer,
    authoredPathByIdentity,
    consumerOrderByIdentity,
    relativeConsumersByDependencyKey,
  });
}

/** Appends an import to a stable insertion-ordered reverse-index bucket. */
function appendRenderMapValue<Key, Value>(index: Map<Key, Value[]>, key: Key, value: Value): void {
  const values = index.get(key);
  if (values === undefined) {
    index.set(key, [value]);
  } else {
    values.push(value);
  }
}

/** Finds the deepest lexical directory containing the target and every inventoried source. */
function findCommonRenderSourceDirectory(
  sourcePaths: readonly string[],
  targetPath: string,
): string {
  let commonDirectory = path.dirname(path.resolve(targetPath));
  for (const sourcePath of sourcePaths) {
    while (!isRenderPathInside(commonDirectory, sourcePath)) {
      const parent = path.dirname(commonDirectory);
      if (parent === commonDirectory) {
        return parent;
      }
      commonDirectory = parent;
    }
  }
  return commonDirectory;
}

/** Checks lexical containment without accepting sibling-prefix lookalikes. */
function isRenderPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Removes loader query/hash text without changing the resolver-visible authored specifier. */
function cleanRenderModuleSpecifier(moduleSpecifier: string): string | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
  return cleanSpecifier === undefined || cleanSpecifier.length === 0 ? undefined : cleanSpecifier;
}

/** Creates the alias basename bucket that safely over-approximates the former suffix predicate. */
function createRenderAliasSpecifierCandidateKey(moduleSpecifier: string): string {
  const specifierStem = moduleSpecifier
    .replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '')
    .replaceAll('\\', '/');
  return path.posix.basename(specifierStem);
}

/**
 * Returns every alias bucket that the former basename/suffix predicate could accept for a module.
 * An index module can be imported as either `.../index` or by the containing directory name.
 */
function collectRenderAliasCandidateKeys(moduleIdentity: string): ReadonlySet<string> {
  const slashIdentity = moduleIdentity.replaceAll('\\', '/');
  const basename = path.posix.basename(slashIdentity);
  return new Set(
    basename === 'index'
      ? [basename, path.posix.basename(path.posix.dirname(slashIdentity))]
      : [basename],
  );
}

/** Treats directory-index and extensionless module spellings as the same static source identity. */
function areRenderModuleStemsEquivalent(left: string, right: string): boolean {
  return createRenderModuleEquivalenceKey(left) === createRenderModuleEquivalenceKey(right);
}

/** Collapses extensionless directory imports and their authored `index` module to one lookup key. */
function createRenderModuleEquivalenceKey(moduleIdentity: string): string {
  return path.basename(moduleIdentity) === 'index' ? path.dirname(moduleIdentity) : moduleIdentity;
}

/** Canonicalizes aliases such as macOS `/var` and `/private/var` before membership checks. */
function normalizeRenderModuleIdentity(sourcePath: string): string {
  return path
    .normalize(canonicalizeExistingPath(sourcePath))
    .replace(/(?:\.d)?\.[cm]?[jt]sx?$/iu, '');
}
