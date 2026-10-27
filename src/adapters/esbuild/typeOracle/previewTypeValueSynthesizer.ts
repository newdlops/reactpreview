/**
 * Converts a TypeScript checker type into a bounded, deterministic preview value descriptor.
 *
 * The descriptor is JSON so it can travel inside compiler-issued hook metadata. Runtime-only
 * values (functions, dates, collections, promises) are tagged objects that the Page Inspector
 * materializes. Nothing here evaluates project code: the checker's declared types are the only
 * evidence, and property names only choose readable scalar samples within the declared kind.
 * Invariants: output is deterministic (no clock, randomness, or environment input), bounded by
 * depth and node budgets, and a root that is `any`/`unknown` yields no value so callers keep
 * their existing syntax-derived fallback.
 */
import ts from 'typescript';
import { PREVIEW_DATE_RANGE_START_PATTERN } from '../previewDateRangeEndpoint';
import { PREVIEW_LIFECYCLE_END_TIMESTAMP_PATTERN } from '../previewLifecycleTimestamp';
import {
  createPreviewCanonicalSampleDate,
  createPreviewCanonicalSampleDateTime,
  createPreviewCanonicalSampleMonthDay,
  PREVIEW_CANONICAL_SAMPLE_DATE,
  PREVIEW_CANONICAL_SAMPLE_DATE_TIME,
  PREVIEW_SAMPLE_DATE_MAX_OFFSET,
} from '../previewSampleDateRuntimeSource';
import { createPreviewSampleLabel } from '../previewSampleLabel';
import { inferPreviewRuntimeSemanticFallback } from '../staticResources/previewRuntimeHookSemantics';
import { readPreviewDateTextEvidence } from './previewDateTextEvidence';

/** Tag property used by runtime-only value descriptors. */
export const PREVIEW_TYPED_VALUE_TAG = '$previewTyped';

/** JSON-safe descriptor tree; tagged objects represent functions, dates, and collections. */
export type PreviewTypedValue =
  | boolean
  | null
  | number
  | string
  | readonly PreviewTypedValue[]
  | { readonly [key: string]: PreviewTypedValue };

/** Synthesized value plus the literal sets that constrain individual descriptor paths. */
export interface PreviewTypedValueResult {
  /** Paths (`a.b[].c`) whose declared type is a finite literal union, mapped to allowed values. */
  readonly literals: Readonly<Record<string, readonly (boolean | number | string)[]>>;
  /** Number of descriptor nodes produced, bounded by the synthesis budget. */
  readonly nodes: number;
  /** Descriptor for the whole declared type. */
  readonly value: PreviewTypedValue;
}

/** Property paths used by the authored code; they guide union selection and optional fields. */
interface PreviewTypeDemand {
  callable: boolean;
  readonly children: Map<string, PreviewTypeDemand>;
  item?: PreviewTypeDemand;
}

interface SynthesisState {
  readonly anchor: ts.Node;
  readonly checker: ts.TypeChecker;
  /** Items per declared Array (tuples keep their declared length). */
  readonly listLength: number;
  readonly literals: Record<string, (boolean | number | string)[]>;
  nodes: number;
  readonly unknownPlaceholders: boolean;
}

/** Options of one synthesis. */
export interface PreviewTypedValueSynthesisOptions {
  /**
   * Items per declared Array, 1 by default. A value shown as-is (target-only typed props) uses
   * the generated-list length, so `weeks.future: string[]` fills more than one header and each
   * item's dates and identities differ (`varyPreviewTypedListItem`).
   */
  readonly listLength?: number;
  /**
   * Marks nested `any`/`unknown` slots (types the program could not resolve, such as an
   * uninstalled package's) with an `unknown` tag instead of leaving them out, so a caller can put
   * its own neutral value there. Off by default.
   */
  readonly unknownPlaceholders?: boolean;
}

const MAX_DEPTH = 9;
/** Large enough for GraphQL results under Apollo's QueryResult; metadata pruning bounds output. */
const MAX_NODES = 1_200;
const MAX_LITERALS_PER_PATH = 16;
const ABSENT: unique symbol = Symbol('absent');
const REACT_NODE_TYPE_NAMES = new Set([
  'Element',
  'ReactElement',
  'ReactNode',
  'ReactPortal',
  'JSXElementConstructor',
]);
const REACT_COMPONENT_TYPE_NAMES = new Set([
  'ComponentClass',
  'FunctionComponent',
  'ExoticComponent',
  'NamedExoticComponent',
  'ForwardRefExoticComponent',
]);
const DATE_TIME_NAME_PATTERN = /(?:_at|[a-z]At|datetime|DateTime|[tT]ime|[tT]imestamp)$/u;
const DATE_ONLY_NAME_PATTERN = /(?:date|Date|day|Day|ymd|Ymd|week|Week|month|Month)$/u;
const PREFERRED_STATUS_LITERALS = new Set(['success', 'succeeded', 'fulfilled', 'ready', 'loaded']);
const UNFAVORED_STATUS_LITERALS = new Set(['error', 'pending', 'loading', 'idle', 'rejected']);

