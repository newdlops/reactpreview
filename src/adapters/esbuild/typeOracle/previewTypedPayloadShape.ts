/**
 * Converts declared TypeScript response types into Virtual Backend payload shapes.
 *
 * The Page Inspector payload generator builds responses from a JSON-safe shape tree. Without
 * types, GraphQL leaves are guessed from field names: a `status` field becomes `'ACTIVE'` and a
 * field named like a collection becomes a list, so a component that switches over a declared
 * status union throws on the unknown value. A declared result type, such as the result of a
 * codegen `TypedDocumentNode`, states which fields are lists, objects, numbers, booleans, and which
 * strings form a closed literal set. The generator keeps its name-based text only where the type
 * says "any string".
 */
import ts from 'typescript';
import { createPreviewCanonicalSampleMonthDay } from '../previewSampleDateRuntimeSource';
import { readPreviewDateTextEvidence } from './previewDateTextEvidence';
import type { PreviewRecordKeyReader } from './previewRecordKeyInference';

/** Shape contract shared with the Page Inspector data runtime (`normalizePreviewInspectorDataShape`). */
export type PreviewTypedPayloadShape =
  | { readonly items: PreviewTypedPayloadShape; readonly kind: 'array' }
  | {
      readonly fields: Readonly<Record<string, PreviewTypedPayloadShape>>;
      readonly kind: 'object';
    }
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'boolean' | 'null' | 'number' | 'string' | 'unknown' };

const MAX_DEPTH = 10;
const MAX_NODES = 1_500;
/** Matches the runtime's literal bound; longer literals fall back to generated text. */
const MAX_LITERAL_LENGTH = 160;
const UNKNOWN: PreviewTypedPayloadShape = Object.freeze({ kind: 'unknown' });
/** Same calendar conventions as the value synthesizer: `…At`/`…Time` carry a clock, `…date` does not. */
const DATE_TIME_NAME_PATTERN = /(?:_at|[a-z]At|datetime|DateTime|[tT]ime|[tT]imestamp)$/u;
const DATE_ONLY_NAME_PATTERN = /(?:date|Date|ymd|Ymd)$/u;

interface ShapeState {
  readonly anchor: ts.Node;
  readonly checker: ts.TypeChecker;
  nodes: number;
  /** Literal keys the project reads from a record-typed property (`Record<string, T>`). */
  readonly readRecordKeys?: PreviewRecordKeyReader | undefined;
}

/**
 * Converts one declared response type.
 *
 * @param checker Checker of the program that owns `anchor`.
 * @param type Declared response type, for example a GraphQL operation result.
 * @param anchor Node used to resolve property types in context.
 * @param readRecordKeys Optional reader of literal keys read from record-typed fields.
 * @returns Shape, or `undefined` when the type carries no structure (`any`, an empty record).
 */
export function createPreviewTypedPayloadShape(
  checker: ts.TypeChecker,
  type: ts.Type,
  anchor: ts.Node,
  readRecordKeys?: PreviewRecordKeyReader,
): PreviewTypedPayloadShape | undefined {
  const shape = convert({ anchor, checker, nodes: 0, readRecordKeys }, type, 0);
  if (shape.kind === 'unknown') return undefined;
  if (shape.kind === 'object' && Object.keys(shape.fields).length === 0) return undefined;
  return shape;
}

/**
 * Reads the result type of a typed GraphQL document such as `TypedDocumentNode<Result, Vars>`.
 * The phantom `__apiType`/`__resultType` members are what codegen presets, typed-document-node,
 * and Apollo's re-export share, so no library name is required.
 *
 * @returns Result type, or `undefined` for an untyped `DocumentNode` or any other value.
 */
