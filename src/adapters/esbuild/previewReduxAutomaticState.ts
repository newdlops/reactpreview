/** Builds the lowest-priority Redux container state from the already selected source frontier. */
import path from 'node:path';
import type {
  PreviewReduxStaticObject,
  PreviewReduxStaticState,
  PreviewReduxStaticValue,
} from './previewReduxRuntimeSource';
import { collectPreviewReduxStateContainerPaths } from './staticResources/reduxStateContainerPaths';
import {
  collectPreviewReselectStateRequirements,
  type PreviewReselectStateValueRequirement,
} from './staticResources/previewReselectStateContainerPaths';
import type { PreviewInferredPropShape } from './staticResources/reactExportPropInference';

const MAXIMUM_REDUX_FRONTIER_SOURCES = 2_048;
const JAVASCRIPT_SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;

export interface CollectPreviewReduxAutomaticStateOptions {
  /** Reads one already admitted source without executing project configuration or modules. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined> | string | undefined;
  /** Compiler-owned target corridor and final authentic-frontier source identities. */
  readonly sourcePaths: readonly string[];
}

/**
 * Collects selector-only state requirements before the Redux bridge module is instantiated.
 *
 * JSX modules can register their requirements while evaluating, but a pure selector dependency may
 * use esbuild's fast pass-through path and therefore cannot emit a registration statement. Reading
 * the frozen frontier here preserves that optimization and supplies only object containers already
 * proven by selector syntax. Reselect projector usage may additionally prove falsey scalar or empty
 * collection leaves that must exist before `useSelector` starts; reducers, initializers, and project
 * modules are never executed.
 */
export async function collectPreviewReduxAutomaticState(
  options: CollectPreviewReduxAutomaticStateOptions,
): Promise<PreviewReduxStaticState | undefined> {
  const sourcePaths = [
    ...new Set(
      options.sourcePaths
        .map((sourcePath) => path.normalize(sourcePath))
        .filter((sourcePath) => JAVASCRIPT_SOURCE_PATTERN.test(sourcePath)),
    ),
  ]
    .sort()
    .slice(0, MAXIMUM_REDUX_FRONTIER_SOURCES);
  const containerPaths: (readonly string[])[] = [];
  const valueRequirements: PreviewReselectStateValueRequirement[] = [];
  for (const sourcePath of sourcePaths) {
    const sourceText = await options.readSource(sourcePath);
    if (sourceText === undefined || !sourceText.includes('Selector')) continue;
    containerPaths.push(...collectPreviewReduxStateContainerPaths(sourcePath, sourceText));
    valueRequirements.push(
      ...collectPreviewReselectStateRequirements(sourcePath, sourceText).valueRequirements,
    );
  }
  if (containerPaths.length === 0 && valueRequirements.length === 0) return undefined;

  const state: PreviewReduxStaticObject = {};
  for (const containerPath of containerPaths.sort(compareReduxContainerPaths)) {
    let container = state as Record<string, unknown>;
    for (const propertyName of containerPath) {
      const existing = container[propertyName];
      if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
        container[propertyName] = {};
      }
      container = container[propertyName] as Record<string, unknown>;
    }
  }
  for (const requirement of valueRequirements.sort((left, right) =>
    compareReduxContainerPaths(left.path, right.path),
  )) {
    const generatedValue = materializeReduxShape(requirement.shape);
    if (generatedValue === undefined) continue;
    assignReduxAutomaticValue(state, requirement.path, generatedValue);
  }
  return Object.freeze(state);
}

/** Materializes only JSON-safe, falsey values proven by projector operations. */
function materializeReduxShape(
  shape: PreviewInferredPropShape,
): PreviewReduxStaticValue | undefined {
  if (shape.kind === 'array') return Object.freeze([]);
  if (shape.kind === 'boolean') return typeof shape.value === 'boolean' ? shape.value : false;
  if (shape.kind === 'number') return typeof shape.value === 'number' ? shape.value : 0;
  if (shape.kind === 'string') return typeof shape.value === 'string' ? shape.value : '';
  if (shape.kind === 'null') return null;
  if (shape.kind !== 'object') return undefined;
  const result: Record<string, PreviewReduxStaticValue> = {};
  for (const [propertyName, childShape] of Object.entries(shape.properties ?? {})) {
    const childValue = materializeReduxShape(childShape);
    if (childValue !== undefined) result[propertyName] = childValue;
  }
  return Object.freeze(result);
}

/** Writes one generated leaf below already-proven, prototype-safe Redux path containers. */
function assignReduxAutomaticValue(
  state: PreviewReduxStaticObject,
  pathSegments: readonly string[],
  value: PreviewReduxStaticValue,
): void {
  if (pathSegments.length === 0) return;
  let container = state as Record<string, PreviewReduxStaticValue>;
  for (const propertyName of pathSegments.slice(0, -1)) {
    const existing = container[propertyName];
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      container[propertyName] = {};
    }
    container = container[propertyName] as Record<string, PreviewReduxStaticValue>;
  }
  const leafName = pathSegments.at(-1);
  if (leafName === undefined) return;
  container[leafName] = mergeReduxAutomaticValues(container[leafName], value);
}

/** Combines object evidence across selector modules; exact collection/scalar kinds replace shells. */
function mergeReduxAutomaticValues(
  existing: PreviewReduxStaticValue | undefined,
  generated: PreviewReduxStaticValue,
): PreviewReduxStaticValue {
  if (
    existing === null ||
    generated === null ||
    typeof existing !== 'object' ||
    typeof generated !== 'object' ||
    Array.isArray(existing) ||
    Array.isArray(generated)
  ) {
    return generated;
  }
  const merged: Record<string, PreviewReduxStaticValue> = {
    ...(existing as PreviewReduxStaticObject),
  };
  for (const [propertyName, child] of Object.entries(generated as PreviewReduxStaticObject)) {
    merged[propertyName] = mergeReduxAutomaticValues(merged[propertyName], child);
  }
  return Object.freeze(merged);
}

/** Keeps parent containers ahead of their descendants and makes output deterministic. */
function compareReduxContainerPaths(left: readonly string[], right: readonly string[]): number {
  return left.length - right.length || left.join('\0').localeCompare(right.join('\0'));
}
