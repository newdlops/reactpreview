/**
 * Infers a safe browser location for one statically proven Page Inspector render path.
 *
 * A detached application shell mounted under MemoryRouter at `/` often renders its login, error,
 * or index branch even though the target page is present deeper in that shell. This analyzer reads
 * only authored syntax and route-catalog JSON; it never imports a router, executes configuration,
 * or starts the application. Dynamic parameters receive deterministic constraint-compatible
 * preview values.
 */
import path from 'node:path';
import ts from 'typescript';
import type { PreviewRenderChainPlan, ResolvePreviewRenderGraphModule } from '../renderGraph';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';
import {
  collectPreviewInspectorDirectRouteChoices,
  collectPreviewInspectorDirectRouteChoicesFromSource,
  type PreviewInspectorDirectRouteChoice,
  type PreviewInspectorDirectRouteComponentReference,
} from './previewInspectorDirectRouteChoices';
import {
  collectPreviewInspectorDirectRouteRegistrySources,
  isPreviewInspectorRouteRegistrySource,
  materializePreviewInspectorRouteBasePath,
} from './previewInspectorRoutePathMetadata';
import { collectPreviewInspectorRouteFactoryEvidence } from './previewInspectorRouteFactory';
import { collectPreviewInspectorRouteFactoryManifest } from './previewInspectorRouteFactoryManifest';
import type { PreviewInspectorFactoryRouteAvailability } from './previewInspectorRouteFactoryManifestTypes';
import {
  collectPreviewInspectorRouteFactoryChoices,
  type PreviewInspectorRouteFactoryOwnerEvidence,
  type PreviewInspectorRouteChoiceReference,
} from './previewInspectorRouteFactoryChoices';
import {
  addPreviewInspectorSupportingRoutePattern as addSupportingRoutePattern,
  isPreviewInspectorRootWildcardRoutePattern as isRootWildcardRoutePattern,
  joinPreviewInspectorRouteSegments as joinRouteSegments,
  materializePreviewInspectorRoutePattern as materializeRoutePattern,
  normalizePreviewInspectorRoutePattern as normalizeRoutePattern,
} from './previewInspectorRoutePattern';

const MAX_ROUTE_REGISTRY_SOURCES = 48;
const MAX_ROUTE_CATALOGS = 16;
/*
 * Candidates are inert path/component records. The branch planner admits only one active choice to
 * the bundle corridor, so retaining a large application catalog here does not bundle every page.
 */
