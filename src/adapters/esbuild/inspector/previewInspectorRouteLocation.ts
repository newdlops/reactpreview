/** Coordinates RouteLocation using bounded authored-source evidence. */
import path from 'node:path';
import ts from 'typescript';
import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorDirectRouteChoicesFromSource,
  type PreviewInspectorDirectRouteChoice,
  type PreviewInspectorDirectRouteComponentReference,
} from './previewInspectorDirectRouteChoices';
import {
  resolvePreviewInspectorDirectRouteChoices,
  type PreviewInspectorDirectRouteResolution,
} from './previewInspectorDirectRouteResolution';
import { retainPreviewInspectorNestedRouteOwnerContext } from './previewInspectorNestedRouteOwnerContext';
import { createPreviewInspectorEarlyReturnRoutePenalty } from './previewInspectorRouteEarlyReturn';
import { collectPreviewInspectorRouteFactoryEvidence } from './previewInspectorRouteFactory';
import {
  collectPreviewInspectorRouteFactoryChoices,
  type PreviewInspectorRouteFactoryOwnerEvidence,
} from './previewInspectorRouteFactoryChoices';
import { collectPreviewInspectorRouteFactoryManifest } from './previewInspectorRouteFactoryManifest';
import {
  addRouteCandidate,
  collectJsonCatalogCandidates,
  collectJsonCatalogSpecifiers,
  collectSourceRouteCandidates,
  compareRouteCandidates,
  compareRouteRegistryPaths,
  normalizeComponentIdentity,
  readCachedSource,
  resolveRouteCatalogPath,
} from './previewInspectorRouteLocationEvidence';
import {
  collectPreviewInspectorRenderPathSourcePaths as collectRenderPathSourcePaths,
  createPreviewInspectorFactoryUnresolvedOccurrenceIdentity as createFactoryUnresolvedOccurrenceIdentity,
} from './previewInspectorRouteLocationIdentity';
import {
  DIRECT_ROUTE_OCCURRENCE_EVIDENCE_BONUS,
  MAX_CONTEXTUAL_FACTORY_MANIFESTS,
  MAX_ROUTE_CANDIDATES,
  MAX_ROUTE_CATALOGS,
  MAX_ROUTE_REGISTRY_SOURCES,
  type DuplicateDirectRouteChoice,
  type ResolvedDirectRouteChoice,
  type RouteLocationCandidate,
} from './previewInspectorRouteLocationModel';
import {
  collectSelectedTargetIdentities,
  collectTargetIdentities,
  referencesDirectRouteTarget,
  retargetTransparentRouteComponentLocation,
} from './previewInspectorRouteLocationTargets';
import type {
  CollectPreviewInspectorRouteLocationOptions,
  PreviewInspectorRouteElementWrapperEvidence,
  PreviewInspectorRouteLocation,
  PreviewInspectorRouteLocationInventory,
} from './previewInspectorRouteLocationTypes';
import {
  collectPreviewInspectorDirectRouteRegistrySources,
  isPreviewInspectorRouteRegistrySource,
} from './previewInspectorRoutePathMetadata';
import {
  addPreviewInspectorSupportingRoutePattern as addSupportingRoutePattern,
  materializePreviewInspectorRoutePattern as materializeRoutePattern,
  normalizePreviewInspectorRoutePattern,
} from './previewInspectorRoutePattern';

export type {
  CollectPreviewInspectorRouteLocationOptions,
  PreviewInspectorRouteElementWrapperEvidence,
  PreviewInspectorRouteLocation,
  PreviewInspectorRouteLocationInventory,
  PreviewInspectorRouteMountEvidence,
} from './previewInspectorRouteLocationTypes';

/**
 * Finds the most specific exact route for the selected component.
 *
 * Conventional route registry source names are used as a cheap index into large repositories.
 * Their relative JSON imports are then parsed as data, while JSX Route declarations are inspected
 * directly along the already-proven render path. Ambiguous candidates are ranked deterministically.
 */
