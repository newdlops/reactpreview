/** Resolves direct route syntax through evidence bound to each exact authored occurrence. */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type {
  PreviewInspectorDirectRouteChoice,
  PreviewInspectorDirectRouteComponentReference,
} from './previewInspectorDirectRouteChoiceTypes';
import { collectPreviewInspectorRouteFactoryCatalog } from './previewInspectorRouteFactoryCatalog';
import type { PreviewInspectorFactoryRouteAvailability } from './previewInspectorRouteFactoryManifestTypes';
import { materializePreviewInspectorRouteBasePath } from './previewInspectorRoutePathMetadata';
import { normalizePreviewInspectorRoutePattern as normalizeRoutePattern } from './previewInspectorRoutePattern';

/** One exact direct occurrence whose component and path evidence are both resolved. */
export interface PreviewInspectorResolvedDirectRouteEvidence {
  readonly choice: PreviewInspectorDirectRouteChoice;
  readonly dependencyPaths: readonly string[];
  readonly directRouteOwnerSourcePath?: string;
  readonly evidenceKind: 'route-catalog' | 'route-jsx';
  readonly identityOrder: number;
  readonly pattern: string;
  readonly provenanceIdentity: string;
  readonly sourcePath: string;
}

/** A repeated occurrence with exactly the same public selection and provenance. */
export interface PreviewInspectorDuplicateDirectRouteEvidence
  extends PreviewInspectorResolvedDirectRouteEvidence {
  readonly choice: PreviewInspectorDirectRouteChoice & {
    readonly reference: PreviewInspectorDirectRouteComponentReference;
  };
}

/** One direct occurrence that cannot safely become a selectable branch. */
export interface PreviewInspectorUnresolvedDirectRouteEvidence {
  readonly availability: Exclude<PreviewInspectorFactoryRouteAvailability, 'selectable'>;
  readonly choice: PreviewInspectorDirectRouteChoice;
}

export interface PreviewInspectorDirectRouteResolution {
  readonly duplicates: readonly PreviewInspectorDuplicateDirectRouteEvidence[];
  readonly selectable: readonly PreviewInspectorResolvedDirectRouteEvidence[];
  readonly unresolved: readonly PreviewInspectorUnresolvedDirectRouteEvidence[];
}

interface ResolvePreviewInspectorDirectRouteChoicesOptions {
  readonly choices: readonly PreviewInspectorDirectRouteChoice[];
  readonly identities: readonly string[];
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
}

/** Follows only the immutable binding chain attached to each collected route occurrence. */
export async function resolvePreviewInspectorDirectRouteChoices(
  options: ResolvePreviewInspectorDirectRouteChoicesOptions,
): Promise<PreviewInspectorDirectRouteResolution> {
  const resolved: PreviewInspectorResolvedDirectRouteEvidence[] = [];
  const unresolved: PreviewInspectorUnresolvedDirectRouteEvidence[] = [];
  for (const [choiceIndex, choice] of options.choices.entries()) {
    const listedIdentityOrder = options.identities.indexOf(choice.componentName);
    const identityOrder =
      listedIdentityOrder < 0 ? options.identities.length + choiceIndex : listedIdentityOrder;
    const evidence = choice.pathEvidence;
    if (evidence.kind === 'literal') {
      const item = createResolvedEvidence(
        choice,
        choice.pattern,
        choice.sourcePath,
        'route-jsx',
        identityOrder,
        [choice.sourcePath, ...(choice.reference === undefined ? [] : [choice.reference.sourcePath])],
      );
      if (item === undefined) unresolved.push({ availability: 'catalog-unresolved', choice });
      else resolved.push(item);
      continue;
    }
    if (choice.reference === undefined) {
      unresolved.push({ availability: 'component-unresolved', choice });
      continue;
    }
    const resolvedChoice = withReference(choice);
    if (evidence.kind === 'component-base') {
      const pattern = await materializePreviewInspectorRouteBasePath(
        evidence.reference,
        options.readSource,
        choice.sourcePath,
      );
      const item =
        pattern === undefined
          ? undefined
          : createResolvedEvidence(
              resolvedChoice,
              pattern,
              choice.sourcePath,
              'route-jsx',
              identityOrder,
              [choice.sourcePath, choice.reference.sourcePath],
            );
      if (item === undefined)
        unresolved.push({ availability: 'submodule-base-unresolved', choice });
      else resolved.push(item);
      continue;
    }
    if (evidence.kind === 'catalog-member') {
      const catalogKey = evidence.reference.catalogKey;
      if (catalogKey !== choice.componentName && catalogKey !== choice.reference.exportName) {
        unresolved.push({ availability: 'catalog-unresolved', choice });
        continue;
      }
      const catalog = await collectPreviewInspectorRouteFactoryCatalog({
        catalogBindingKind: 'export',
        catalogBindingName: evidence.reference.registryExportName,
        expectedComponentNames: new Set([catalogKey]),
        maximumModules: 12,
        readSource: options.readSource,
        ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
        sourcePath: evidence.reference.registrySourcePath,
      });
      const entries = catalog.entriesByComponentName.get(catalogKey) ?? [];
      const patterns = [
        ...new Set(
          entries.flatMap((entry) => {
            const normalized = normalizeRoutePattern(entry.pattern);
            return normalized === undefined ? [] : [normalized];
          }),
        ),
      ];
      if (patterns.length !== 1) {
        unresolved.push({
          availability:
            patterns.length > 1 ? 'route-provenance-ambiguous' : 'catalog-unresolved',
          choice,
        });
        continue;
      }
      const pattern = patterns[0];
      const catalogSources = entries
        .filter((entry) => normalizeRoutePattern(entry.pattern) === pattern)
        .map((entry) => entry.catalogSourcePath)
        .sort();
      const catalogSourcePath = catalogSources[0];
      const item =
        pattern === undefined || catalogSourcePath === undefined
          ? undefined
          : createResolvedEvidence(
              resolvedChoice,
              pattern,
              catalogSourcePath,
              'route-catalog',
              identityOrder,
              [
                choice.sourcePath,
                choice.reference.sourcePath,
                ...catalog.dependencyPaths,
                ...catalogSources,
              ],
            );
      if (item === undefined) unresolved.push({ availability: 'catalog-unresolved', choice });
      else resolved.push(item);
      continue;
    }
    unresolved.push({ availability: 'catalog-unresolved', choice });
  }

  const selectable: PreviewInspectorResolvedDirectRouteEvidence[] = [];
  const duplicates: PreviewInspectorDuplicateDirectRouteEvidence[] = [];
  const byPublicSelection = new Map<string, PreviewInspectorResolvedDirectRouteEvidence[]>();
  for (const item of resolved) {
    const key = `${item.choice.componentName}\0${item.pattern}`;
    const values = byPublicSelection.get(key) ?? [];
    values.push(item);
    byPublicSelection.set(key, values);
  }
  for (const values of byPublicSelection.values()) {
    if (new Set(values.map((item) => item.provenanceIdentity)).size > 1) {
      for (const item of values)
        unresolved.push({ availability: 'route-provenance-ambiguous', choice: item.choice });
      continue;
    }
    const ordered = [...values].sort((left, right) =>
      left.choice.occurrenceIdentity.localeCompare(right.choice.occurrenceIdentity),
    );
    const canonical = ordered[0];
    if (canonical !== undefined) selectable.push(canonical);
    for (const duplicate of ordered.slice(1)) {
      if (duplicate.choice.reference === undefined) {
        unresolved.push({ availability: 'component-unresolved', choice: duplicate.choice });
      } else {
        duplicates.push({ ...duplicate, choice: withReference(duplicate.choice) });
      }
    }
  }
  const resolution = Object.freeze({
    duplicates: Object.freeze(duplicates),
    selectable: Object.freeze(selectable),
    unresolved: Object.freeze(unresolved),
  });
  assertTotalOccurrencePartition(options.choices, resolution);
  return resolution;
}

