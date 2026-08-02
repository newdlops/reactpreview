/**
 * Retains direct ancestor Route matches around a selected nested-router leaf.
 *
 * The route-location analyzer deliberately ranks the nearest concrete leaf ahead of broad outer
 * splats. This module reconnects only exact owner imports that also occur on the proven render path,
 * so a `useRoutes` owner keeps its relative Route basename without admitting sibling branches.
 */
import path from 'node:path';
import type { PreviewInspectorDirectRouteChoice } from './previewInspectorDirectRouteChoices';
import type { PreviewInspectorRouteLocation } from './previewInspectorRouteLocation';
import {
  materializePreviewInspectorRoutePattern,
  normalizePreviewInspectorRoutePattern,
} from './previewInspectorRoutePattern';

/**
 * Recreates direct ancestor Route mounts around a selected leaf owned by `useRoutes`.
 *
 * @param location Nearest inferred route leaf for the selected render path.
 * @param directChoices Exact JSX/object route choices found along the bounded source inventory.
 * @param renderPathSourcePaths Target-to-entry source order proving each retained ancestor.
 * @param routePatterns Supporting authored patterns used to materialize dynamic parameters.
 * @returns The original location or a location composed beneath its proven owner Route matches.
 */
export function retainPreviewInspectorNestedRouteOwnerContext(
  location: PreviewInspectorRouteLocation | undefined,
  directChoices: readonly PreviewInspectorDirectRouteChoice[],
  renderPathSourcePaths: readonly string[],
  routePatterns: readonly string[],
): PreviewInspectorRouteLocation | undefined {
  if (location === undefined) return undefined;
  let contextualLocation = location;
  let ownerSourcePath = path.normalize(location.sourcePath);
  const visitedOwnerPaths = new Set<string>();
  const renderPathOrder = new Map(
    renderPathSourcePaths.map((sourcePath, index) => [path.normalize(sourcePath), index]),
  );

  while (!visitedOwnerPaths.has(ownerSourcePath)) {
    visitedOwnerPaths.add(ownerSourcePath);
    const ownerOrder = renderPathOrder.get(ownerSourcePath);
    const ownedChoices = directChoices.filter(
      (choice) =>
        choice.pathResolution === 'resolved' &&
        path.normalize(choice.sourcePath) === ownerSourcePath,
    );
    if (ownedChoices.length === 0) break;
    const parentChoice = directChoices
      .filter((choice) => {
        if (
          choice.pathResolution !== 'resolved' ||
          choice.reference === undefined ||
          path.normalize(choice.reference.sourcePath) !== ownerSourcePath ||
          path.normalize(choice.sourcePath) === ownerSourcePath
        ) {
          return false;
        }
        const parentOrder = renderPathOrder.get(path.normalize(choice.sourcePath));
        return parentOrder !== undefined && (ownerOrder === undefined || parentOrder > ownerOrder);
      })
      .sort((left, right) => {
        const leftOrder = renderPathOrder.get(path.normalize(left.sourcePath)) ?? Number.MAX_VALUE;
        const rightOrder =
          renderPathOrder.get(path.normalize(right.sourcePath)) ?? Number.MAX_VALUE;
        return leftOrder - rightOrder || left.pattern.localeCompare(right.pattern);
      })[0];
    if (parentChoice?.reference === undefined) break;

    const parentBase =
      normalizePreviewInspectorRoutePattern(
        parentChoice.pattern.replace(/\/\*+$/u, '').replace(/\/+$/u, ''),
      ) ?? '/';
    const childPattern = contextualLocation.pattern;
    const composedPattern =
      parentBase === '/' || childPattern === parentBase || childPattern.startsWith(`${parentBase}/`)
        ? childPattern
        : normalizePreviewInspectorRoutePattern(
            `${parentBase}/${childPattern === '/' ? '' : childPattern.replace(/^\/+/u, '')}`,
          );
    if (composedPattern === undefined) break;
    const mount = Object.freeze({
      basePath: parentBase,
      contextPattern: parentChoice.pattern,
      exportName: parentChoice.reference.exportName,
      hasWildcardFallback: ownedChoices.some(
        (choice) => normalizePreviewInspectorRoutePattern(choice.pattern) === '/*',
      ),
      routeSlotCount: ownedChoices.length,
      sourcePath: ownerSourcePath,
    });
    contextualLocation = Object.freeze({
      ...contextualLocation,
      dependencyPaths: Object.freeze(
        [
          ...new Set([
            ...contextualLocation.dependencyPaths,
            path.normalize(parentChoice.sourcePath),
            ownerSourcePath,
          ]),
        ].sort(),
      ),
      pathname: materializePreviewInspectorRoutePattern(composedPattern, routePatterns),
      pattern: composedPattern,
      routeMounts: Object.freeze([
        mount,
        ...(contextualLocation.routeMounts ?? []).filter(
          (candidate) =>
            path.normalize(candidate.sourcePath) !== ownerSourcePath ||
            candidate.exportName !== mount.exportName,
        ),
      ]),
    });
    ownerSourcePath = path.normalize(parentChoice.sourcePath);
  }
  return contextualLocation;
}