export function readPreviewTypedDocumentResultType(
  checker: ts.TypeChecker,
  type: ts.Type,
  anchor: ts.Node,
): ts.Type | undefined {
  const apiType = checker.getPropertyOfType(type, '__apiType');
  if (apiType !== undefined) {
    const callable = checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(apiType, anchor));
    const [signature] = callable.getCallSignatures();
    if (signature !== undefined) return checker.getReturnTypeOfSignature(signature);
  }
  const resultType = checker.getPropertyOfType(type, '__resultType');
  return resultType === undefined
    ? undefined
    : checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(resultType, anchor));
}

/**
 * Unwraps transport wrappers around a declared response body: a promise resolves to its value,
 * and an HTTP response object (`data` beside `status`/`headers`, as in Axios) carries its body in
 * `data`. Other types are already the body.
 *
 * @returns Body type to convert into a payload shape.
 */
export function readPreviewResponseBodyType(
  checker: ts.TypeChecker,
  type: ts.Type,
  anchor: ts.Node,
): ts.Type {
  const awaited = checker.getAwaitedType(type) ?? type;
  const data = checker.getPropertyOfType(awaited, 'data');
  const transport =
    checker.getPropertyOfType(awaited, 'status') !== undefined &&
    checker.getPropertyOfType(awaited, 'headers') !== undefined;
  return data !== undefined && transport
    ? checker.getTypeOfSymbolAtLocation(data, anchor)
    : awaited;
}

/** Dispatches one type; unions and objects recurse with depth and node bounds. */
function convert(
  state: ShapeState,
  type: ts.Type,
  depth: number,
  name = '',
  fieldSymbol?: ts.Symbol,
): PreviewTypedPayloadShape {
  if (depth > MAX_DEPTH || state.nodes >= MAX_NODES) return UNKNOWN;
  state.nodes += 1;
  const flags = type.flags;
  const absent =
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Never |
    ts.TypeFlags.Void |
    ts.TypeFlags.Undefined;
  if ((flags & absent) !== 0) return UNKNOWN;
  if ((flags & ts.TypeFlags.Null) !== 0) return { kind: 'null' };
  if (type.isStringLiteral()) {
    return type.value.length <= MAX_LITERAL_LENGTH
      ? { kind: 'literal', value: type.value }
      : { kind: 'string' };
  }
  if ((flags & ts.TypeFlags.NumberLike) !== 0) return { kind: 'number' };
  if ((flags & ts.TypeFlags.BooleanLike) !== 0) return { kind: 'boolean' };
  if ((flags & ts.TypeFlags.StringLike) !== 0) return convertText(name, fieldSymbol);
  if (type.isUnion()) return convertUnion(state, type, depth, name, fieldSymbol);
  if ((flags & ts.TypeFlags.Object) !== 0 || type.isIntersection()) {
    return convertObject(state, type, depth, name, fieldSymbol);
  }
  return UNKNOWN;
}

/**
 * Picks one member of a union: nullability is dropped so the payload has data, a closed literal
 * set keeps its first literal, and object alternatives prefer the member with the most fields.
 */
function convertUnion(
  state: ShapeState,
  type: ts.UnionType,
  depth: number,
  name: string,
  fieldSymbol: ts.Symbol | undefined,
): PreviewTypedPayloadShape {
  const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
  const members = type.types.filter((member) => (member.flags & nullish) === 0);
  if (members.length === 0) {
    return type.types.some((member) => (member.flags & ts.TypeFlags.Null) !== 0)
      ? { kind: 'null' }
      : UNKNOWN;
  }
  if (members.every((member) => (member.flags & ts.TypeFlags.BooleanLike) !== 0)) {
    return { kind: 'boolean' };
  }
  if (members.every((member) => member.isStringLiteral())) {
    return convert(state, members[0] ?? type, depth + 1);
  }
  if (members.every((member) => (member.flags & ts.TypeFlags.StringLike) !== 0)) {
    return convertText(name, fieldSymbol);
  }
  if (members.every((member) => (member.flags & ts.TypeFlags.NumberLike) !== 0)) {
    return { kind: 'number' };
  }
  const ranked = [...members].sort(
    (left, right) =>
      state.checker.getPropertiesOfType(right).length -
      state.checker.getPropertiesOfType(left).length,
  );
  for (const member of ranked) {
    const shape = convert(state, member, depth + 1, name, fieldSymbol);
    if (shape.kind !== 'unknown') return shape;
  }
  return UNKNOWN;
}

