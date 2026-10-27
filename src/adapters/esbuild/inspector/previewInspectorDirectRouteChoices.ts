/** Coordinates DirectRouteChoices using bounded authored-source evidence. */
import path from 'node:path';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type {
  CollectPreviewInspectorDirectRouteChoicesFromSourceOptions,
  CollectPreviewInspectorDirectRouteChoicesOptions,
  PreviewInspectorDirectRouteChoice,
  PreviewInspectorDirectRouteChoiceInventory,
} from './previewInspectorDirectRouteChoiceTypes';
import { collectJsxRouteChoices } from './previewInspectorDirectRouteJsx';
import type {
  ImportedBinding,
  ParsedRouteModule,
  RouteModuleWorkItem,
} from './previewInspectorDirectRouteModel';
import {
  collectObjectRouteChoices,
  collectRouterProviderDelegates,
} from './previewInspectorDirectRouteObjects';
import { parseRouteModule } from './previewInspectorDirectRouteSyntax';
import { addChoice } from './previewInspectorDirectRouteTargets';

export type {
  CollectPreviewInspectorDirectRouteChoicesFromSourceOptions,
  CollectPreviewInspectorDirectRouteChoicesOptions,
  PreviewInspectorDirectRouteChoice,
  PreviewInspectorDirectRouteChoiceInventory,
  PreviewInspectorDirectRouteComponentReference,
  PreviewInspectorDirectRouteElementComponent,
} from './previewInspectorDirectRouteChoiceTypes';

export type {
  PreviewInspectorDirectRouteCatalogMemberReference,
  PreviewInspectorDirectRoutePathEvidence,
} from './previewInspectorDirectRoutePathEvidence';

/**
 * Collects a large route catalog as metadata while following only router-configuration imports.
 *
 * A RouterProvider can receive an imported router or a router factory can receive an imported
 * descriptor array. Those imports are parser inputs, not visible pages, so following them remains
 * cheap and lets the branch planner continue through provider-only intermediate modules.
 */
export async function collectPreviewInspectorDirectRouteChoices(
  options: CollectPreviewInspectorDirectRouteChoicesOptions,
): Promise<PreviewInspectorDirectRouteChoiceInventory> {
  const choices: PreviewInspectorDirectRouteChoice[] = [];
  const dependencyPaths = new Set<string>();
  const queuedItems = new Set<string>();
  const queue: RouteModuleWorkItem[] = [];
  enqueue(options.sourcePath, options.sourceText);
  while (queue.length > 0) {
    const workItem = queue.shift();
    if (workItem === undefined) break;
    const sourcePath = path.normalize(workItem.sourcePath);
    const sourceText = workItem.sourceText ?? (await options.readSource(sourcePath));
    if (sourceText === undefined) continue;
    dependencyPaths.add(sourcePath);
    const parsed = parseRouteModule(sourcePath, sourceText);
    for (const choice of collectPreviewInspectorDirectRouteChoicesFromParsedSource(
      parsed,
      sourcePath,
      options.resolveModule,
      enqueueDelegate,
      workItem.descriptorExportName,
    )) {
      addChoice(choices, choice);
    }
    collectRouterProviderDelegates(parsed, sourcePath, enqueueDelegate);
  }

  return Object.freeze({
    choices: Object.freeze(choices),
    dependencyPaths: Object.freeze([...dependencyPaths].sort()),
  });

  /** Queues one exact resolver result at most once without reading it eagerly. */
  function enqueue(sourcePath: string, sourceText?: string, descriptorExportName?: string): void {
    const normalizedPath = path.normalize(sourcePath);
    const key = `${normalizedPath}\0${descriptorExportName ?? ''}`;
    if (queuedItems.has(key)) return;
    queuedItems.add(key);
    queue.push({
      ...(descriptorExportName === undefined ? {} : { descriptorExportName }),
      sourcePath: normalizedPath,
      ...(sourceText === undefined ? {} : { sourceText }),
    });
  }

  /** Resolves an imported router/config value and queues only its owning source module. */
  function enqueueDelegate(binding: ImportedBinding, consumerPath: string): void {
    const resolvedPath = options.resolveModule?.(binding.moduleSpecifier, consumerPath);
    if (resolvedPath !== undefined) enqueue(resolvedPath, undefined, binding.exportName);
  }
}

/**
 * Collects direct JSX/object route choices from one source without following router imports.
 *
 * The route-location analyzer uses this overload for sources already present on a proven render
 * path, avoiding duplicate reads and keeping imported configuration traversal under one root pass.
 */
export function collectPreviewInspectorDirectRouteChoicesFromSource(
  options: CollectPreviewInspectorDirectRouteChoicesFromSourceOptions,
): readonly PreviewInspectorDirectRouteChoice[] {
  const parsed = parseRouteModule(options.sourcePath, options.sourceText);
  return Object.freeze(
    collectPreviewInspectorDirectRouteChoicesFromParsedSource(
      parsed,
      options.sourcePath,
      options.resolveModule,
      () => undefined,
      undefined,
    ),
  );
}

/** Shares one parsed syntax pass between the recursive and already-read public entry points. */
function collectPreviewInspectorDirectRouteChoicesFromParsedSource(
  parsed: ParsedRouteModule,
  sourcePath: string,
  resolveModule: ResolvePreviewRenderGraphModule | undefined,
  enqueueDelegate: (binding: ImportedBinding, consumerPath: string) => void,
  descriptorExportName: string | undefined,
): PreviewInspectorDirectRouteChoice[] {
  const choices: PreviewInspectorDirectRouteChoice[] = [];
  collectJsxRouteChoices(parsed, sourcePath, choices, resolveModule);
  collectObjectRouteChoices(
    parsed,
    sourcePath,
    choices,
    resolveModule,
    enqueueDelegate,
    descriptorExportName,
  );
  return choices;
}
