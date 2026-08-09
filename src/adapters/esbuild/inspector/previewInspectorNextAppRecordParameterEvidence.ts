/** Adds finite static-registry route values when an App page omits `generateStaticParams`. */
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import type { ReadPreviewInspectorSource } from './previewInspectorAncestorTypes';
import type {
  PreviewInspectorNextAppLayoutChain,
  PreviewInspectorNextAppParamValue,
} from './previewInspectorNextAppLayoutChain';
import { collectPreviewInspectorStaticRecordParameterValues } from './previewInspectorNextPagesParameterEvidence';

interface MergePreviewInspectorNextAppRecordParameterEvidenceOptions {
  readonly dynamicParameterValues?: Readonly<Record<string, PreviewInspectorNextAppParamValue>>;
  readonly readSource: ReadPreviewInspectorSource;
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  readonly signal?: AbortSignal;
  readonly sourcePaths: readonly string[];
  readonly staticParameterSourceBoundary?: string;
}

/**
 * Merges only missing route keys, preserving stronger target-path and generated-static evidence.
 * The shared record reader follows exact imports and object literals without running page code.
 */
export async function mergeNextAppRecordParams(
  options: MergePreviewInspectorNextAppRecordParameterEvidenceOptions,
  shell: PreviewInspectorNextAppLayoutChain,
  dependencies: Set<string>,
  values: Record<string, PreviewInspectorNextAppParamValue>,
): Promise<void> {
  Object.assign(values, options.dynamicParameterValues);
  const parameterNames = collectDynamicParameterNames(shell.routeLocation.pattern);
  if (parameterNames.every((parameterName) => values[parameterName] !== undefined)) return;
  const evidence = await collectPreviewInspectorStaticRecordParameterValues({
    initialValues: values,
    pagePath: shell.routeLocation.sourcePath,
    pattern: shell.routeLocation.pattern,
    readSource: options.readSource,
    ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    sourcePaths: options.sourcePaths,
    ...(options.staticParameterSourceBoundary === undefined
      ? {}
      : { staticParameterSourceBoundary: options.staticParameterSourceBoundary }),
  });
  Object.assign(values, evidence.values);
  for (const dependencyPath of evidence.dependencyPaths) dependencies.add(dependencyPath);
}

/** Collects ordinary, catch-all, and optional catch-all route key names. */
function collectDynamicParameterNames(pattern: string): readonly string[] {
  const names: string[] = [];
  for (const segment of pattern.split('/').filter(Boolean)) {
    const match = /^\[\[?\.\.\.([^\]]+)\]\]?$|^\[([^\]]+)\]$/u.exec(segment);
    const name = match?.[1] ?? match?.[2];
    if (name !== undefined && !names.includes(name)) names.push(name);
  }
  return names;
}