/**
 * Synthesizes a descriptor for one declared type.
 *
 * @param checker Checker of the program that owns `type`.
 * @param type Declared or inferred type at the synthesis site.
 * @param anchor Node used to resolve property types in the site's context.
 * @param requiredPaths Authored usage paths such as `data.items[].id` or `refetch()`.
 * @param options Items per declared Array.
 * @returns Descriptor and literal constraints, or `undefined` for untyped (`any`) roots.
 */
export function synthesizePreviewTypedValue(
  checker: ts.TypeChecker,
  type: ts.Type,
  anchor: ts.Node,
  requiredPaths: readonly string[] = [],
  options: PreviewTypedValueSynthesisOptions = {},
): PreviewTypedValueResult | undefined {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return undefined;
  const listLength = Math.min(10, Math.max(1, Math.trunc(options.listLength ?? 1)));
  const state: SynthesisState = {
    anchor,
    checker,
    listLength,
    literals: {},
    nodes: 0,
    unknownPlaceholders: options.unknownPlaceholders === true,
  };
  const value = synthesize(state, type, '', createPreviewTypeDemand(requiredPaths), 0, '');
  if (value === ABSENT) return undefined;
  return { literals: state.literals, nodes: state.nodes, value };
}

/** Parses authored usage paths into a demand tree using the Page Inspector path grammar. */
export function createPreviewTypeDemand(requiredPaths: readonly string[]): PreviewTypeDemand {
  const root: PreviewTypeDemand = { callable: false, children: new Map() };
  for (const rawPath of requiredPaths) {
    if (typeof rawPath !== 'string' || rawPath === '<root>') continue;
    const callable = rawPath.endsWith('()');
    const source = callable ? rawPath.slice(0, -2) : rawPath;
    let node = root;
    const segments = source.split('.').filter((segment) => segment.length > 0);
    segments.forEach((rawSegment, index) => {
      const segment = rawSegment.replace(/\?$/u, '');
      const itemMatch = /^(.*?)\[\d*\]$/u.exec(segment);
      const name = itemMatch === null ? segment : itemMatch[1];
      if (name !== undefined && name.length > 0 && name !== '<root>') {
        let child = node.children.get(name);
        if (child === undefined) {
          child = { callable: false, children: new Map() };
          node.children.set(name, child);
        }
        node = child;
      }
      if (itemMatch !== null) {
        node.item ??= { callable: false, children: new Map() };
        node = node.item;
      }
      if (callable && index === segments.length - 1) node.callable = true;
    });
  }
  return root;
}

/**
 * Keeps only the demanded subtrees of a typed value so bounded metadata still carries the part
 * the code reads. A demanded leaf keeps its whole subtree, objects keep demanded keys, and arrays
 * prune every item with the item demand.
 *
 * @param value Descriptor produced by `synthesizePreviewTypedValue`.
 * @param requiredPaths Authored usage paths (`a.b`, `rows[].id`).
 * @returns Pruned descriptor; unchanged when no path is demanded.
 */
export function prunePreviewTypedValue(
  value: PreviewTypedValue,
  requiredPaths: readonly string[],
): PreviewTypedValue {
  return pruneByDemand(value, createPreviewTypeDemand(requiredPaths), 0);
}

/** Recursive worker of `prunePreviewTypedValue`. */
function pruneByDemand(
  value: PreviewTypedValue,
  demand: PreviewTypeDemand,
  depth: number,
): PreviewTypedValue {
  if ((demand.children.size === 0 && demand.item === undefined) || depth > MAX_DEPTH + 2) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value as readonly PreviewTypedValue[];
    return items.map((item) => pruneByDemand(item, demand.item ?? demand, depth + 1));
  }
  if (value === null || typeof value !== 'object') return value;
  const record = value as Readonly<Record<string, PreviewTypedValue>>;
  if (PREVIEW_TYPED_VALUE_TAG in record) return value;
  const output: Record<string, PreviewTypedValue> = {};
  for (const [key, child] of demand.children) {
    const entry = Object.hasOwn(record, key) ? record[key] : undefined;
    if (entry !== undefined) output[key] = pruneByDemand(entry, child, depth + 1);
  }
  return output;
}

