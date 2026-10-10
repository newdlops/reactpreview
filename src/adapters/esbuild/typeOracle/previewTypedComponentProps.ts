/**
 * Synthesizes the required props of one selected component export from its declared props type.
 *
 * A component previewed by itself, or mounted beside its page because the page did not render it,
 * receives only the literal attributes found at its usage sites. A required prop typed as a closed
 * set from another module (`status: keyof typeof CLINICAL_STATUS`) then stays `undefined`, and the
 * component crashes on its first lookup (`CLINICAL_STATUS[status].bg`). The checker can still read
 * the declared props type, so each missing required scalar prop gets a typed value: the first
 * member of a literal union, a number, a boolean, or a text sample. Structured props (arrays and
 * records such as SimSheet's `weeks: { past: string[]; current: string }`) get JSON values too,
 * because usage inference guessed `weeks.past` as `{ length: 0 }` and left `weeks.current` out.
 * Their Arrays hold three items with item-specific dates and ids, like generated lists; a single
 * typed week left SimSheet with one "W+1" header over four forecast columns.
 * Dates become the canonical sample date text; functions, Maps, Sets, and promises are left to
 * the existing fallbacks. Usage evidence always takes precedence (see `completePreviewAutomaticProps`).
 */
import ts from 'typescript';
import {
  PREVIEW_CANONICAL_SAMPLE_DATE,
  PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
} from '../previewSampleDateRuntimeSource';
import type { PreviewInferredPropShape } from '../staticResources/reactExportPropInference';
import {
  PREVIEW_TYPED_VALUE_TAG,
  synthesizePreviewTypedValue,
  type PreviewTypedValue,
} from './previewTypeValueSynthesizer';

/** JSON-safe prop value: a scalar, or an array/record for a structured required prop. */
export type PreviewTypedPropValue =
  | boolean
  | number
  | string
  | null
  | readonly PreviewTypedPropValue[]
  | { readonly [key: string]: PreviewTypedPropValue };

const MAX_REQUIRED_PROPS = 32;
/** Bounds one structured prop so a wide domain type cannot balloon the generated props. */
const MAX_TYPED_PROP_DEPTH = 4;
const MAX_TYPED_PROP_NODES = 200;
/** Same as the browser's default generated-list length, so typed lists read like generated ones. */
const TYPED_PROP_LIST_LENGTH = 3;
const SKIPPED_PROP_NAMES = new Set(['children', 'key', 'ref']);

/**
 * Reads typed values for the required props of one export.
 *
 * @param checker Checker of the analysis program that owns `sourceFile`.
 * @param sourceFile Module declaring the export.
 * @param exportName Export name (`default` for the default export).
 * @returns Required scalar prop values, or `undefined` when the type is unknown.
 */
export function readPreviewTypedComponentProps(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  exportName: string,
): Readonly<Record<string, PreviewTypedPropValue>> | undefined {
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
  if (moduleSymbol === undefined) return undefined;
  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((symbol) => symbol.getName() === exportName);
  if (exported === undefined) return undefined;
  const symbol =
    (exported.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(exported) : exported;
  const componentType = checker.getTypeOfSymbolAtLocation(symbol, sourceFile);
  const [signature] = componentType.getCallSignatures();
  const [parameter] = signature?.getParameters() ?? [];
  if (parameter === undefined) return undefined;
  const propsType = checker.getTypeOfSymbolAtLocation(parameter, sourceFile);
  const required = checker
    .getPropertiesOfType(propsType)
    .filter(
      (property) =>
        (property.flags & ts.SymbolFlags.Optional) === 0 &&
        !SKIPPED_PROP_NAMES.has(property.getName()),
    )
    .map((property) => property.getName())
    .slice(0, MAX_REQUIRED_PROPS);
  if (required.length === 0) return undefined;
  const synthesized = synthesizePreviewTypedValue(checker, propsType, sourceFile, required, {
    listLength: TYPED_PROP_LIST_LENGTH,
  });
  const value = synthesized?.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const props: Record<string, PreviewTypedPropValue> = {};
  const budget = { nodes: 0 };
  for (const name of required) {
    const propValue = (value as Readonly<Record<string, PreviewTypedValue>>)[name];
    const converted =
      propValue === undefined ? undefined : toPreviewTypedPropValue(propValue, 0, budget);
    if (converted !== undefined) props[name] = converted;
  }
  return Object.keys(props).length === 0 ? undefined : props;
}

/** Converts a synthesized value to JSON: dates become ISO text, other tagged values are dropped. */
function toPreviewTypedPropValue(
  value: PreviewTypedValue,
  depth: number,
  budget: { nodes: number },
): PreviewTypedPropValue | undefined {
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_TYPED_PROP_DEPTH || budget.nodes >= MAX_TYPED_PROP_NODES) return undefined;
  budget.nodes += 1;
  if (Array.isArray(value)) {
    return (value as readonly PreviewTypedValue[])
      .map((item) => toPreviewTypedPropValue(item, depth + 1, budget))
      .filter((item): item is PreviewTypedPropValue => item !== undefined);
  }
  const record = value as Readonly<Record<string, PreviewTypedValue>>;
  const tag = record[PREVIEW_TYPED_VALUE_TAG];
  if (tag !== undefined)
    return tag === 'date' && typeof record.iso === 'string' ? record.iso : undefined;
  const result: Record<string, PreviewTypedPropValue> = {};
  for (const [key, child] of Object.entries(record)) {
    const converted = toPreviewTypedPropValue(child, depth + 1, budget);
    if (converted !== undefined) result[key] = converted;
  }
  return result;
}

