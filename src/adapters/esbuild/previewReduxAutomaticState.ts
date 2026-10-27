/** Builds the lowest-priority Redux container state from the already selected source frontier. */
import path from 'node:path';
import type {
  PreviewReduxStaticObject,
  PreviewReduxStaticState,
  PreviewReduxStaticValue,
} from './previewReduxRuntimeSource';
import {
  PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
  PREVIEW_CANONICAL_SAMPLE_EPOCH_MILLIS,
  PREVIEW_CANONICAL_SAMPLE_MONTH,
  PREVIEW_CANONICAL_SAMPLE_YEAR,
  PREVIEW_SAMPLE_MONTH_NAME_PATTERN,
  PREVIEW_SAMPLE_YEAR_NAME_PATTERN,
} from './previewSampleDateRuntimeSource';
import { collectPreviewObservedReduxPropertyNames } from './staticResources/previewReduxReceiverObservation';
import type { PreviewReselectOptionalChainPath } from './staticResources/previewReselectOptionalChainPaths';
import {
  collectPreviewReselectStateRequirements,
  type PreviewReselectStateValueRequirement,
} from './staticResources/previewReselectStateContainerPaths';
import {
  inferPreviewRuntimeSemanticFallback,
  PREVIEW_RUNTIME_SEMANTIC_DATE_TIME_LABEL,
  type PreviewRuntimeSemanticFallback,
} from './staticResources/previewRuntimeHookSemantics';
import type { PreviewInferredPropShape } from './staticResources/reactExportPropInference';
import { collectPreviewReduxStateContainerPaths } from './staticResources/reduxStateContainerPaths';

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
  return (await collectPreviewReduxAutomaticStateParts(options))?.state;
}

/** Static seed plus the part of it that only absent-receiver chains contributed. */
export interface PreviewReduxAutomaticStateParts {
  /** Lowest-priority state for the preview's own static store. */
  readonly state: PreviewReduxStaticState;
  /**
   * Fields created below absent optional receivers (0.1.1602 rule), shown over an application's
   * own store only where that store has no value; absent when no chain created a receiver.
   */
  readonly absentReceiverOverlay?: PreviewReduxStaticState;
}

/**
 * Collects the static seed and, separately, the absent-receiver fields an application's own store
 * may lack because another page requests them.
 */
export async function collectPreviewReduxAutomaticStateParts(
  options: CollectPreviewReduxAutomaticStateOptions,
): Promise<PreviewReduxAutomaticStateParts | undefined> {
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
  const optionalChainPaths: PreviewReselectOptionalChainPath[] = [];
  const sourceTexts = new Map<string, string>();
  for (const sourcePath of sourcePaths) {
    const sourceText = await options.readSource(sourcePath);
    if (sourceText === undefined) continue;
    sourceTexts.set(sourcePath, sourceText);
    if (!sourceText.includes('Selector')) continue;
    containerPaths.push(...collectPreviewReduxStateContainerPaths(sourcePath, sourceText));
    const reselect = collectPreviewReselectStateRequirements(sourcePath, sourceText);
    valueRequirements.push(...reselect.valueRequirements);
    optionalChainPaths.push(...reselect.optionalChainPaths);
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
  // Optional chains run last so every module's evidence decides whether their receiver exists.
  const absentReceivers = selectCreatableAbsentReceivers(
    state,
    optionalChainPaths,
    valueRequirements,
    sourceTexts,
  );
  let grafted: PreviewReduxStaticObject = state;
  let overlay: PreviewReduxStaticObject = Object.freeze({});
  for (const chain of optionalChainPaths.sort((left, right) =>
    compareReduxContainerPaths(left.path, right.path),
  )) {
    const decision = absentReceivers.get(chain);
    if (decision === false) continue;
    grafted = graftReduxOptionalChain(grafted, chain, 0, decision === true) ?? grafted;
    if (decision === true) overlay = graftReduxOptionalChain(overlay, chain, 0, true) ?? overlay;
  }
  return {
    state: Object.freeze(grafted),
    ...(Object.keys(overlay).length === 0 ? {} : { absentReceiverOverlay: overlay }),
  };
}

/**
 * Decides, from the state before any graft, which chains may create their absent receiver.
 *
 * Chains whose receiver already exists are absent from the result and graft as before. A chain whose
 * receiver is missing (an optional API result the store fills only after a request) maps to `true`
 * when no frontier source can observe that receiver's presence and none of the containers it would
 * create is a value some selector returns whole (a component may test that object); otherwise it
 * maps to `false` and is skipped even if a sibling chain creates the receiver.
 */
function selectCreatableAbsentReceivers(
  state: PreviewReduxStaticObject,
  chains: readonly PreviewReselectOptionalChainPath[],
  valueRequirements: readonly PreviewReselectStateValueRequirement[],
  sourceTexts: ReadonlyMap<string, string>,
): ReadonlyMap<PreviewReselectOptionalChainPath, boolean> {
  const missing = new Map<PreviewReselectOptionalChainPath, number>();
  const candidateNames = new Set<string>();
  for (const chain of chains) {
    const index = readFirstMissingIndex(state, chain.path);
    if (index >= chain.receiverLength) continue;
    missing.set(chain, index);
    for (const name of chain.path.slice(index, chain.receiverLength)) candidateNames.add(name);
  }
  if (missing.size === 0) return new Map();
  const observedNames = collectPreviewObservedReduxPropertyNames(sourceTexts, candidateNames);
  const returnedValues = new Set([
    ...chains.map((chain) => chain.path.join('\0')),
    ...valueRequirements.map((requirement) => requirement.path.join('\0')),
  ]);
  const decisions = new Map<PreviewReselectOptionalChainPath, boolean>();
  for (const [chain, index] of missing) {
    const receiverNames = chain.path.slice(index, chain.receiverLength);
    const createdContainers = chain.path
      .slice(0, -1)
      .map((_name, position) => chain.path.slice(0, position + 1).join('\0'))
      .slice(index);
    decisions.set(
      chain,
      receiverNames.every((name) => !observedNames.has(name)) &&
        createdContainers.every((container) => !returnedValues.has(container)),
    );
  }
  return decisions;
}

/** Returns the index of the first path member absent from the seeded state (the length if none). */
function readFirstMissingIndex(
  state: PreviewReduxStaticObject,
  pathSegments: readonly string[],
): number {
  let node: PreviewReduxStaticValue | undefined = state;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const name = pathSegments[index];
    const next: PreviewReduxStaticValue | undefined =
      isReduxStaticObject(node) && name !== undefined ? node[name] : undefined;
    if (next === undefined) return index;
    node = next;
  }
  return pathSegments.length;
}