const MAX_ROUTE_CANDIDATES = 4_096;
const FACTORY_BASE_EVIDENCE_PENALTY = 25;
const ROOT_WILDCARD_EVIDENCE_PENALTY = 100;
const COMPONENT_IDENTITY_PATTERN = /^[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*$/u;

/** Static evidence retained with the inferred location for diagnostics and hot reload. */
export interface PreviewInspectorRouteLocation {
  /** Public ESM binding rendered by this route choice, when import syntax proves it. */
  readonly componentExportName?: string;
  /** Component/export spelling whose catalog leaf or Route element matched the target. */
  readonly componentName: string;
  /** Resolved authored module rendered by this route choice, when package resolution succeeds. */
  readonly componentSourcePath?: string;
  /**
   * Selected router-owner modules plus the final page module for one recursively resolved branch.
   *
   * Ordinary direct routes omit this field. The corridor consumes it only at build time; browser
   * descriptors receive the public component/path identities without local filesystem disclosure.
   */
  readonly componentSourcePaths?: readonly string[];
  /** Kind of inert source evidence used to choose the route. */
  readonly evidenceKind: 'route-catalog' | 'route-jsx';
  /** Every source whose route pattern participated in the materialized browser pathname. */
  readonly dependencyPaths: readonly string[];
  /** Inline layout/provider components authored around the selected terminal route page. */
  readonly elementWrappers?: readonly PreviewInspectorRouteElementWrapperEvidence[];
  /** Browser-ready path with every dynamic segment replaced by a deterministic preview value. */
  readonly pathname: string;
  /** Outer-to-inner app-module mounts that own this selected route, when syntax proves them. */
  readonly routeMounts?: readonly PreviewInspectorRouteMountEvidence[];
  /** Authored route pattern before neutral dynamic values were substituted. */
  readonly pattern: string;
  /** Absolute authored source that should invalidate this inference during hot reload. */
  readonly sourcePath: string;
}

/** One immutable app-module mount used to localize a directly mounted route owner. */
export interface PreviewInspectorRouteMountEvidence {
  readonly basePath: string;
  readonly exportName: string;
  readonly hasWildcardFallback: boolean;
  readonly routeSlotCount: number;
  readonly sourcePath: string;
}

/** One exact outer-to-inner component wrapper authored in a selected route element. */
export interface PreviewInspectorRouteElementWrapperEvidence {
  readonly componentName: string;
  readonly exportName: string;
  readonly sourcePath: string;
}

/**
 * One target route plus the concrete descendant pages owned by a selected route factory.
 *
 * `primary` reproduces the historical single-location contract. `choices` exists only when the
 * selected export is itself a factory-produced router whose page-map entries have exact route
 * evidence; ordinary leaf components therefore keep the previous one-candidate behavior.
 */
export interface PreviewInspectorRouteLocationInventory {
  /** Best route that directly names the selected target or one of its proven aliases. */
  readonly primary?: PreviewInspectorRouteLocation;
  /** Mutually exclusive visible pages rendered below the selected Provider/Routes owner. */
  readonly choices: readonly PreviewInspectorRouteLocation[];
  /** Number of literal wildcard fallbacks retained as non-selectable metadata. */
  readonly fallbackCount: number;
  /** True when a factory was proven but one or more generated choices lack safe path evidence. */
  readonly unresolvedFactoryRoutes: boolean;
  /** Names retained when a factory exposed choices but their path proof is incomplete. */
  readonly unresolvedFactoryOptionNames?: readonly string[];
  /** Structured disabled choices for the route explorer; no source text is exposed. */
  readonly unresolvedFactoryOptions?: readonly {
    readonly availability: Exclude<PreviewInspectorFactoryRouteAvailability, 'selectable'>;
    readonly componentName: string;
    readonly kind: 'page' | 'submodule';
  }[];
}

/** Inputs kept independent from the ancestor planner so route inference is unit-testable. */
export interface CollectPreviewInspectorRouteLocationOptions {
  /** Selected source module in the editor. */
  readonly documentPath: string;
  /** Selected runtime export, including `default`. */
  readonly exportName: string;
  /** Snapshot-aware, package-bounded source reader owned by the caller. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Optional project-aware resolver used for relative and workspace-alias JSON catalog imports. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Exact target-to-entry evidence already computed for Page Inspector. */
  readonly renderChain: PreviewRenderChainPlan;
  /** Existing bounded authored source inventory; no second directory walk is performed. */
  readonly sourcePaths: readonly string[];
}

interface RouteLocationCandidate extends Omit<PreviewInspectorRouteLocation, 'dependencyPaths'> {
  readonly identityOrder: number;
  readonly score: number;
}

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
  const directChoiceInventory = await collectPreviewInspectorDirectRouteChoices({
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
  const manifestLocations =
    factoryManifest?.routes.map((route) => {
      const factoryReference = factoryChoiceInventory.references.get(route.componentName);
      const elementWrappers = factoryReference?.elementWrappers ?? [];
      return Object.freeze({
        ...(route.componentExportName === undefined
          ? {}
          : { componentExportName: route.componentExportName }),
        componentName: route.componentName,
        ...(route.componentSourcePath === undefined
          ? {}
          : { componentSourcePath: route.componentSourcePath }),
        dependencyPaths: Object.freeze(
          [
            ...new Set([
              ...factoryManifest.dependencies,
              ...(route.componentSourcePath === undefined ? [] : [route.componentSourcePath]),
              ...elementWrappers.map((wrapper) => wrapper.sourcePath),
            ]),
          ].sort(),
        ),
        ...(elementWrappers.length === 0
          ? {}
          : { elementWrappers: Object.freeze(elementWrappers) }),
        evidenceKind: 'route-catalog' as const,
        pathname: materializeRoutePattern(
          route.absolutePattern,
          factoryManifest.routes.map((entry) => entry.absolutePattern),
        ),
        routeMounts: Object.freeze([
          Object.freeze({
            basePath: factoryManifest.basePattern,
            exportName: factoryManifest.ownerExportName,
            hasWildcardFallback: factoryManifest.fallbacks.length > 0,
            routeSlotCount: factoryManifest.routeSlotCount,
            sourcePath: factoryManifest.ownerSourcePath,
          }),
        ]),
        pattern: route.absolutePattern,
        sourcePath: factoryManifest.ownerSourcePath,
      });
    }) ?? [];
  const factoryChoices = factoryChoiceInventory.choices;
  const choiceComponentNames = [
    ...new Set([
      ...factoryChoices.map((choice) => choice.componentName),
      ...directChoiceInventory.choices.map((choice) => choice.componentName),
    ]),
  ];
  const factoryChoiceReferences = factoryChoiceInventory.references;
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
    ...directChoiceInventory.dependencyPaths,
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
      ...directChoiceInventory.dependencyPaths,
      ...registrySources,
    ]),
  ];
  const candidates: RouteLocationCandidate[] = [];
  const directChoicesByKey = new Map<string, PreviewInspectorDirectRouteChoice>();
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
      const identityOrder = identities.indexOf(choice.componentName);
      supportingSourcePaths.add(choice.sourcePath);
      if (choice.pathResolution === 'resolved')
        addSupportingRoutePattern(routePatterns, choice.pattern);
      if (identityOrder < 0) continue;
      if (choice.pathResolution === 'unresolved') continue;
      directChoicesByKey.set(createDirectRouteReferenceKey(choice), choice);
      addRouteCandidate(candidates, {
        componentName: choice.componentName,
        documentPath: options.documentPath,
        evidenceKind: 'route-jsx',
        identityOrder,
        pattern: choice.pattern,
        sourcePath: choice.sourcePath,
      });
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

  for (const choice of directChoiceInventory.choices) {
    if (candidates.length >= MAX_ROUTE_CANDIDATES) break;
    if (choice.routeBasePath === undefined || choice.reference === undefined) continue;
    const identityOrder = identities.indexOf(choice.componentName);
    if (identityOrder < 0) continue;
    const pattern = await materializePreviewInspectorRouteBasePath(
      choice.routeBasePath,
      (sourcePath) => readCachedSource(sourcePath, options.readSource, sourceCache),
      choice.sourcePath,
    );
    if (pattern === undefined) continue;
    const normalizedPattern = normalizeRoutePattern(pattern);
    if (normalizedPattern === undefined) continue;
    const materializedChoice = Object.freeze({ ...choice, pattern: normalizedPattern });
    directChoicesByKey.set(createDirectRouteReferenceKey(materializedChoice), materializedChoice);
    addRouteCandidate(candidates, {
      componentName: choice.componentName,
      documentPath: options.documentPath,
      evidenceKind: 'route-jsx',
      identityOrder,
      pattern: normalizedPattern,
      sourcePath: choice.sourcePath,
    });
  }

  const rankedCandidates = candidates.sort(compareRouteCandidates);
  const primaryCandidate =
    rankedCandidates.find((candidate) => targetIdentitySet.has(candidate.componentName)) ??
    rankedCandidates[0];
  const factoryChoiceCandidates = factoryChoices.flatMap(({ componentName }) => {
    const candidate = rankedCandidates.find((item) => item.componentName === componentName);
    return candidate === undefined ? [] : [candidate];
  });
  const directChoiceCandidates = directChoiceInventory.choices.flatMap((choice) => {
    const candidatesForChoice =
      choice.pathResolution === 'resolved'
        ? rankedCandidates.filter(
            (item) =>
              item.componentName === choice.componentName &&
              item.pattern === choice.pattern &&
              path.normalize(item.sourcePath) === path.normalize(choice.sourcePath),
          )
        : rankedCandidates.filter(
            (item) =>
              (item.componentName === choice.componentName &&
                item.evidenceKind === 'route-catalog') ||
              (choice.routeBasePath !== undefined &&
                item.componentName === choice.componentName &&
                item.evidenceKind === 'route-jsx' &&
                path.normalize(item.sourcePath) === path.normalize(choice.sourcePath) &&
                directChoicesByKey.has(createDirectRouteReferenceKey(item))),
          );
    for (const candidate of candidatesForChoice) {
      const key = createDirectRouteReferenceKey(candidate);
      if (!directChoicesByKey.has(key)) directChoicesByKey.set(key, choice);
    }
    return candidatesForChoice;
  });
  const choiceCandidates = [...factoryChoiceCandidates, ...directChoiceCandidates].filter(
    (candidate, index, values) =>
      values.findIndex(
        (item) =>
          item.componentName === candidate.componentName &&
          item.pattern === candidate.pattern &&
          item.sourcePath === candidate.sourcePath,
      ) === index,
  );
  const inferredChoices = choiceCandidates.map((candidate) =>
    freezeRouteLocation(
      candidate,
      factoryChoiceReferences,
      factoryChoiceInventory.owner,
      directChoicesByKey,
      supportingSourcePaths,
      catalogImportersByPath,
      routePatterns,
    ),
  );
  const choices = Object.freeze(
    [...manifestLocations, ...inferredChoices].filter(
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
      : freezeRouteLocation(
          primaryCandidate,
          factoryChoiceReferences,
          factoryChoiceInventory.owner,
          directChoicesByKey,
          supportingSourcePaths,
          catalogImportersByPath,
          routePatterns,
        );
  const primary =
    manifestLocations.find((choice) => targetIdentitySet.has(choice.componentName)) ??
    inferredPrimary ??
    choices[0];
  return Object.freeze({
    ...(primary === undefined
      ? {}
      : {
          primary,
        }),
    choices,
    fallbackCount: factoryManifest?.fallbacks.length ?? 0,
    unresolvedFactoryRoutes: (factoryManifest?.unresolvedChoiceNames.length ?? 0) > 0,
    ...(factoryManifest === undefined
      ? {}
      : {
          unresolvedFactoryOptionNames: factoryManifest.unresolvedChoiceNames,
          unresolvedFactoryOptions: Object.freeze(
            factoryManifest.options
              .filter((option) => option.availability !== 'selectable')
              .map((option) =>
                Object.freeze({
                  availability: option.availability,
                  componentName: option.componentName,
                  kind: option.kind,
                }),
              ),
          ),
        }),
  });
}

/** Freezes one ranked candidate with the complete shared evidence needed for hot reload. */
function freezeRouteLocation(
  candidate: RouteLocationCandidate,
  choiceReferences: ReadonlyMap<string, PreviewInspectorRouteChoiceReference>,
  factoryOwner: PreviewInspectorRouteFactoryOwnerEvidence | undefined,
  directChoicesByKey: ReadonlyMap<string, PreviewInspectorDirectRouteChoice>,
  supportingSourcePaths: ReadonlySet<string>,
  catalogImportersByPath: ReadonlyMap<string, ReadonlySet<string>>,
  routePatterns: readonly string[],
): PreviewInspectorRouteLocation {
  const directChoice = directChoicesByKey.get(createDirectRouteReferenceKey(candidate));
  const factoryReference = choiceReferences.get(candidate.componentName);
  const componentReference = directChoice?.reference ?? factoryReference;
  const elementWrappers = [
    ...collectDirectRouteElementWrappers(directChoice, componentReference),
    ...(factoryReference?.elementWrappers ?? []),
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
          ...supportingSourcePaths,
          ...selectedCatalogImporters,
        ]),
      ].sort(),
    ),
    evidenceKind: candidate.evidenceKind,
    ...(elementWrappers.length === 0 ? {} : { elementWrappers: Object.freeze(elementWrappers) }),
    pathname: materializeRoutePattern(candidate.pattern, routePatterns),
    ...(factoryOwner === undefined ||
    ((candidate.componentName !== factoryOwner.exportName ||
      path.normalize(candidate.sourcePath) !== path.normalize(factoryOwner.sourcePath)) &&
      !choiceReferences.has(candidate.componentName))
      ? {}
      : {
          routeMounts: Object.freeze([
            Object.freeze({
              basePath: factoryOwner.basePath,
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

/** Keys a direct component reference by its exact router source, component, and authored pattern. */
function createDirectRouteReferenceKey(input: {
  readonly componentName: string;
  readonly pattern: string;
  readonly sourcePath: string;
}): string {
  return `${path.normalize(input.sourcePath)}\0${input.pattern}\0${input.componentName}`;
}

/** Builds only identities that can denote the exact selected export in its own source module. */
function collectSelectedTargetIdentities(
  options: CollectPreviewInspectorRouteLocationOptions,
  targetText: string | undefined,
): readonly string[] {
  const identities: string[] = [];
  const add = (candidate: string | undefined): void => {
    const normalized = normalizeComponentIdentity(candidate);
    if (normalized !== undefined && !identities.includes(normalized)) identities.push(normalized);
  };
  if (options.exportName !== 'default') add(options.exportName);
  if (targetText !== undefined) {
    const facts = collectPreviewRenderModuleFacts(options.documentPath, targetText);
    for (const exportFact of facts.exports) {
      if (exportFact.exportName !== options.exportName || exportFact.localName === undefined) {
        continue;
      }
      add(exportFact.localName);
      for (const value of facts.values) {
        if (value.localName === exportFact.localName) add(value.label);
      }
    }
  }
  for (const renderPath of options.renderChain.paths) {
    for (const step of renderPath.steps) {
      if (path.normalize(step.sourcePath) !== path.normalize(options.documentPath)) continue;
      add(step.label);
      for (const wrapperName of step.wrapperNames) add(wrapperName);
    }
  }
  add(toPascalCase(path.basename(options.documentPath).replace(/\.[^.]+$/u, '')));
  return Object.freeze(identities);
}

/** Builds exact target aliases from the selected export, local declaration, filename, and graph. */
function collectTargetIdentities(
  options: CollectPreviewInspectorRouteLocationOptions,
  targetText: string | undefined,
): readonly string[] {
  const identities = [...collectSelectedTargetIdentities(options, targetText)];
  const add = (candidate: string | undefined): void => {
    const normalized = normalizeComponentIdentity(candidate);
    if (normalized !== undefined && !identities.includes(normalized)) identities.push(normalized);
  };
  if (options.exportName !== 'default') add(options.exportName);
  if (targetText !== undefined) {
    const facts = collectPreviewRenderModuleFacts(options.documentPath, targetText);
    const selectedExports = facts.exports.filter(
      (fact) => fact.exportName === options.exportName && fact.localName !== undefined,
    );
    for (const exportFact of selectedExports) {
      add(exportFact.localName);
      for (const value of facts.values) {
        if (value.localName === exportFact.localName) add(value.label);
      }
    }
    for (const value of facts.values) add(value.label);
  }
  for (const renderPath of options.renderChain.paths) {
    // Render paths are stored target-to-entry (inner-to-outer). Preserve that order so a concrete
    // page owner outranks the application shell's broad `/*` or index route.
    for (const step of renderPath.steps) {
      add(step.label);
      for (const wrapperName of step.wrapperNames) add(wrapperName);
    }
  }
  add(toPascalCase(path.basename(options.documentPath).replace(/\.[^.]+$/u, '')));
  return Object.freeze(identities);
}

/** Accepts only plain component identifiers and removes graph labels around an identifier. */
function normalizeComponentIdentity(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const direct = value.trim();
  if (COMPONENT_IDENTITY_PATTERN.test(direct) && /^[$_\p{Lu}]/u.test(direct)) return direct;
  const matches = direct.match(/[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*/gu) ?? [];
  return matches.find((candidate) => COMPONENT_IDENTITY_PATTERN.test(candidate));
}

/** Converts a kebab/snake/dotted source stem into the conventional component export spelling. */
function toPascalCase(value: string): string {
  return value
    .split(/[^$_\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join('');
}

/** Keeps exact render-path sources first because they are the cheapest and strongest evidence. */
function collectRenderPathSourcePaths(renderChain: PreviewRenderChainPlan): readonly string[] {
  return [
    ...new Set(
      renderChain.paths.flatMap((renderPath) => [
        ...renderPath.steps.map((step) => path.normalize(step.sourcePath)),
        ...(renderPath.entryPoint === undefined
          ? []
          : [path.normalize(renderPath.entryPoint.sourcePath)]),
      ]),
    ),
  ];
}

/** Counts common normalized path segments so the target's monorepo package is inspected first. */
function scoreRouteRegistryLocality(sourcePath: string, documentPath: string): number {
  const sourceSegments = path.normalize(sourcePath).split(path.sep).filter(Boolean);
  const documentSegments = path.normalize(documentPath).split(path.sep).filter(Boolean);
  let score = 0;
  while (
    score < sourceSegments.length &&
    score < documentSegments.length &&
    sourceSegments[score] === documentSegments[score]
  ) {
    score += 1;
  }
  return score;
}

/** Prefers target-local registries, then explicit maps/configs and stable path order. */
function compareRouteRegistryPaths(left: string, right: string, documentPath: string): number {
  const score = (sourcePath: string): number =>
    /[-_.](?:map|paths?|config|registry)\./iu.test(path.basename(sourcePath)) ? 0 : 1;
  return (
    scoreRouteRegistryLocality(right, documentPath) -
      scoreRouteRegistryLocality(left, documentPath) ||
    score(left) - score(right) ||
    left.localeCompare(right)
  );
}

/** Extracts inert JSON imports while rejecting URLs, absolute paths, and Node protocol modules. */
function collectJsonCatalogSpecifiers(sourcePath: string, sourceText: string): readonly string[] {
  return collectPreviewRenderModuleFacts(sourcePath, sourceText)
    .imports.map((fact) => fact.moduleSpecifier)
    .filter((specifier) => {
      const cleanSpecifier = specifier.split(/[?#]/u, 1)[0];
      return (
        cleanSpecifier !== undefined &&
        cleanSpecifier.toLowerCase().endsWith('.json') &&
        !path.isAbsolute(cleanSpecifier) &&
        !/^[a-z][a-z\d+.-]*:/iu.test(cleanSpecifier)
      );
    });
}

/** Resolves relative or alias JSON catalogs through the caller's package-bounded module resolver. */
function resolveRouteCatalogPath(
  moduleSpecifier: string,
  consumerPath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
): string | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0];
  if (!cleanSpecifier?.toLowerCase().endsWith('.json')) {
    return undefined;
  }
  const relative = cleanSpecifier.startsWith('./') || cleanSpecifier.startsWith('../');
  const resolved =
    resolveModule?.(cleanSpecifier, consumerPath) ??
    (relative ? path.resolve(path.dirname(consumerPath), cleanSpecifier) : undefined);
  return resolved === undefined ? undefined : path.normalize(resolved);
}

/** Parses one JSON route tree and records exact string leaves matching a target identity. */
function collectJsonCatalogCandidates(
  sourcePath: string,
  sourceText: string,
  identities: readonly string[],
  documentPath: string,
  candidates: RouteLocationCandidate[],
): void {
  let catalog: unknown;
  try {
    catalog = JSON.parse(sourceText) as unknown;
  } catch {
    return;
  }
  walkCatalog(catalog, [], (segments, componentName) => {
    const identityOrder = identities.indexOf(componentName);
    if (identityOrder < 0 || candidates.length >= MAX_ROUTE_CANDIDATES) return;
    addRouteCandidate(candidates, {
      componentName,
      documentPath,
      evidenceKind: 'route-catalog',
      identityOrder,
      pattern: joinRouteSegments(segments),
      sourcePath,
    });
  });
}

/** Walks nested path-keyed objects plus common array/object route descriptor shapes. */
function walkCatalog(
  value: unknown,
  segments: readonly string[],
  visit: (segments: readonly string[], componentName: string) => void,
): void {
  if (typeof value === 'string') {
    visit(segments, value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkCatalog(item, segments, visit);
    return;
  }
  if (!isRecord(value)) return;
  const routePath = typeof value.path === 'string' ? value.path : undefined;
  const descriptorSegments = routePath === undefined ? segments : [...segments, routePath];
  for (const key of ['component', 'element', 'page', 'pageName', 'screen'] as const) {
    if (typeof value[key] === 'string') visit(descriptorSegments, value[key]);
  }
  for (const [key, child] of Object.entries(value)) {
    if (['component', 'element', 'page', 'pageName', 'path', 'screen'].includes(key)) continue;
    walkCatalog(child, [...segments, key], visit);
  }
}

/**
 * Finds route evidence in one authored module without evaluating its router configuration.
 *
 * Both JSX `<Route>` trees and the object descriptors consumed by `useRoutes` are common in the
 * same application. Factory base paths are retained as supporting patterns: they need not render
 * the target directly, but often hold a stricter dynamic-parameter contract than an outer splat.
 */
function collectSourceRouteCandidates(
  sourcePath: string,
  sourceText: string,
  identities: readonly string[],
  factoryOwnerIdentities: ReadonlySet<string>,
  documentPath: string,
  candidates: RouteLocationCandidate[],
  routePatterns: string[],
): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let contributedRoutePattern = false;
  for (const factory of collectPreviewInspectorRouteFactoryEvidence(sourceFile)) {
    contributedRoutePattern =
      addSupportingRoutePattern(routePatterns, factory.basePath) || contributedRoutePattern;
    const identityOrder =
      factory.componentName === undefined ? -1 : identities.indexOf(factory.componentName);
    if (
      identityOrder < 0 ||
      factory.componentName === undefined ||
      !factoryOwnerIdentities.has(factory.componentName)
    ) {
      continue;
    }
    // A nested app/module may have no direct catalog leaf. Its own absolute factory path is still
    // exact route evidence when the render graph proves that exported owner lies on the target path.
    addRouteCandidate(candidates, {
      componentName: factory.componentName,
      documentPath,
      evidenceKind: 'route-jsx',
      identityOrder,
      pattern: factory.basePath,
      scoreAdjustment: -FACTORY_BASE_EVIDENCE_PENALTY,
      sourcePath,
    });
  }
  return contributedRoutePattern;
}

/** Adds one normalized route and keeps distinct authored patterns even when paths materialize alike. */
function addRouteCandidate(
  candidates: RouteLocationCandidate[],
  input: Omit<RouteLocationCandidate, 'pathname' | 'score'> & {
    readonly documentPath: string;
    readonly scoreAdjustment?: number;
  },
): void {
  if (candidates.length >= MAX_ROUTE_CANDIDATES) return;
  const pattern = normalizeRoutePattern(input.pattern);
  if (pattern === undefined) return;
  const pathname = materializeRoutePattern(pattern);
  if (
    candidates.some(
      (candidate) =>
        candidate.pattern === pattern && candidate.componentName === input.componentName,
    )
  ) {
    return;
  }
  candidates.push({
    componentName: input.componentName,
    evidenceKind: input.evidenceKind,
    identityOrder: input.identityOrder,
    pathname,
    pattern,
    score:
      scoreRoutePattern(pattern, input.documentPath, input.identityOrder, input.evidenceKind) +
      (input.scoreAdjustment ?? 0),
    sourcePath: path.normalize(input.sourcePath),
  });
}

/** Favors exact identities, catalog evidence, and routes whose words agree with the target path. */
function scoreRoutePattern(
  pattern: string,
  documentPath: string,
  identityOrder: number,
  evidenceKind: PreviewInspectorRouteLocation['evidenceKind'],
): number {
  const documentWords = new Set(
    documentPath
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 2),
  );
  const routeWords = pattern
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  const overlappingWords = routeWords.filter((word) => documentWords.has(word)).length;
  return (
    10_000 -
    identityOrder * 100 +
    overlappingWords * 25 +
    (evidenceKind === 'route-catalog' ? 20 : 0) +
    Math.min(routeWords.length, 20) -
    (isRootWildcardRoutePattern(pattern) ? ROOT_WILDCARD_EVIDENCE_PENALTY : 0)
  );
}

/** Orders by evidence score, then specificity and lexical identity for deterministic rebuilds. */
function compareRouteCandidates(
  left: RouteLocationCandidate,
  right: RouteLocationCandidate,
): number {
  return (
    right.score - left.score ||
    right.pattern.length - left.pattern.length ||
    left.pattern.localeCompare(right.pattern) ||
    left.sourcePath.localeCompare(right.sourcePath)
  );
}

/** Reuses bounded source reads while keeping rejected/missing files cached as absence. */
function readCachedSource(
  sourcePath: string,
  readSource: (sourcePath: string) => Promise<string | undefined>,
  cache: Map<string, Promise<string | undefined>>,
): Promise<string | undefined> {
  const normalizedPath = path.normalize(sourcePath);
  let sourcePromise = cache.get(normalizedPath);
  if (sourcePromise === undefined) {
    sourcePromise = readSource(normalizedPath);
    cache.set(normalizedPath, sourcePromise);
  }
  return sourcePromise;
}

/** Narrows parsed JSON without invoking inherited values or accessors. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