/**
 * Adds typed values where usage evidence has none, as a layer the browser merges over the
 * usage-inferred shape.
 *
 * Static usage props always win, and so does every inferred node with evidence (a literal, an
 * exact value, an array with item fields, a function). A typed value fills a prop the usage shape
 * lacks or only guessed: an empty object or the `{ length }` object a collection-length read
 * leaves behind, the same shape-blind placeholders the hook typed-value runtime replaces. A text
 * leaf known only from its declared `string` type becomes '' in the browser, so it also takes the
 * typed calendar value (SimSheet's documented `weeks.current` rendered "0/0" from ''), and a leaf
 * the component shows as-is (`renderedText`) also takes the key label (PageHeader's required
 * `title` rendered an empty heading). Other text stays '': DateRangePicker parsed a labelled `end`
 * into "End.undefined.undefined".
 *
 * @param automatic Props proven at usage sites; they always win.
 * @param typed Typed required props from `readPreviewTypedComponentProps`.
 * @param shape Usage-inferred props shape of the same component, when known.
 * @returns `automatic` itself when nothing was added.
 */
export function completePreviewAutomaticProps<Props extends object>(
  automatic: Props,
  typed: Readonly<Record<string, PreviewTypedPropValue>> | undefined,
  shape?: PreviewInferredPropShape,
): Props {
  if (typed === undefined) return automatic;
  const additions: Record<string, PreviewTypedPropValue> = {};
  for (const [name, value] of Object.entries(typed)) {
    if (Object.hasOwn(automatic, name)) continue;
    const layer = selectPreviewTypedLayer(value, shape?.properties?.[name]);
    if (layer !== undefined) additions[name] = layer;
  }
  return Object.keys(additions).length === 0 ? automatic : { ...additions, ...automatic };
}

/**
 * Gives typed list rows their declared text, as per-row candidates on the usage shape.
 *
 * `completePreviewAutomaticProps` leaves an Array whose usage shape lists item fields alone, so
 * InboundTab's `rows: InboundRow[]` rendered "미정 # # — 0개": every text field the usage shape knew
 * only as neutral text materialized as ''. Each such field now carries the typed rows' values as
 * candidates (dates from comment evidence, `preview-id-2`-style ids, key labels), which generated
 * rows take by index. Fields with any value, candidate, or exact evidence keep it, so the declared
 * `status` rotation stays; numbers, flags, and nested lists are left to the existing rules.
 *
 * @param shape Usage-inferred props shape of the component, when known.
 * @param typed Typed required props from `readPreviewTypedComponentProps`.
 * @returns `shape` itself when no row field changed.
 */
export function completePreviewTypedListShape(
  shape: PreviewInferredPropShape | undefined,
  typed: Readonly<Record<string, PreviewTypedPropValue>> | undefined,
): PreviewInferredPropShape | undefined {
  if (shape === undefined || typed === undefined) return shape;
  return addPreviewTypedListCandidates(shape, typed, 0);
}