/** Dispatches one type to its synthesizer; `ABSENT` means no value, not `undefined`. */
function synthesize(
  state: SynthesisState,
  type: ts.Type,
  path: string,
  demand: PreviewTypeDemand | undefined,
  depth: number,
  name: string,
  declaration?: ts.TypeNode,
): PreviewTypedValue | typeof ABSENT {
  if (depth > MAX_DEPTH || state.nodes >= MAX_NODES) return ABSENT;
  const flags = type.flags;
  if ((flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) {
    return state.unknownPlaceholders ? { [PREVIEW_TYPED_VALUE_TAG]: 'unknown' } : ABSENT;
  }
  // Free-form JSON (Prisma's `JsonValue`) has no sample shape; callers keep their neutral value.
  if (state.unknownPlaceholders && type.aliasSymbol?.getName() === 'JsonValue') {
    return { [PREVIEW_TYPED_VALUE_TAG]: 'unknown' };
  }
  if ((flags & ts.TypeFlags.Never) !== 0) return ABSENT;
  if ((flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)) !== 0) return ABSENT;
  state.nodes += 1;
  if ((flags & ts.TypeFlags.Null) !== 0) return null;
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value;
  if ((flags & ts.TypeFlags.BooleanLiteral) !== 0) return isTrueLiteral(type);
  if ((flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) !== 0) {
    const dated = readPreviewDateTextEvidence(name, declaration);
    if (dated !== undefined) {
      // A range opening endpoint starts nine days back so the period holds every sample row date.
      const offset = PREVIEW_DATE_RANGE_START_PATTERN.test(name)
        ? PREVIEW_SAMPLE_DATE_MAX_OFFSET
        : 0;
      if (dated === 'date') return createPreviewCanonicalSampleDate(offset);
      if (dated === 'date-time') return createPreviewCanonicalSampleDateTime(offset);
      return createPreviewCanonicalSampleMonthDay(offset, dated === 'month-day-padded');
    }
    return semanticScalar(name, 'string');
  }
  if ((flags & ts.TypeFlags.Number) !== 0) return semanticScalar(name, 'number');
  if ((flags & ts.TypeFlags.Boolean) !== 0) return semanticScalar(name, 'boolean');
  if ((flags & ts.TypeFlags.BigIntLiteral) !== 0) {
    const literal = (type as ts.BigIntLiteralType).value;
    return createBigIntValue(`${literal.negative ? '-' : ''}${literal.base10Value}`);
  }
  if ((flags & ts.TypeFlags.BigInt) !== 0) {
    // A bigint field (micro-unit costs, ids) follows the number naming rule, as an integer.
    const sample = semanticScalar(name, 'number');
    return createBigIntValue(String(typeof sample === 'number' ? Math.trunc(sample) : 1));
  }
  if ((flags & ts.TypeFlags.ESSymbolLike) !== 0) return ABSENT;
  if (type.isUnion()) return synthesizeUnion(state, type, path, demand, depth, name, declaration);
  if (type.isIntersection()) return synthesizeIntersection(state, type, path, demand, depth);
  if ((flags & ts.TypeFlags.Object) !== 0) {
    return synthesizeObject(state, type as ts.ObjectType, path, demand, depth, name, declaration);
  }
  return ABSENT;
}

/** Resolves nullable slots, literal sets, and object members ranked by authored demand. */
function synthesizeUnion(
  state: SynthesisState,
  type: ts.UnionType,
  path: string,
  demand: PreviewTypeDemand | undefined,
  depth: number,
  name: string,
  declaration: ts.TypeNode | undefined,
): PreviewTypedValue | typeof ABSENT {
  const nullish = ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void;
  const nullable = type.types.some((member) => (member.flags & ts.TypeFlags.Null) !== 0);
  // Error, fallback, and child slots are absent in an ordinary successful render, and so is an
  // ending-state timestamp (`deletedAt`), which would open tombstone or deletion notices.
  if (
    nullable &&
    name.length > 0 &&
    (inferPreviewRuntimeSemanticFallback(name)?.kind === 'null' ||
      PREVIEW_LIFECYCLE_END_TIMESTAMP_PATTERN.test(name))
  ) {
    return null;
  }
  // Only alternatives that can produce a value need source ordering or checker text keys.
  const present = type.types.filter((member) => (member.flags & nullish) === 0);
  if (present.length === 0) return nullable ? null : ABSENT;
  if (isReactNodeLike(type)) return semanticScalar(name, 'string');
  const members =
    present.length === 1
      ? present
      : orderDeclaredUnionMembers(state.checker, type, declaration, present);
  const literalValues = members.map(readLiteralValue);
  if (literalValues.every((value) => value !== undefined)) {
    const allowed = [...new Set(literalValues)];
    const onlyBooleans = allowed.every((value) => typeof value === 'boolean');
    if (!onlyBooleans) state.literals[path] = allowed.slice(0, MAX_LITERALS_PER_PATH);
    return onlyBooleans
      ? semanticScalar(name, 'boolean')
      : (selectSettledLiteral(allowed) ?? ABSENT);
  }
  // Ranking belongs to this demand and anchor only; no checker/type survives this local sort.
  const ranked =
    members.length === 1
      ? members
      : members
          .map((member) => ({ member, score: scoreUnionMember(state, member, demand) }))
          .sort((left, right) => right.score - left.score)
          .map(({ member }) => member);
  for (const member of ranked) {
    const value = synthesize(state, member, path, demand, depth, name);
    if (value !== ABSENT) return value;
  }
  return ABSENT;
}

