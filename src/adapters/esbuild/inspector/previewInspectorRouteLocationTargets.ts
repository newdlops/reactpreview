/** Correlates exact render ancestry and component identities for route locations. */
import path from 'node:path';
import { collectPreviewRenderModuleFacts } from '../renderGraph/previewRenderModuleFacts';
import { type PreviewInspectorDirectRouteChoice } from './previewInspectorDirectRouteChoices';
import { referencesPreviewInspectorDirectRouteTarget } from './previewInspectorDirectRouteTargetReference';
import { normalizeComponentIdentity, toPascalCase } from './previewInspectorRouteLocationEvidence';
import { readPreviewInspectorRoutePathIndex } from './previewInspectorRoutePathIndex';
import type {
  CollectPreviewInspectorRouteLocationOptions,
  PreviewInspectorRouteLocation,
} from './previewInspectorRouteLocationTypes';

/** Chases an exact lazy/re-export corridor from any route barrel back to the selected file. */
export function retargetTransparentRouteComponentLocation(
  location: PreviewInspectorRouteLocation,
  documentPath: string,
  exportName: string,
  renderChain: CollectPreviewInspectorRouteLocationOptions['renderChain'],
): PreviewInspectorRouteLocation {
  const componentSourcePath = location.componentSourcePath;
  if (componentSourcePath === undefined) return location;
  const normalizedComponentPath = path.normalize(componentSourcePath);
  const normalizedDocumentPath = path.normalize(documentPath);
  if (normalizedComponentPath === normalizedDocumentPath) return location;
  const proven = isTransparentRouteComponentCorridorProven(
    normalizedComponentPath,
    [location.componentName, location.componentExportName],
    normalizedDocumentPath,
    renderChain,
  );
  if (!proven) return location;
  return Object.freeze({
    ...location,
    componentExportName: exportName,
    componentSourcePath: normalizedDocumentPath,
    dependencyPaths: Object.freeze(
      [
        ...new Set([...location.dependencyPaths, normalizedComponentPath, normalizedDocumentPath]),
      ].sort(),
    ),
  });
}

/** Recognizes an exact route binding that reaches the selected file or one proven render ancestor. */
export function referencesDirectRouteTarget(
  choice: PreviewInspectorDirectRouteChoice,
  target: CollectPreviewInspectorRouteLocationOptions['renderChain']['target'],
  renderChain: CollectPreviewInspectorRouteLocationOptions['renderChain'],
): boolean {
  if (referencesPreviewInspectorDirectRouteTarget(choice, target)) return true;
  const components = [
    { identities: [choice.componentName], reference: choice.reference },
    ...(choice.elementPath ?? []).map((component) => ({
      identities: [component.componentName],
      reference: component.reference,
    })),
  ];
  return components.some(({ identities, reference }) => {
    if (reference === undefined) return false;
    const componentIdentities = [...identities, reference.exportName];
    return (
      isTransparentRouteComponentCorridorProven(
        reference.sourcePath,
        componentIdentities,
        target.sourcePath,
        renderChain,
      ) || isProvenTargetRenderAncestor(reference.sourcePath, componentIdentities, renderChain)
    );
  });
}

/**
 * Accepts an ordinary component Route only when that exact source and component identity occur on
 * a target-to-entry render path. This recovers routes such as `/project` for a modal leaf rendered
 * inside `Project` without admitting sibling or catch-all route components from the same router.
 */
export function isProvenTargetRenderAncestor(
  componentSourcePath: string,
  componentIdentities: readonly (string | undefined)[],
  renderChain: CollectPreviewInspectorRouteLocationOptions['renderChain'],
): boolean {
  const normalizedSourcePath = path.normalize(componentSourcePath);
  const identities = new Set(
    componentIdentities.flatMap((identity) => {
      const normalized = normalizeComponentIdentity(identity);
      return normalized === undefined ? [] : [normalized];
    }),
  );
  if (identities.size === 0) return false;
  const index = readPreviewInspectorRoutePathIndex(renderChain.paths);
  if (index !== undefined) return index.hasAncestor(normalizedSourcePath, identities);
  return renderChain.paths.some((renderPath) =>
    renderPath.steps.some(
      (step) =>
        path.normalize(step.sourcePath) === normalizedSourcePath &&
        identities.has(normalizeComponentIdentity(step.label) ?? ''),
    ),
  );
}

/** Proves target-to-route continuity without treating an ordinary component owner as transparent. */
export function isTransparentRouteComponentCorridorProven(
  componentSourcePath: string,
  componentIdentities: readonly (string | undefined)[],
  documentPath: string,
  renderChain: CollectPreviewInspectorRouteLocationOptions['renderChain'],
): boolean {
  const normalizedComponentPath = path.normalize(componentSourcePath);
  const normalizedDocumentPath = path.normalize(documentPath);
  const identities = new Set(
    componentIdentities.flatMap((identity) => {
      const normalized = normalizeComponentIdentity(identity);
      return normalized === undefined ? [] : [normalized];
    }),
  );
  if (identities.size === 0) return false;
  const index = readPreviewInspectorRoutePathIndex(renderChain.paths);
  if (index !== undefined) {
    return index.hasTransparentCorridor(
      normalizedComponentPath,
      identities,
      normalizedDocumentPath,
    );
  }
  return renderChain.paths.some((renderPath) => {
    const targetIndex = renderPath.steps.findIndex(
      (step) => path.normalize(step.sourcePath) === normalizedDocumentPath,
    );
    if (targetIndex < 0) return false;
    const componentIndex = renderPath.steps.findIndex(
      (step, index) =>
        index > targetIndex &&
        path.normalize(step.sourcePath) === normalizedComponentPath &&
        identities.has(normalizeComponentIdentity(step.label) ?? ''),
    );
    return (
      componentIndex > targetIndex &&
      renderPath.steps
        .slice(targetIndex, componentIndex)
        .every((step) => step.kind === 'react-lazy' || step.kind === 're-export')
    );
  });
}

/** Builds only identities that can denote the exact selected export in its own source module. */
export function collectSelectedTargetIdentities(
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
export function collectTargetIdentities(
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