/** Walks records toward typed Arrays of records, bounded in depth like the typed props. */
function addPreviewTypedListCandidates(
  node: PreviewInferredPropShape,
  value: PreviewTypedPropValue,
  depth: number,
): PreviewInferredPropShape {
  if (depth >= MAX_TYPED_PROP_DEPTH || value === null || typeof value !== 'object') return node;
  if (node.kind === 'array') {
    const items = node.items;
    const rows = Array.isArray(value)
      ? (value as readonly PreviewTypedPropValue[]).filter(isPreviewTypedRecord)
      : [];
    if (items?.kind !== 'object' || items.properties === undefined || rows.length === 0)
      return node;
    const properties: Record<string, PreviewInferredPropShape> = { ...items.properties };
    let changed = false;
    for (const [key, child] of Object.entries(items.properties)) {
      if (!isPreviewNeutralTextShape(child)) continue;
      const values = rows
        .map((row) => row[key])
        .filter((text): text is string => typeof text === 'string' && text.length > 0)
        .slice(0, 8);
      // Generated lists number id, email, and name-like text per row themselves; the base value
      // keeps them from becoming "preview-id-2-2".
      const texts = isGeneratedListNumberedField(key) ? values.slice(0, 1) : values;
      if (texts.length === 0) continue;
      properties[key] = Object.freeze({ ...child, candidateValues: Object.freeze(texts) });
      changed = true;
    }
    return changed
      ? Object.freeze({
          ...node,
          items: Object.freeze({ ...items, properties: Object.freeze(properties) }),
        })
      : node;
  }
  if (node.kind !== 'object' || node.properties === undefined || Array.isArray(value)) return node;
  const record = value as Readonly<Record<string, PreviewTypedPropValue>>;
  const properties: Record<string, PreviewInferredPropShape> = { ...node.properties };
  let changed = false;
  for (const [key, child] of Object.entries(node.properties)) {
    const typedChild = record[key];
    if (typedChild === undefined) continue;
    const completed = addPreviewTypedListCandidates(child, typedChild, depth + 1);
    if (completed !== child) {
      properties[key] = completed;
      changed = true;
    }
  }
  return changed ? Object.freeze({ ...node, properties: Object.freeze(properties) }) : node;
}

/** Same field rule as the browser's `diversifyPreviewGeneratedListString`. */
function isGeneratedListNumberedField(fieldName: string): boolean {
  const name = fieldName.replaceAll('_', '').toLowerCase();
  return (
    name === 'id' ||
    name.endsWith('id') ||
    name === 'uuid' ||
    name.includes('email') ||
    /(?:name|label|title|subject|headline)$/u.test(name)
  );
}

/** Narrows a typed value to a plain record. */
function isPreviewTypedRecord(
  value: PreviewTypedPropValue,
): value is Readonly<Record<string, PreviewTypedPropValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keeps the typed parts of one prop that usage inference left absent or as a placeholder. */
function selectPreviewTypedLayer(
  value: PreviewTypedPropValue,
  node: PreviewInferredPropShape | undefined,
): PreviewTypedPropValue | undefined {
  if (node === undefined || isPreviewEvidenceFreeShape(node)) return value;
  if (isPreviewNeutralTextShape(node)) {
    return typeof value === 'string' &&
      (isPreviewSampleDateText(value) || (node.renderedText === true && value.length > 0))
      ? value
      : undefined;
  }
  if (
    node.kind !== 'object' ||
    node.collection !== undefined ||
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return undefined;
  }
  const partial: Record<string, PreviewTypedPropValue> = {};
  for (const [key, child] of Object.entries(
    value as Readonly<Record<string, PreviewTypedPropValue>>,
  )) {
    const selected = selectPreviewTypedLayer(child, node.properties?.[key]);
    if (selected !== undefined) partial[key] = selected;
  }
  return Object.keys(partial).length === 0 ? undefined : partial;
}

/** Recognizes the canonical sample date the synthesizer gives declared calendar text. */
function isPreviewSampleDateText(value: PreviewTypedPropValue): boolean {
  return value === PREVIEW_CANONICAL_SAMPLE_DATE || value === PREVIEW_CANONICAL_SAMPLE_DATE_TIME;
}

/** Recognizes a text leaf with no generated value, which the browser materializes as ''. */
function isPreviewNeutralTextShape(node: PreviewInferredPropShape): boolean {
  return (
    node.kind === 'string' &&
    node.exactValue !== true &&
    node.value === undefined &&
    (node.candidateValues?.length ?? 0) === 0
  );
}

/** Recognizes an inferred node that only records a receiver, not what it holds. */
function isPreviewEvidenceFreeShape(node: PreviewInferredPropShape): boolean {
  if (
    node.exactValue === true ||
    node.value !== undefined ||
    (node.candidateValues?.length ?? 0) > 0
  ) {
    return false;
  }
  if (node.kind === 'array') return node.items === undefined;
  if (node.kind !== 'object' || node.collection !== undefined) return false;
  const keys = Object.keys(node.properties ?? {});
  return keys.length === 0 || (keys.length === 1 && keys[0] === 'length');
}