/** Synthesizes an intersection through its merged apparent properties. */
function synthesizeIntersection(
  state: SynthesisState,
  type: ts.IntersectionType,
  path: string,
  demand: PreviewTypeDemand | undefined,
  depth: number,
): PreviewTypedValue | typeof ABSENT {
  // Members share one apparent property set; synthesizing the merged object preserves every field.
  return synthesizeProperties(state, type, path, demand, depth);
}

/** Synthesizes arrays, tuples, runtime built-ins, callables, and plain object shapes. */
function synthesizeObject(
  state: SynthesisState,
  type: ts.ObjectType,
  path: string,
  demand: PreviewTypeDemand | undefined,
  depth: number,
  name: string,
  declaration: ts.TypeNode | undefined,
): PreviewTypedValue | typeof ABSENT {
  const { checker } = state;
  if (isReactNodeLike(type)) return null;
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const typeArguments = checker.getTypeArguments(type as ts.TypeReference);
    if (checker.isTupleType(type)) {
      return typeArguments.map((element, index) => {
        const value = synthesize(
          state,
          element,
          `${path}[]`,
          demand?.item,
          depth + 1,
          `${name}${index.toString()}`,
        );
        return value === ABSENT ? null : value;
      });
    }
    const element = typeArguments[0];
    if (element === undefined) return [];
    const item = synthesize(
      state,
      element,
      `${path}[]`,
      demand?.item,
      depth + 1,
      singularName(name),
      declaration !== undefined && ts.isArrayTypeNode(declaration)
        ? declaration.elementType
        : undefined,
    );
    if (item === ABSENT) return [];
    const itemName = singularName(name);
    // A future-named list (`future`, `upcomingDates`) counts forward; other lists step back.
    const direction = isFutureListName(name) ? -1 : 1;
    return Array.from({ length: state.listLength }, (_, index) =>
      varyPreviewTypedListItem(item, index, itemName, direction),
    );
  }
  const symbol = type.getSymbol();
  const symbolName = symbol?.getName() ?? '';
  const specialReactType =
    REACT_COMPONENT_TYPE_NAMES.has(symbolName) ||
    symbolName === 'RefObject' ||
    symbolName === 'MutableRefObject';
  const declaredByReact =
    specialReactType &&
    symbol?.declarations?.some((node) =>
      node.getSourceFile().fileName.replaceAll('\\', '/').includes('/node_modules/@types/react/'),
    ) === true;
  // React constructors also own metadata properties; treating them as records yields invalid JSX.
  if (declaredByReact && REACT_COMPONENT_TYPE_NAMES.has(symbolName)) {
    return { [PREVIEW_TYPED_VALUE_TAG]: 'function', returns: null };
  }
  if ((symbolName === 'RefObject' || symbolName === 'MutableRefObject') && declaredByReact) {
    const current = checker.getPropertyOfType(type, 'current');
    const currentType =
      current === undefined ? undefined : checker.getTypeOfSymbolAtLocation(current, state.anchor);
    const members =
      currentType?.isUnion() === true
        ? currentType.types
        : currentType === undefined
          ? []
          : [currentType];
    const nullable = members.some(
      (member) =>
        (member.flags & (ts.TypeFlags.Null | ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0,
    );
    const value =
      currentType === undefined || nullable
        ? null
        : synthesize(
            state,
            currentType,
            `${path}.current`,
            demand?.children.get('current'),
            depth + 1,
            'current',
          );
    return { [PREVIEW_TYPED_VALUE_TAG]: 'ref', value: value === ABSENT ? null : value };
  }
  if (symbolName === 'Date')
    return { [PREVIEW_TYPED_VALUE_TAG]: 'date', iso: '2026-01-15T09:00:00.000Z' };
  if (symbolName === 'Map' || symbolName === 'WeakMap') return { [PREVIEW_TYPED_VALUE_TAG]: 'map' };
  if (symbolName === 'Set' || symbolName === 'WeakSet') return { [PREVIEW_TYPED_VALUE_TAG]: 'set' };
  // Thenable classes such as Prisma's `PrismaPromise` settle like a promise of their result.
  if (
    symbolName === 'Promise' ||
    symbolName === 'PromiseLike' ||
    checker.getPropertyOfType(type, 'then') !== undefined
  ) {
    const awaited = checker.getAwaitedType(type) ?? type;
    const value =
      awaited === type ? ABSENT : synthesize(state, awaited, path, demand, depth + 1, name);
    return { [PREVIEW_TYPED_VALUE_TAG]: 'promise', value: value === ABSENT ? null : value };
  }
  const signatures = type.getCallSignatures();
  if (signatures.length > 0 && checker.getPropertiesOfType(type).length === 0) {
    return synthesizeFunction(state, signatures[0], path, demand, depth, name);
  }
  return synthesizeProperties(state, type, path, demand, depth);
}

/** Describes a callable whose result is the declared return type's value. */
function synthesizeFunction(
  state: SynthesisState,
  signature: ts.Signature | undefined,
  path: string,
  demand: PreviewTypeDemand | undefined,
  depth: number,
  name: string,
): PreviewTypedValue {
  const returnType =
    signature === undefined ? undefined : state.checker.getReturnTypeOfSignature(signature);
  const value =
    returnType === undefined
      ? ABSENT
      : synthesize(state, returnType, `${path}()`, demand, depth + 1, name);
  return value === ABSENT
    ? { [PREVIEW_TYPED_VALUE_TAG]: 'function' }
    : { [PREVIEW_TYPED_VALUE_TAG]: 'function', returns: value };
}

/** Fills required properties, demanded optional ones, and demanded string-index keys. */
function synthesizeProperties(
  state: SynthesisState,
  type: ts.Type,
  path: string,
  demand: PreviewTypeDemand | undefined,
  depth: number,
): PreviewTypedValue | typeof ABSENT {
  const { anchor, checker } = state;
  const output: Record<string, PreviewTypedValue> = {};
  // Authored reads first, so a large sibling such as an Apollo `client` cannot starve them.
  const properties = orderPropertiesDeterministically(checker.getPropertiesOfType(type)).sort(
    (left, right) =>
      Number(demand?.children.has(right.getName()) === true) -
      Number(demand?.children.has(left.getName()) === true),
  );
  for (const property of properties) {
    const propertyName = property.getName();
    if (propertyName.startsWith('__') || propertyName === 'constructor') continue;
    const childDemand = demand?.children.get(propertyName);
    const optional = (property.getFlags() & ts.SymbolFlags.Optional) !== 0;
    if (optional && childDemand === undefined) continue;
    const childPath = path.length === 0 ? propertyName : `${path}.${propertyName}`;
    // A free-form slot declared nullable (Prisma `Json?`: `any | null`, `JsonValue | null`) has
    // no sample shape, and an empty column is what such a slot ordinarily holds.
    if (state.unknownPlaceholders && isNullableFreeFormSlot(readOriginalTypeNode(property))) {
      output[propertyName] = null;
      continue;
    }
    const propertyType = checker.getTypeOfSymbolAtLocation(property, anchor);
    const value = synthesize(
      state,
      propertyType,
      childPath,
      childDemand,
      depth + 1,
      propertyName,
      readDeclaredTypeNode(property),
    );
    if (value !== ABSENT) output[propertyName] = value;
    if (state.nodes >= MAX_NODES) break;
  }
  const indexType = checker.getIndexTypeOfType(type, ts.IndexKind.String);
  if (indexType !== undefined && demand !== undefined) {
    for (const [key, childDemand] of demand.children) {
      if (Object.hasOwn(output, key)) continue;
      const childPath = path.length === 0 ? key : `${path}.${key}`;
      const value = synthesize(state, indexType, childPath, childDemand, depth + 1, key);
      if (value !== ABSENT) output[key] = value;
    }
  }
  return output;
}

/**
 * Orders synthesized properties as their source declares them. A mapped type over a key union
 * (`Pick`, `Omit`, Prisma's `GetPayloadResult`) lists properties in the key literals' type-id
 * order, which follows whatever the checker resolved first, so the same type could produce objects
 * whose keys come in a different order from one compile to the next. Declared properties are
 * grouped by declaring node (nodes in source order) and kept in declaration order; properties
 * without declarations (remapped `select` results) follow by name. Lists with only declared,
 * non-synthesized properties (interfaces, type literals, plain intersections) are already stable
 * and keep the checker's order.
 */
function orderPropertiesDeterministically(properties: readonly ts.Symbol[]): ts.Symbol[] {
  if (!properties.some((property) => (property.getFlags() & ts.SymbolFlags.Transient) !== 0)) {
    return [...properties];
  }
  /** Sort key of one property: its declaring node's place, then its own position. */
  const readKey = (property: ts.Symbol): readonly [string, number, number] | undefined => {
    const declaration = property.declarations?.[0];
    if (declaration === undefined) return undefined;
    return [declaration.getSourceFile().fileName, declaration.parent.pos, declaration.pos];
  };
  return properties
    .map((property) => ({ key: readKey(property), name: property.getName(), property }))
    .sort((left, right) => {
      if (left.key === undefined || right.key === undefined) {
        if (left.key !== right.key) return left.key === undefined ? 1 : -1;
        return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
      }
      const [leftFile, leftParent, leftPosition] = left.key;
      const [rightFile, rightParent, rightPosition] = right.key;
      if (leftFile !== rightFile) return leftFile < rightFile ? -1 : 1;
      return leftParent - rightParent || leftPosition - rightPosition;
    })
    .map(({ property }) => property);
}

/**
 * Orders union members as the source declares them. The checker sorts `type.types` by type id,
 * which follows literal creation order, so resolving another module first ('warn' in a toast
 * kind) would otherwise move that literal to the front of an unrelated status union.
 */
function orderDeclaredUnionMembers(
  checker: ts.TypeChecker,
  type: ts.UnionType,
  declaration: ts.TypeNode | undefined,
  members: readonly ts.Type[],
): readonly ts.Type[] {
  const declared: ts.Type[] = [];
  const source = readAliasTypeNode(type) ?? declaration;
  if (source !== undefined) collectDeclaredUnionMembers(checker, source, declared, 0);
  const rank = new Map<ts.Type, number>();
  declared.forEach((member, index) => {
    if (!rank.has(member)) rank.set(member, index);
  });
  const stableKeys = new Map<ts.Type, string>();
  /** Computes a tie-break key only if needed, once for this union's ordering. */
  const readKey = (member: ts.Type): string => {
    let key = stableKeys.get(member);
    if (key === undefined) {
      key = readStableTypeKey(checker, member);
      stableKeys.set(member, key);
    }
    return key;
  };
  return [...members].sort(
    (left, right) =>
      (rank.get(left) ?? declared.length) - (rank.get(right) ?? declared.length) ||
      readKey(left).localeCompare(readKey(right)),
  );
}

/** Flattens a declared union, following type aliases, into its members in source order. */
function collectDeclaredUnionMembers(
  checker: ts.TypeChecker,
  node: ts.TypeNode,
  output: ts.Type[],
  depth: number,
): void {
  if (depth > 6 || output.length > 256) return;
  const unwrapped = ts.isParenthesizedTypeNode(node) ? node.type : node;
  if (ts.isUnionTypeNode(unwrapped)) {
    for (const member of unwrapped.types) {
      collectDeclaredUnionMembers(checker, member, output, depth + 1);
    }
    return;
  }
  const type = checker.getTypeFromTypeNode(unwrapped);
  const alias = type.isUnion() ? readAliasTypeNode(type) : undefined;
  if (alias !== undefined && alias !== unwrapped) {
    collectDeclaredUnionMembers(checker, alias, output, depth + 1);
  } else if (type.isUnion()) {
    // An enum reference: its members carry their own declarations.
    output.push(
      ...[...type.types].sort((left, right) =>
        readStableTypeKey(checker, left).localeCompare(readStableTypeKey(checker, right)),
      ),
    );
  } else {
    output.push(type);
  }
}

/**
 * Reports a slot declared as a union with `null` whose other members are written as free-form
 * types: `any`, `unknown`, or a `JsonValue` reference. The checker folds `any | null` into `any`,
 * so the declaration is the only evidence of the `null`. A nullable reference to a type the
 * program could not resolve is not free-form and keeps its neutral value.
 */
function isNullableFreeFormSlot(declaration: ts.TypeNode | undefined): boolean {
  if (declaration === undefined || !ts.isUnionTypeNode(declaration)) return false;
  const members = declaration.types.filter(
    (member) =>
      !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword),
  );
  return (
    members.length > 0 &&
    members.length < declaration.types.length &&
    members.every(
      (member) =>
        member.kind === ts.SyntaxKind.AnyKeyword ||
        member.kind === ts.SyntaxKind.UnknownKeyword ||
        (ts.isTypeReferenceNode(member) &&
          (ts.isIdentifier(member.typeName) ? member.typeName.text : member.typeName.right.text) ===
            'JsonValue'),
    )
  );
}