/**
 * Declared text is open, but a date-named field has a calendar format that consumers extend
 * (`\`${date}T00:00:00Z\``), so it keeps the synthesizer's fixed sample instead of generated text.
 */
function convertText(name: string, fieldSymbol?: ts.Symbol): PreviewTypedPayloadShape {
  if (DATE_TIME_NAME_PATTERN.test(name))
    return { kind: 'literal', value: '2026-01-15T09:00:00.000Z' };
  if (DATE_ONLY_NAME_PATTERN.test(name)) return { kind: 'literal', value: '2026-01-15' };
  const dated = readPreviewDateTextEvidence(name, fieldSymbol?.valueDeclaration);
  if (dated !== undefined) {
    const value =
      dated === 'date'
        ? '2026-01-15'
        : dated === 'date-time'
          ? '2026-01-15T09:00:00.000Z'
          : createPreviewCanonicalSampleMonthDay(0, dated === 'month-day-padded');
    return { kind: 'literal', value };
  }
  return { kind: 'string' };
}

/** Converts arrays, tuples, and property bags; runtime-only objects become JSON-safe kinds. */
function convertObject(
  state: ShapeState,
  type: ts.Type,
  depth: number,
  name: string,
  fieldSymbol: ts.Symbol | undefined,
): PreviewTypedPayloadShape {
  const { anchor, checker } = state;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const [element] = checker.getTypeArguments(type as ts.TypeReference);
    return {
      items: element === undefined ? UNKNOWN : convert(state, element, depth + 1, name),
      kind: 'array',
    };
  }
  const symbolName = type.getSymbol()?.getName();
  // JSON transports dates as text; maps, sets, and promises never appear in a response body.
  if (symbolName === 'Date') {
    return DATE_ONLY_NAME_PATTERN.test(name) && !DATE_TIME_NAME_PATTERN.test(name)
      ? { kind: 'literal', value: '2026-01-15' }
      : { kind: 'literal', value: '2026-01-15T09:00:00.000Z' };
  }
  if (symbolName === 'Map' || symbolName === 'Set' || symbolName === 'Promise') return UNKNOWN;
  const properties = checker.getPropertiesOfType(type);
  if (properties.length === 0 && type.getCallSignatures().length > 0) return UNKNOWN;
  const fields: Record<string, PreviewTypedPayloadShape> = {};
  // A pure index signature (`Record<string, number>`) has no declared keys; use the keys the
  // project reads from this exact property, or keep the empty object when there are none.
  const indexType =
    properties.length === 0 && fieldSymbol !== undefined && state.readRecordKeys !== undefined
      ? checker.getIndexTypeOfType(type, ts.IndexKind.String)
      : undefined;
  if (indexType !== undefined && state.readRecordKeys !== undefined && fieldSymbol !== undefined) {
    for (const key of state.readRecordKeys(fieldSymbol)) {
      fields[key] = convert(state, indexType, depth + 1, key);
      if (state.nodes >= MAX_NODES) break;
    }
    return { fields, kind: 'object' };
  }
  for (const property of properties) {
    const propertyName = property.getName();
    if (propertyName.startsWith('__') && propertyName !== '__typename') continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(property, anchor);
    const nonNullable = checker.getNonNullableType(propertyType);
    if (nonNullable.getCallSignatures().length > 0 && nonNullable.getProperties().length === 0) {
      continue;
    }
    fields[propertyName] = convert(state, propertyType, depth + 1, propertyName, property);
    if (state.nodes >= MAX_NODES) break;
  }
  return { fields, kind: 'object' };
}