/** Rejects any silent omission, overlap, or collapse in the terminal occurrence partition. */
function assertTotalOccurrencePartition(
  choices: readonly PreviewInspectorDirectRouteChoice[],
  resolution: PreviewInspectorDirectRouteResolution,
): void {
  const inputIds = choices.map((choice) => choice.occurrenceIdentity);
  const outcomeGroups = [
    resolution.selectable.map((item) => item.choice.occurrenceIdentity),
    resolution.unresolved.map((item) => item.choice.occurrenceIdentity),
    resolution.duplicates.map((item) => item.choice.occurrenceIdentity),
  ];
  const inputSet = new Set(inputIds);
  const outputIds = outcomeGroups.flat();
  const outputSet = new Set<string>();
  let disjoint = true;
  for (const occurrenceId of outputIds) {
    if (outputSet.has(occurrenceId)) disjoint = false;
    outputSet.add(occurrenceId);
  }
  const sameMembers =
    inputSet.size === outputSet.size &&
    [...inputSet].every((occurrenceId) => outputSet.has(occurrenceId));
  if (
    inputSet.size !== inputIds.length ||
    outputSet.size !== outputIds.length ||
    !disjoint ||
    !sameMembers
  ) {
    throw new Error('Direct route resolution did not produce a total occurrence partition.');
  }
}

/** Normalizes one occurrence and records the exact evidence chain used to resolve it. */
function createResolvedEvidence(
  choice: PreviewInspectorDirectRouteChoice,
  candidatePattern: string,
  sourcePath: string,
  evidenceKind: PreviewInspectorResolvedDirectRouteEvidence['evidenceKind'],
  identityOrder: number,
  dependencyPaths: readonly string[],
): PreviewInspectorResolvedDirectRouteEvidence | undefined {
  const pattern = normalizeRoutePattern(candidatePattern);
  if (pattern === undefined) return undefined;
  const normalizedDependencies = [
    ...new Set(dependencyPaths.map((item) => path.normalize(item))),
  ].sort();
  const directRouteOwnerSourcePath =
    evidenceKind === 'route-catalog' ? path.normalize(choice.sourcePath) : undefined;
  return Object.freeze({
    choice,
    dependencyPaths: Object.freeze(normalizedDependencies),
    ...(directRouteOwnerSourcePath === undefined ? {} : { directRouteOwnerSourcePath }),
    evidenceKind,
    identityOrder,
    pattern,
    provenanceIdentity: JSON.stringify({
      componentExportName: choice.reference?.exportName,
      componentSourcePath:
        choice.reference === undefined ? undefined : path.normalize(choice.reference.sourcePath),
      dependencyPaths: normalizedDependencies,
      evidence: choice.pathEvidence,
      directRouteOwnerSourcePath,
      pattern,
      sourcePath: path.normalize(sourcePath),
    }),
    sourcePath: path.normalize(sourcePath),
  });
}

/** Narrows a choice after its component reference has been checked. */
function withReference(
  choice: PreviewInspectorDirectRouteChoice,
): PreviewInspectorDirectRouteChoice & {
  readonly reference: PreviewInspectorDirectRouteComponentReference;
} {
  return choice as PreviewInspectorDirectRouteChoice & {
    readonly reference: PreviewInspectorDirectRouteComponentReference;
  };
}