/**
 * Reads a property's annotated type, through mapped types (`Pick`, Prisma's `DefaultSelection`)
 * whose properties keep only the original property's declarations.
 */
function readOriginalTypeNode(symbol: ts.Symbol): ts.TypeNode | undefined {
  const declaration =
    symbol.valueDeclaration ??
    symbol.declarations?.find(
      (candidate) => ts.isPropertySignature(candidate) || ts.isPropertyDeclaration(candidate),
    );
  return declaration !== undefined &&
    (ts.isPropertySignature(declaration) || ts.isPropertyDeclaration(declaration))
    ? declaration.type
    : undefined;
}

/** Reads the type node of the alias a union was declared with (`type Status = 'a' | 'b'`). */
function readAliasTypeNode(type: ts.Type): ts.TypeNode | undefined {
  return type.aliasSymbol?.declarations?.find(ts.isTypeAliasDeclaration)?.type;
}

/** Reads the annotated type of a property, parameter, or variable declaration. */
function readDeclaredTypeNode(symbol: ts.Symbol): ts.TypeNode | undefined {
  const declaration = symbol.valueDeclaration;
  return declaration !== undefined &&
    (ts.isPropertySignature(declaration) ||
      ts.isPropertyDeclaration(declaration) ||
      ts.isParameter(declaration) ||
      ts.isVariableDeclaration(declaration))
    ? declaration.type
    : undefined;
}