export async function collectPreviewInspectorRouteLocation(
  options: CollectPreviewInspectorRouteLocationOptions,
): Promise<PreviewInspectorRouteLocation | undefined> {
  return (await collectPreviewInspectorRouteLocationInventory(options)).primary;
}

/**
 * Collects a direct target location and all exact page choices owned by a route factory in one pass.
 *
 * Catalog and source reads are shared across every choice. This avoids the expensive alternative of
 * rerunning route discovery once per page and keeps a large modular router responsive in the editor.
 */
export async function collectPreviewInspectorRouteLocationInventory(
  options: CollectPreviewInspectorRouteLocationOptions,
): Promise<PreviewInspectorRouteLocationInventory> {
  const sourceCache = new Map<string, Promise<string | undefined>>();
  const targetText = await readCachedSource(options.documentPath, options.readSource, sourceCache);
  const targetIdentities = collectTargetIdentities(options, targetText);
  if (targetIdentities.length === 0) {
    return { choices: Object.freeze([]), fallbackCount: 0, unresolvedFactoryRoutes: false };
  }
  const ownerDirectChoiceInventory = await collectPreviewInspectorDirectRouteChoices({
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePath: options.documentPath,
    sourceText: targetText,
  });
  const targetIdentitySet = new Set(targetIdentities);
  const selectedTargetIdentitySet = new Set(collectSelectedTargetIdentities(options, targetText));
  if (options.exportName === 'default') selectedTargetIdentitySet.add('default');
  const factoryChoiceInventory = collectPreviewInspectorRouteFactoryChoices({
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePath: options.documentPath,
    sourceText: targetText,
    targetIdentities: selectedTargetIdentitySet,
  });
  const factoryManifest = await collectPreviewInspectorRouteFactoryManifest({
    exportName: options.exportName,
    readSource: (sourcePath) => readCachedSource(sourcePath, options.readSource, sourceCache),
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    sourcePath: options.documentPath,
    sourceText: targetText,
  });
  const manifestLocations = materializeFactoryManifestLocations(factoryManifest);
  const factoryChoices = factoryChoiceInventory.choices;
  const choiceComponentNames = [
    ...new Set([
      ...factoryChoices.map((choice) => choice.componentName),
      ...ownerDirectChoiceInventory.choices.map((choice) => choice.componentName),
    ]),
  ];
  const identities = Object.freeze([
    ...targetIdentities,
    ...choiceComponentNames.filter((name) => !targetIdentitySet.has(name)),
  ]);
  const factoryOwnerIdentities = new Set(
    [
      ...targetIdentities,
      ...options.renderChain.paths.flatMap((renderPath) =>
        renderPath.steps.flatMap((step) => [step.label, ...step.wrapperNames]),
      ),
    ]
      .map(normalizeComponentIdentity)
      .filter((identity): identity is string => identity !== undefined),
  );
  const pathSources = collectRenderPathSourcePaths(options.renderChain);
  const registrySeeds = [
    path.normalize(options.documentPath),
    ...pathSources,
    ...ownerDirectChoiceInventory.dependencyPaths,
  ];
  const directRegistrySources = [
    ...new Set(
      (
        await Promise.all(
          registrySeeds.map(async (sourcePath) => {
            const sourceText = await readCachedSource(sourcePath, options.readSource, sourceCache);
            return sourceText === undefined
              ? []
              : collectPreviewInspectorDirectRouteRegistrySources(
                  sourcePath,
                  sourceText,
                  options.resolveModule,
                );
          }),
        )
      ).flat(),
    ),
  ].sort((left, right) => compareRouteRegistryPaths(left, right, options.documentPath));
  const inventoryRegistrySources = options.sourcePaths
    .map((sourcePath) => path.normalize(sourcePath))
    .filter(isPreviewInspectorRouteRegistrySource)
    .sort((left, right) => compareRouteRegistryPaths(left, right, options.documentPath))
    .filter((sourcePath) => !directRegistrySources.includes(sourcePath));
  const registrySources = [...directRegistrySources, ...inventoryRegistrySources].slice(
    0,
    MAX_ROUTE_REGISTRY_SOURCES,
  );
  // The target module can carry a factory base path even when the proven owner step lives in a
  // different module. Keep it in the bounded source set so an outer `:id/*` candidate can inherit
  // the target factory's stricter `:id(\\d+)` contract without walking another directory.
  const analysisSources = [
    ...new Set([
      path.normalize(options.documentPath),
      ...pathSources,
      ...ownerDirectChoiceInventory.dependencyPaths,
      ...registrySources,
    ]),
  ];
  const contextualManifestLocations: PreviewInspectorRouteLocation[] = [];
  const contextualFactoryOwners = new Set<string>();
  for (const sourcePath of analysisSources) {
    if (
      contextualFactoryOwners.size >= MAX_CONTEXTUAL_FACTORY_MANIFESTS ||
      path.normalize(sourcePath) === path.normalize(options.documentPath)
    ) {
      continue;
    }
    const sourceText = await readCachedSource(sourcePath, options.readSource, sourceCache);
    if (sourceText === undefined) continue;
    const sourceFile = ts.createSourceFile(
      sourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const ownerNames = collectPreviewInspectorRouteFactoryEvidence(sourceFile)
      .map((factory) => factory.componentName)
      .filter(
        (componentName): componentName is string =>
          componentName !== undefined && factoryOwnerIdentities.has(componentName),
      );
    for (const ownerName of ownerNames) {
      if (contextualFactoryOwners.size >= MAX_CONTEXTUAL_FACTORY_MANIFESTS) break;
      const ownerKey = `${path.normalize(sourcePath)}\0${ownerName}`;
      if (contextualFactoryOwners.has(ownerKey)) continue;
      contextualFactoryOwners.add(ownerKey);
      const contextualManifest = await collectPreviewInspectorRouteFactoryManifest({
        exportName: ownerName,
        readSource: (candidatePath) =>
          readCachedSource(candidatePath, options.readSource, sourceCache),
        ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
        sourcePath,
        sourceText,
      });
      contextualManifestLocations.push(
        ...materializeFactoryManifestLocations(contextualManifest)
          .filter((location) => targetIdentitySet.has(location.componentName))
          .map((location) =>
            retargetTransparentRouteComponentLocation(
              location,
              options.documentPath,
              options.exportName,
              options.renderChain,
            ),
          ),
      );
    }
  }
  const candidates: RouteLocationCandidate[] = [];
  const ownerDirectChoiceOccurrences = new Set(
    ownerDirectChoiceInventory.choices.map((choice) => choice.occurrenceIdentity),
  );
  const allDirectChoicesByOccurrence = new Map<string, PreviewInspectorDirectRouteChoice>(
    ownerDirectChoiceInventory.choices.map((choice) => [choice.occurrenceIdentity, choice]),
  );
  const routePatterns: string[] = [];
  const supportingSourcePaths = new Set<string>();
  const catalogPaths = new Set<string>();
  const catalogImportersByPath = new Map<string, Set<string>>();
  for (const sourcePath of analysisSources) {
    const sourceText = await readCachedSource(sourcePath, options.readSource, sourceCache);
    if (sourceText === undefined) continue;
    const directChoices = collectPreviewInspectorDirectRouteChoicesFromSource({
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
      sourcePath,
      sourceText,
    });
    const directContributedRoutePattern = directChoices.length > 0;
    for (const choice of directChoices) {
      allDirectChoicesByOccurrence.set(choice.occurrenceIdentity, choice);
      supportingSourcePaths.add(choice.sourcePath);
      if (choice.pathResolution === 'resolved')
        addSupportingRoutePattern(routePatterns, choice.pattern);
    }
    const contributedRoutePattern = collectSourceRouteCandidates(
      sourcePath,
      sourceText,
      identities,
      factoryOwnerIdentities,
      options.documentPath,
      candidates,
      routePatterns,
    );
    if (directContributedRoutePattern || contributedRoutePattern) {
      supportingSourcePaths.add(sourcePath);
    }
    if (!isPreviewInspectorRouteRegistrySource(sourcePath)) continue;
    for (const moduleSpecifier of collectJsonCatalogSpecifiers(sourcePath, sourceText)) {
      if (catalogPaths.size >= MAX_ROUTE_CATALOGS) break;
      const catalogPath = resolveRouteCatalogPath(
        moduleSpecifier,
        sourcePath,
        options.resolveModule,
      );
      if (catalogPath === undefined) continue;
      catalogPaths.add(catalogPath);
      const catalogImporters = catalogImportersByPath.get(catalogPath) ?? new Set<string>();
      catalogImporters.add(sourcePath);
      catalogImportersByPath.set(catalogPath, catalogImporters);
    }
  }
  for (const catalogPath of catalogPaths) {
    const catalogText = await readCachedSource(catalogPath, options.readSource, sourceCache);
    if (catalogText === undefined) continue;
    collectJsonCatalogCandidates(
      catalogPath,
      catalogText,
      identities,
      options.documentPath,
      candidates,
    );
    if (candidates.length >= MAX_ROUTE_CANDIDATES) break;
  }
  const readSource = (sourcePath: string): Promise<string | undefined> =>
    readCachedSource(sourcePath, options.readSource, sourceCache);
  const ownerDirectResolution = materializeDirectRouteResolution(
    await resolvePreviewInspectorDirectRouteChoices({
      choices: ownerDirectChoiceInventory.choices,
      identities,
      readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    }),
    options.documentPath,
    createPreviewInspectorEarlyReturnRoutePenalty(options.documentPath, targetText),
  );
  const contextualDirectResolution = materializeDirectRouteResolution(
    await resolvePreviewInspectorDirectRouteChoices({
      choices: [...allDirectChoicesByOccurrence.values()].filter(
        (choice) => !ownerDirectChoiceOccurrences.has(choice.occurrenceIdentity),
      ),
      identities,
      readSource,
      ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    }),
    options.documentPath,
  );
  for (const resolved of ownerDirectResolution.selectable) candidates.push(resolved.candidate);
  for (const resolved of ownerDirectResolution.selectable) {
    addSupportingRoutePattern(routePatterns, resolved.candidate.pattern);
  }
  for (const resolved of contextualDirectResolution.selectable) {
    addSupportingRoutePattern(routePatterns, resolved.candidate.pattern);
  }
  const factoryOrDirectChoiceNames = new Set(choiceComponentNames);
  const rankedCandidates = candidates
    .filter(
      (candidate) =>
        candidate.evidenceKind !== 'route-catalog' ||
        candidate.choiceOccurrenceIdentity !== undefined ||
        !factoryOrDirectChoiceNames.has(candidate.componentName),
    )
    .sort(compareRouteCandidates);
  const primaryCandidate =
    [
      ...rankedCandidates.filter((candidate) => targetIdentitySet.has(candidate.componentName)),
      ...contextualDirectResolution.selectable
        .filter((resolved) =>
          referencesDirectRouteTarget(
            resolved.choice,
            options.renderChain.target,
            options.renderChain,
          ),
        )
        .map((resolved) => resolved.candidate),
    ].sort(compareRouteCandidates)[0] ?? rankedCandidates[0];
  const ownerDirectChoiceCandidates = ownerDirectResolution.selectable.map(
    (resolved) => resolved.candidate,
  );
  const choiceCandidates = ownerDirectChoiceCandidates.filter(
    (candidate, index, values) =>
      values.findIndex(
        (item) =>
          item.componentName === candidate.componentName &&
          item.pattern === candidate.pattern &&
          item.sourcePath === candidate.sourcePath,
      ) === index,
  );
  const inferredChoices = choiceCandidates.map((candidate) =>
    retargetTransparentRouteComponentLocation(
      freezeRouteLocation(
        candidate,
        factoryChoiceInventory.owner,
        allDirectChoicesByOccurrence,
        supportingSourcePaths,
        catalogImportersByPath,
        routePatterns,
        options.documentPath,
        options.exportName,
      ),
      options.documentPath,
      options.exportName,
      options.renderChain,
    ),
  );
  // Ancestor manifests locate a shared descendant, but do not declare this owner's children.
  // Keep those entry choices only when the selected export has no authored router of its own;
  // otherwise branch descent would join an ancestor's absolute path below the current child.
  const contextualChoices =
    factoryManifest !== undefined ||
    factoryChoiceInventory.owner !== undefined ||
    ownerDirectChoiceInventory.choices.length > 0
      ? []
      : contextualManifestLocations;
  const choices = Object.freeze(
    [...manifestLocations, ...contextualChoices, ...inferredChoices].filter(
      (choice, index, values) =>
        values.findIndex(
          (other) =>
            other.componentName === choice.componentName && other.pattern === choice.pattern,
        ) === index,
    ),
  );
  const inferredPrimary =
    primaryCandidate === undefined
      ? undefined
      : retargetTransparentRouteComponentLocation(
          freezeRouteLocation(
            primaryCandidate,
            factoryChoiceInventory.owner,
            allDirectChoicesByOccurrence,
            supportingSourcePaths,
            catalogImportersByPath,
            routePatterns,
            options.documentPath,
            options.exportName,
          ),
          options.documentPath,
          options.exportName,
          options.renderChain,
        );
  const contextualPrimary = retainPreviewInspectorNestedRouteOwnerContext(
    inferredPrimary,
    [...ownerDirectResolution.selectable, ...contextualDirectResolution.selectable].map(
      (resolved) =>
        Object.freeze({
          ...resolved.choice,
          pathResolution: 'resolved' as const,
          pattern: resolved.candidate.pattern,
        }),
    ),
    pathSources,
    routePatterns,
  );
  const primary =
    manifestLocations.find((choice) => targetIdentitySet.has(choice.componentName)) ??
    contextualManifestLocations.find((choice) => targetIdentitySet.has(choice.componentName)) ??
    contextualPrimary ??
    choices[0];
  const factoryUnresolvedOptions =
    factoryManifest === undefined
      ? factoryChoices.map((choice) =>
          Object.freeze({
            availability: 'factory-contract-unresolved' as const,
            componentName: choice.componentName,
            kind: choice.kind,
            occurrenceIdentity: createFactoryUnresolvedOccurrenceIdentity(
              options.documentPath,
              choice.kind,
              choice.componentName,
              choice.occurrenceStart,
            ),
          }),
        )
      : factoryManifest.options
          .filter((option) => option.availability !== 'selectable')
          .map((option) =>
            Object.freeze({
              availability: option.availability,
              componentName: option.componentName,
              kind: option.kind,
              occurrenceIdentity: createFactoryUnresolvedOccurrenceIdentity(
                factoryManifest.ownerSourcePath,
                option.kind,
                option.componentName,
                option.occurrenceStart,
              ),
            }),
          );
  const directUnresolvedOptions = ownerDirectResolution.unresolved.map(({ availability, choice }) =>
    Object.freeze({
      availability,
      componentName: choice.componentName,
      kind: 'direct' as const,
      occurrenceIdentity: choice.occurrenceIdentity,
      pattern: choice.pattern,
    }),
  );
  const unresolvedOptions = Object.freeze([
    ...factoryUnresolvedOptions,
    ...directUnresolvedOptions,
  ]);
  return Object.freeze({
    ...(primary === undefined
      ? {}
      : {
          primary,
        }),
    choices,
    ...(ownerDirectResolution.duplicates.length === 0
      ? {}
      : {
          directRouteDuplicates: Object.freeze(
            ownerDirectResolution.duplicates.map(({ candidate, choice }) =>
              Object.freeze({
                componentExportName: choice.reference.exportName,
                componentName: choice.componentName,
                componentSourcePath: choice.reference.sourcePath,
                occurrenceIdentity: choice.occurrenceIdentity,
                pattern: candidate.pattern,
              }),
            ),
          ),
        }),
    fallbackCount: factoryManifest?.fallbacks.length ?? 0,
    unresolvedFactoryRoutes: unresolvedOptions.length > 0,
    ...(unresolvedOptions.length === 0
      ? {}
      : {
          unresolvedFactoryOptionNames: Object.freeze(
            unresolvedOptions.map((option) => option.componentName),
          ),
          unresolvedFactoryOptions: unresolvedOptions,
        }),
  });
}

/** Converts one exact route-factory manifest into selectable browser locations. */
function materializeFactoryManifestLocations(
  manifest:
    | NonNullable<Awaited<ReturnType<typeof collectPreviewInspectorRouteFactoryManifest>>>
    | undefined,
): readonly PreviewInspectorRouteLocation[] {
  if (manifest === undefined) return Object.freeze([]);
  const routePatterns = manifest.routes.map((entry) => entry.absolutePattern);
  return Object.freeze(
    manifest.routes.map((route) => {
      const elementWrappers = route.elementWrappers ?? [];
      return Object.freeze({
        componentExportName: route.componentExportName,
        componentName: route.componentName,
        componentSourcePath: route.componentSourcePath,
        dependencyPaths: Object.freeze(
          [
            ...new Set([
              ...manifest.dependencies,
              ...route.catalogSourcePaths,
              route.componentSourcePath,
              ...elementWrappers.map((wrapper) => wrapper.sourcePath),
            ]),
          ].sort(),
        ),
        ...(elementWrappers.length === 0
          ? {}
          : { elementWrappers: Object.freeze(elementWrappers) }),
        evidenceKind: 'route-catalog' as const,
        pathname: materializeRoutePattern(route.absolutePattern, routePatterns),
        routeMounts: Object.freeze([
          Object.freeze({
            basePath: manifest.basePattern,
            contextOrigin: 'virtual-page-owner' as const,
            contextPattern: createFactoryOwnerContextPattern(manifest.basePattern),
            exportName: manifest.ownerExportName,
            hasWildcardFallback: manifest.fallbacks.length > 0,
            routeSlotCount: manifest.routeSlotCount,
            sourcePath: manifest.ownerSourcePath,
          }),
        ]),
        pattern: route.absolutePattern,
        sourcePath: manifest.ownerSourcePath,
      });
    }),
  );
}

/** Keeps a factory app mounted at its authored base while its own relative Routes select the leaf. */
function createFactoryOwnerContextPattern(basePath: string): string {
  if (/(?:^|\/)\*$/u.test(basePath)) return basePath;
  const normalized = basePath === '/' ? '' : basePath.replace(/\/+$/u, '');
  return `${normalized}/*`;
}

/** Converts occurrence-bound direct evidence into the shared deterministic ranking model. */
function materializeDirectRouteResolution(
  resolution: PreviewInspectorDirectRouteResolution,
  documentPath: string,
  earlyReturnPenalty?: (choice: PreviewInspectorDirectRouteChoice) => number,
): {
  readonly duplicates: readonly DuplicateDirectRouteChoice[];
  readonly selectable: readonly ResolvedDirectRouteChoice[];
  readonly unresolved: PreviewInspectorDirectRouteResolution['unresolved'];
} {
  const create = (
    item:
      | PreviewInspectorDirectRouteResolution['selectable'][number]
      | PreviewInspectorDirectRouteResolution['duplicates'][number],
  ): RouteLocationCandidate | undefined => {
    const candidates: RouteLocationCandidate[] = [];
    addRouteCandidate(candidates, {
      choiceOccurrenceIdentity: item.choice.occurrenceIdentity,
      componentName: item.choice.componentName,
      dependencyPaths: item.dependencyPaths,
      ...(item.directRouteOwnerSourcePath === undefined
        ? {}
        : { directRouteOwnerSourcePath: item.directRouteOwnerSourcePath }),
      documentPath,
      evidenceKind: item.evidenceKind,
      identityOrder: item.identityOrder,
      pattern: item.pattern,
      provenanceIdentity: item.provenanceIdentity,
      scoreAdjustment:
        DIRECT_ROUTE_OCCURRENCE_EVIDENCE_BONUS - (earlyReturnPenalty?.(item.choice) ?? 0),
      sourcePath: item.sourcePath,
    });
    return candidates[0];
  };
  return Object.freeze({
    duplicates: Object.freeze(
      resolution.duplicates.flatMap((item) => {
        const candidate = create(item);
        return candidate === undefined ? [] : [{ candidate, choice: item.choice }];
      }),
    ),
    selectable: Object.freeze(
      resolution.selectable.flatMap((item) => {
        const candidate = create(item);
        return candidate === undefined ? [] : [{ candidate, choice: item.choice }];
      }),
    ),
    unresolved: resolution.unresolved,
  });
}

/** Freezes one ranked candidate with the complete shared evidence needed for hot reload. */
function freezeRouteLocation(
  candidate: RouteLocationCandidate,
  factoryOwner: PreviewInspectorRouteFactoryOwnerEvidence | undefined,
  allDirectChoicesByOccurrence: ReadonlyMap<string, PreviewInspectorDirectRouteChoice>,
  supportingSourcePaths: ReadonlySet<string>,
  catalogImportersByPath: ReadonlyMap<string, ReadonlySet<string>>,
  routePatterns: readonly string[],
  documentPath: string,
  exportName: string,
): PreviewInspectorRouteLocation {
  const directChoice =
    candidate.choiceOccurrenceIdentity === undefined
      ? undefined
      : allDirectChoicesByOccurrence.get(candidate.choiceOccurrenceIdentity);
  const componentReference = directChoice?.reference;
  const elementWrappers = [
    ...collectDirectRouteElementWrappers(directChoice, componentReference),
  ].filter(
    (wrapper, index, values) =>
      values.findIndex(
        (candidate) =>
          path.normalize(candidate.sourcePath) === path.normalize(wrapper.sourcePath) &&
          candidate.exportName === wrapper.exportName,
      ) === index,
  );
  const selectedCatalogImporters =
    candidate.evidenceKind === 'route-catalog'
      ? (catalogImportersByPath.get(candidate.sourcePath) ?? [])
      : [];
  const directRouteOwnerSourcePath = candidate.directRouteOwnerSourcePath;
  const authenticatedDirectOwner =
    directRouteOwnerSourcePath !== undefined &&
    path.normalize(directRouteOwnerSourcePath) === path.normalize(documentPath)
      ? Object.freeze({ exportName, sourcePath: path.normalize(directRouteOwnerSourcePath) })
      : undefined;
  const sameOwnerDirectChoices =
    authenticatedDirectOwner === undefined
      ? []
      : [...allDirectChoicesByOccurrence.values()].filter(
          (choice) =>
            path.normalize(choice.sourcePath) === authenticatedDirectOwner.sourcePath &&
            choice.pathResolution === 'resolved',
        );
  return Object.freeze({
    ...(componentReference === undefined
      ? {}
      : {
          componentExportName: componentReference.exportName,
          componentSourcePath: componentReference.sourcePath,
        }),
    componentName: candidate.componentName,
    dependencyPaths: Object.freeze(
      [
        ...new Set([
          candidate.sourcePath,
          ...(componentReference === undefined ? [] : [componentReference.sourcePath]),
          ...elementWrappers.map((wrapper) => wrapper.sourcePath),
          ...(candidate.dependencyPaths ?? []),
          ...supportingSourcePaths,
          ...selectedCatalogImporters,
        ]),
      ].sort(),
    ),
    evidenceKind: candidate.evidenceKind,
    ...(directRouteOwnerSourcePath === undefined ? {} : { directRouteOwnerSourcePath }),
    ...(elementWrappers.length === 0 ? {} : { elementWrappers: Object.freeze(elementWrappers) }),
    pathname: materializeRoutePattern(candidate.pattern, routePatterns),
    ...(authenticatedDirectOwner !== undefined
      ? {
          routeMounts: Object.freeze([
            Object.freeze({
              basePath: '/',
              exportName: authenticatedDirectOwner.exportName,
              hasWildcardFallback: sameOwnerDirectChoices.some((choice) =>
                /(?:^|\/)\*$/u.test(choice.pattern),
              ),
              routeSlotCount: sameOwnerDirectChoices.length,
              sourcePath: authenticatedDirectOwner.sourcePath,
            }),
          ]),
        }
      : factoryOwner === undefined ||
          ((candidate.componentName !== factoryOwner.exportName ||
            path.normalize(candidate.sourcePath) !== path.normalize(factoryOwner.sourcePath)) &&
            componentReference === undefined)
        ? {}
        : {
            routeMounts: Object.freeze([
              Object.freeze({
                basePath: factoryOwner.basePath,
                // An unresolved page map still leaves this exact factory owner's relative Routes
                // proven. Keep its outer Router context so the authored map can choose the page.
                ...(candidate.componentName === factoryOwner.exportName &&
                path.normalize(candidate.sourcePath) === path.normalize(factoryOwner.sourcePath) &&
                candidate.pattern ===
                  normalizePreviewInspectorRoutePattern(factoryOwner.basePath) &&
                factoryOwner.routeSlotCount > 0
                  ? {
                      contextOrigin: 'virtual-page-owner' as const,
                      contextPattern: createFactoryOwnerContextPattern(factoryOwner.basePath),
                    }
                  : {}),
                exportName: factoryOwner.exportName,
                hasWildcardFallback: factoryOwner.hasWildcardFallback,
                routeSlotCount: factoryOwner.routeSlotCount,
                sourcePath: factoryOwner.sourcePath,
              }),
            ]),
          }),
    pattern: candidate.pattern,
    sourcePath: candidate.sourcePath,
  });
}

/** Keeps only resolved outer components before the selected terminal route page. */
function collectDirectRouteElementWrappers(
  choice: PreviewInspectorDirectRouteChoice | undefined,
  selectedReference: PreviewInspectorDirectRouteComponentReference | undefined,
): PreviewInspectorRouteElementWrapperEvidence[] {
  if (choice?.elementPath === undefined || selectedReference === undefined) return [];
  let selectedIndex = -1;
  for (let index = choice.elementPath.length - 1; index >= 0; index -= 1) {
    const reference = choice.elementPath[index]?.reference;
    if (
      reference?.sourcePath === selectedReference.sourcePath &&
      reference.exportName === selectedReference.exportName
    ) {
      selectedIndex = index;
      break;
    }
  }
  if (selectedIndex <= 0) return [];
  const identities = new Set<string>();
  return choice.elementPath.slice(0, selectedIndex).flatMap((component) => {
    const reference = component.reference;
    if (reference === undefined) return [];
    const identity = `${path.normalize(reference.sourcePath)}\0${reference.exportName}`;
    if (identities.has(identity)) return [];
    identities.add(identity);
    return [
      Object.freeze({
        componentName: component.componentName,
        exportName: reference.exportName,
        sourcePath: path.normalize(reference.sourcePath),
      }),
    ];
  });
}