/**
 * Adds one optional selector chain below a receiver that other evidence already seeded, or below an
 * absent receiver that `selectCreatableAbsentReceivers` admitted. Containers are created only toward
 * a leaf that has a value, and an existing value is never replaced.
 */
function graftReduxOptionalChain(
  node: PreviewReduxStaticValue | undefined,
  chain: PreviewReselectOptionalChainPath,
  index: number,
  createAbsentReceiver: boolean,
): PreviewReduxStaticObject | undefined {
  const name = chain.path[index];
  if (!isReduxStaticObject(node) || name === undefined) return undefined;
  const existing = node[name];
  let child: PreviewReduxStaticValue | undefined;
  if (index === chain.path.length - 1) {
    if (existing === undefined) {
      child =
        chain.collection === true
          ? Object.freeze([])
          : createReduxOptionalLeafValue(chain.path[index - 1], name);
    }
  } else if (existing !== undefined) {
    child = graftReduxOptionalChain(existing, chain, index + 1, createAbsentReceiver);
  } else if (index >= chain.receiverLength || createAbsentReceiver) {
    // A collection name gets an empty collection, never a `{ length }`-style object below it.
    child =
      inferPreviewRuntimeSemanticFallback(name)?.kind === 'array'
        ? Object.freeze([])
        : graftReduxOptionalChain(Object.freeze({}), chain, index + 1, createAbsentReceiver);
  }
  return child === undefined ? undefined : Object.freeze({ ...node, [name]: child });
}

/**
 * Picks the value of an optional leaf from its name, only where an absent value breaks rendering:
 * counts become 0 instead of a project sentinel such as -1, dates become the sample date (a `year`
 * or `month` number becomes the sample day's year or month), and collections become empty. Text and flags stay absent so the project's own defaults and the
 * render-only fallback (which may continue past an early return) still decide them. A `{ value }`
 * wrapper (protobuf Timestamp or Int32Value) carries its meaning in the parent name, and a timestamp
 * wrapper gets epoch milliseconds: the proto field is an int64 of milliseconds, `Number(v)`,
 * `new Date(v)`, and `dayjs(v)` all accept a number, while a numeric string would break `new Date(v)`.
 */
function createReduxOptionalLeafValue(
  parentName: string | undefined,
  leafName: string,
): PreviewReduxStaticValue | undefined {
  // A year or month number takes the canonical day's part; the bridge moves it to today by key.
  if (PREVIEW_SAMPLE_YEAR_NAME_PATTERN.test(leafName)) return PREVIEW_CANONICAL_SAMPLE_YEAR;
  if (PREVIEW_SAMPLE_MONTH_NAME_PATTERN.test(leafName)) return PREVIEW_CANONICAL_SAMPLE_MONTH;
  if (leafName === 'value' && parentName !== undefined) {
    const parent = inferPreviewRuntimeSemanticFallback(parentName);
    if (parent?.label === PREVIEW_RUNTIME_SEMANTIC_DATE_TIME_LABEL) {
      return PREVIEW_CANONICAL_SAMPLE_EPOCH_MILLIS;
    }
    const wrapped = readReduxNeutralValue(parent);
    if (wrapped !== undefined) return wrapped;
  }
  const leaf = inferPreviewRuntimeSemanticFallback(leafName);
  return leaf?.label === PREVIEW_RUNTIME_SEMANTIC_DATE_TIME_LABEL
    ? PREVIEW_CANONICAL_SAMPLE_DATE_TIME
    : readReduxNeutralValue(leaf);
}

/** Maps a count or collection family to its empty value; every other family stays absent. */
function readReduxNeutralValue(
  fallback: PreviewRuntimeSemanticFallback | undefined,
): PreviewReduxStaticValue | undefined {
  if (fallback?.kind === 'array') return Object.freeze([]);
  return fallback?.kind === 'number' ? 0 : undefined;
}

/** Recognizes a plain JSON object container. */
function isReduxStaticObject(
  value: PreviewReduxStaticValue | undefined,
): value is PreviewReduxStaticObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