/**
 * Orders members a union declaration does not cover, never by checker creation order: a member
 * with its own declaration (an enum member, an interface) by source position, others by value.
 */
function readStableTypeKey(checker: ts.TypeChecker, type: ts.Type): string {
  const declaration = type.getSymbol()?.declarations?.[0];
  if (declaration !== undefined) {
    const sourceFile = declaration.getSourceFile();
    return `0:${sourceFile.fileName}:${declaration.getStart(sourceFile).toString().padStart(10, '0')}`;
  }
  const literal = readLiteralValue(type);
  return literal === undefined
    ? `2:${checker.typeToString(type)}`
    : `1:${typeof literal}:${String(literal)}`;
}

/** Picks the first declared literal, preferring a settled status over idle, loading, or error. */
function selectSettledLiteral(
  allowed: readonly (boolean | number | string)[],
): boolean | number | string | undefined {
  const rankLiteral = (value: boolean | number | string): number =>
    typeof value !== 'string'
      ? 1
      : PREFERRED_STATUS_LITERALS.has(value)
        ? 0
        : UNFAVORED_STATUS_LITERALS.has(value)
          ? 2
          : 1;
  return [...allowed].sort((left, right) => rankLiteral(left) - rankLiteral(right))[0];
}

/** Prefers the union member that satisfies authored reads and represents a settled success state. */
function scoreUnionMember(
  state: SynthesisState,
  member: ts.Type,
  demand: PreviewTypeDemand | undefined,
): number {
  const { anchor, checker } = state;
  if ((member.flags & ts.TypeFlags.Object) === 0 && !member.isIntersection()) {
    return demand !== undefined && demand.children.size > 0 ? -10 : 0;
  }
  let score = checker.getPropertiesOfType(member).length * 0.01;
  for (const name of demand?.children.keys() ?? []) {
    const property = checker.getPropertyOfType(member, name);
    if (property === undefined) {
      score -= 5;
      continue;
    }
    const propertyType = checker.getTypeOfSymbolAtLocation(property, anchor);
    score += (propertyType.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Never)) === 0 ? 3 : -2;
  }
  const status = readLiteralProperty(checker, member, 'status', anchor);
  if (typeof status === 'string' && PREFERRED_STATUS_LITERALS.has(status)) score += 2;
  if (typeof status === 'string' && UNFAVORED_STATUS_LITERALS.has(status)) score -= 1;
  if (readLiteralProperty(checker, member, 'isError', anchor) === true) score -= 2;
  if (readLiteralProperty(checker, member, 'isLoading', anchor) === true) score -= 2;
  if (readLiteralProperty(checker, member, 'isPending', anchor) === true) score -= 2;
  if (readLiteralProperty(checker, member, 'isSuccess', anchor) === true) score += 1;
  return score;
}

/** Reads a property's literal type value, such as a query result's `status`. */
function readLiteralProperty(
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string,
  anchor: ts.Node,
): boolean | number | string | undefined {
  const property = checker.getPropertyOfType(type, name);
  return property === undefined
    ? undefined
    : readLiteralValue(checker.getTypeOfSymbolAtLocation(property, anchor));
}

/** Returns the value of a string, number, or boolean literal type. */
function readLiteralValue(type: ts.Type): boolean | number | string | undefined {
  if (type.isStringLiteral() || type.isNumberLiteral()) return type.value;
  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) return isTrueLiteral(type);
  return undefined;
}

/** Distinguishes the `true` literal type from `false`. */
function isTrueLiteral(type: ts.Type): boolean {
  return (type as ts.Type & { readonly intrinsicName?: string }).intrinsicName === 'true';
}

/** Reports React node and element types, which previews fill with text or leave empty. */
function isReactNodeLike(type: ts.Type): boolean {
  const names = [type.aliasSymbol?.getName(), type.getSymbol()?.getName()];
  return names.some((candidate) => candidate !== undefined && REACT_NODE_TYPE_NAMES.has(candidate));
}

/** Uses the shared name policy only when it agrees with the declared scalar kind. */
function semanticScalar(
  name: string,
  kind: 'boolean' | 'number' | 'string',
): boolean | number | string {
  // Date-named text keeps the calendar format such fields conventionally carry.
  if (kind === 'string' && DATE_TIME_NAME_PATTERN.test(name)) return '2026-01-15T09:00:00.000Z';
  if (kind === 'string' && DATE_ONLY_NAME_PATTERN.test(name)) return '2026-01-15';
  const semantic = name.length === 0 ? undefined : inferPreviewRuntimeSemanticFallback(name);
  if (semantic?.kind === kind && semantic.value !== undefined && semantic.value !== null) {
    return semantic.value;
  }
  if (kind === 'boolean') return false;
  if (kind === 'number') return 1;
  return createPreviewSampleLabel(name);
}

/**
 * Tags an integer sample without converting its exact decimal digits to a JavaScript number.
 *
 * @param digits Decimal integer text, including a leading minus sign for negative literals.
 * @returns JSON-safe descriptor materialized as a bigint in the compiled preview or hook fallback.
 */
function createBigIntValue(digits: string): PreviewTypedValue {
  return { [PREVIEW_TYPED_VALUE_TAG]: 'bigint', value: digits };
}

/** Derives an item name from a collection name for semantic samples (`rows` → `row`). */
function singularName(name: string): string {
  return name.endsWith('ies')
    ? `${name.slice(0, -3)}y`
    : name.endsWith('s')
      ? name.slice(0, -1)
      : name;
}

/**
 * Gives list item `index` its own dates and identities, as the browser's generated lists do:
 * canonical sample dates step back `index` days (forward when `direction` is -1, for future-named
 * lists; the sample-date API maps them to the current day minus `index * direction`), and id,
 * email, and name-like text gets the item number. Item 0 is unchanged.
 */
function varyPreviewTypedListItem(
  value: PreviewTypedValue,
  index: number,
  fieldName: string,
  direction = 1,
): PreviewTypedValue {
  if (index === 0) return value;
  if (typeof value === 'string') {
    return varyPreviewTypedListText(value, index, fieldName, direction);
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return (value as readonly PreviewTypedValue[]).map((item) =>
      varyPreviewTypedListItem(item, index, fieldName, direction),
    );
  }
  const record = value as Readonly<Record<string, PreviewTypedValue>>;
  const tag = record[PREVIEW_TYPED_VALUE_TAG];
  if (tag !== undefined) {
    return tag === 'date' && record.iso === PREVIEW_CANONICAL_SAMPLE_DATE_TIME
      ? { ...record, iso: createPreviewCanonicalSampleDateTime(index * direction) }
      : value;
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, child]) => [
      key,
      varyPreviewTypedListItem(child, index, key, direction),
    ]),
  );
}

/** Steps a canonical date back `index` days, or numbers identity-like text like generated lists. */
function varyPreviewTypedListText(
  value: string,
  index: number,
  fieldName: string,
  direction: number,
): string {
  if (value === PREVIEW_CANONICAL_SAMPLE_DATE) {
    return createPreviewCanonicalSampleDate(index * direction);
  }
  if (value === PREVIEW_CANONICAL_SAMPLE_DATE_TIME) {
    return createPreviewCanonicalSampleDateTime(index * direction);
  }
  for (const padded of [false, true]) {
    if (value === createPreviewCanonicalSampleMonthDay(0, padded)) {
      return createPreviewCanonicalSampleMonthDay(index * direction, padded);
    }
  }
  if (value.length === 0 || fieldName === '__typename') return value;
  const name = fieldName.replaceAll('_', '').toLowerCase();
  const suffix = String(index + 1);
  if (name === 'id' || name.endsWith('id') || name === 'uuid') return `${value}-${suffix}`;
  if (name.includes('email')) {
    const separator = value.indexOf('@');
    return separator > 0
      ? `${value.slice(0, separator)}+${suffix}${value.slice(separator)}`
      : `${value}-${suffix}`;
  }
  return /(?:name|label|title|subject|headline)$/u.test(name) ? `${value} ${suffix}` : value;
}

/** Words that make a list of dates run forward: SimSheet's `future` weeks W+1, W+2, W+3. */
const FUTURE_LIST_WORDS = new Set([
  'due',
  'forecast',
  'forecasts',
  'future',
  'next',
  'planned',
  'scheduled',
  'upcoming',
]);

/** Matches `future`, `upcomingDates`, `next_weeks`, `dueDates` by word (not `nextraLog`). */
function isFutureListName(name: string): boolean {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .some((word) => FUTURE_LIST_WORDS.has(word));
}
