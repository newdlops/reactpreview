/**
 * Instruments backend-bound browser requests for React Page Inspector.
 *
 * The transform is deliberately narrow: it rewrites the global `fetch` binding and methods on an
 * exact `axios` import only. Arbitrary project clients are left untouched because replacing an
 * unrelated `get()` method would change application semantics. TypeScript response annotations are
 * converted into a bounded, serializable shape that the browser runtime can use without a backend.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import ts from 'typescript';

const MAX_DATA_REQUESTS_PER_MODULE = 64;
const MAX_SHAPE_DEPTH = 8;
const MAX_SHAPE_FIELDS = 128;
const PREVIEW_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

/** JSON-safe type evidence consumed by the preview payload generator. */
export type PreviewDataShape =
  | { readonly kind: 'array'; readonly items: PreviewDataShape }
  | { readonly fields: Readonly<Record<string, PreviewDataShape>>; readonly kind: 'object' }
  | { readonly kind: 'boolean' | 'null' | 'number' | 'string' | 'unknown' };

/** One source edit replacing a proven backend request with the no-network Inspector adapter. */
interface PreviewDataRequestReplacement {
  /** Exclusive source offset after the original call. */
  readonly end: number;
  /** Browser expression preserving authored argument evaluation order. */
  readonly replacement: string;
  /** Inclusive source offset of the original call. */
  readonly start: number;
}

/** Serializable request metadata shown beside its generated payload. */
interface PreviewDataRequestMetadata {
  /** One-based source column. */
  readonly column: number;
  /** Human-readable inference provenance. */
  readonly evidence: string;
  /** Stable identity when the endpoint is a literal. */
  readonly id?: string;
  /** Request family understood by the browser boundary. */
  readonly kind: 'rest';
  /** One-based source line. */
  readonly line: number;
  /** Uppercase HTTP method. */
  readonly method: string;
  /** Authored function or component that directly initiated the request. */
  readonly ownerName?: string;
  /** Inferred payload type tree. */
  readonly shape: PreviewDataShape;
  /** Absolute source identity retained inside the local webview. */
  readonly sourcePath: string;
  /** Literal endpoint when statically available. */
  readonly url?: string;
}

/** Mutable analyzer budget shared while resolving recursive local type declarations. */
interface PreviewDataShapeBudget {
  /** Number of object properties already emitted. */
  fields: number;
}

/** Local declarations and imported axios bindings proven by one syntax tree. */
interface PreviewDataSourceInventory {
  /** Exact local identifiers whose module specifier is `axios`. */
  readonly axiosBindings: ReadonlySet<string>;
  /** Whether an authored top-level declaration shadows the browser global. */
  readonly fetchIsShadowed: boolean;
  /** Local interfaces and aliases addressable without a TypeScript program. */
  readonly typeDeclarations: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>;
}

/**
 * Replaces backend calls with Inspector-owned static request functions.
 *
 * @param sourcePath Absolute workspace path used for diagnostics and stable identities.
 * @param sourceText Syntax-valid source after resource compatibility rewrites.
 * @returns Instrumented source, or the exact input when no supported request is reached.
 */
export function instrumentPreviewDataRequests(sourcePath: string, sourceText: string): string {
  if (!isJavaScriptLikeSource(sourcePath) || !mayContainBackendRequest(sourceText)) {
    return sourceText;
  }
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    selectScriptKind(sourcePath),
  );
  if (readParseDiagnostics(sourceFile).length > 0) {
    return sourceText;
  }

  const inventory = collectPreviewDataSourceInventory(sourceFile);
  const replacements: PreviewDataRequestReplacement[] = [];
  /** Visits calls in source order and stops at the per-module instrumentation bound. */
  function visit(node: ts.Node): void {
    if (replacements.length >= MAX_DATA_REQUESTS_PER_MODULE) return;
    if (ts.isCallExpression(node)) {
      const replacement = createPreviewDataRequestReplacement(
        node,
        sourceFile,
        sourcePath,
        inventory,
      );
      if (replacement !== undefined) replacements.push(replacement);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return applyPreviewDataRequestReplacements(sourceText, replacements);
}

/** Collects exact axios imports, local types, and a conservative global-fetch shadowing signal. */
function collectPreviewDataSourceInventory(sourceFile: ts.SourceFile): PreviewDataSourceInventory {
  const axiosBindings = new Set<string>();
  const typeDeclarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
  let fetchIsShadowed = false;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      const clause = statement.importClause;
      if (moduleName === 'axios' && clause !== undefined) {
        if (clause.name !== undefined) axiosBindings.add(clause.name.text);
        if (clause.namedBindings !== undefined && ts.isNamespaceImport(clause.namedBindings)) {
          axiosBindings.add(clause.namedBindings.name.text);
        }
        if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if ((element.propertyName?.text ?? element.name.text) === 'default') {
              axiosBindings.add(element.name.text);
            }
          }
        }
      }
      if (clause?.name?.text === 'fetch') fetchIsShadowed = true;
      if (
        clause?.namedBindings !== undefined &&
        ts.isNamedImports(clause.namedBindings) &&
        clause.namedBindings.elements.some((element) => element.name.text === 'fetch')
      ) {
        fetchIsShadowed = true;
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      typeDeclarations.set(statement.name.text, statement);
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer !== undefined &&
          isAxiosCreateCall(declaration.initializer, axiosBindings)
        ) {
          axiosBindings.add(declaration.name.text);
        }
      }
    }
    if (declaresTopLevelName(statement, 'fetch')) fetchIsShadowed = true;
  }
  /** Conservatively skips all global-fetch rewrites when any nested scope declares that name. */
  function visitBindings(node: ts.Node): void {
    if (
      (ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) &&
      bindingNameContains(node.name, 'fetch')
    ) {
      fetchIsShadowed = true;
    }
    ts.forEachChild(node, visitBindings);
  }
  visitBindings(sourceFile);
  return { axiosBindings, fetchIsShadowed, typeDeclarations };
}

/** Recognizes a same-module Axios instance created from an exact imported Axios binding. */
function isAxiosCreateCall(expression: ts.Expression, axiosBindings: ReadonlySet<string>): boolean {
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    expression.expression.name.text === 'create' &&
    ts.isIdentifier(expression.expression.expression) &&
    axiosBindings.has(expression.expression.expression.text)
  );
}

/** Creates a no-network wrapper for a direct global fetch or exact axios method call. */
function createPreviewDataRequestReplacement(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  inventory: PreviewDataSourceInventory,
): PreviewDataRequestReplacement | undefined {
  if (
    !inventory.fetchIsShadowed &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'fetch' &&
    call.arguments.length >= 1 &&
    call.arguments.length <= 2
  ) {
    const responseType = findFetchResponseType(call);
    const fetchMethod = readStaticFetchMethod(call.arguments[1]);
    const metadata = createRequestMetadata(
      call,
      sourceFile,
      sourcePath,
      fetchMethod ?? 'GET',
      call.arguments[0],
      responseType,
      inventory,
      call.arguments[1] === undefined || fetchMethod !== undefined,
    );
    const argumentsText = call.arguments.map((argument) => argument.getText(sourceFile));
    return {
      end: call.end,
      replacement: `${createInspectorApiExpression()}.previewFetch(${argumentsText[0] ?? 'undefined'}, ${argumentsText[1] ?? 'undefined'}, ${JSON.stringify(metadata)})`,
      start: call.getStart(sourceFile),
    };
  }

  const axiosCall = readAxiosMethodCall(call, inventory.axiosBindings);
  if (axiosCall === undefined) return undefined;
  const metadata = createRequestMetadata(
    call,
    sourceFile,
    sourcePath,
    axiosCall.method,
    call.arguments[0],
    call.typeArguments?.[0],
    inventory,
  );
  const argumentsText = call.arguments.map((argument) => argument.getText(sourceFile));
  return {
    end: call.end,
    replacement: `${createInspectorApiExpression()}.previewAxiosRequest(${JSON.stringify(axiosCall.method)}, ${argumentsText[0] ?? 'undefined'}, [${argumentsText.slice(1).join(',')}], ${JSON.stringify(metadata)})`,
    start: call.getStart(sourceFile),
  };
}

/** Reads only methods on a binding imported directly from the exact `axios` package. */
function readAxiosMethodCall(
  call: ts.CallExpression,
  axiosBindings: ReadonlySet<string>,
): { readonly method: string } | undefined {
  if (!ts.isPropertyAccessExpression(call.expression)) return undefined;
  const receiver = call.expression.expression;
  const method = call.expression.name.text.toUpperCase();
  if (
    !ts.isIdentifier(receiver) ||
    !axiosBindings.has(receiver.text) ||
    !new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']).has(method)
  ) {
    return undefined;
  }
  return { method };
}

/** Builds source, endpoint, and inferred type evidence without evaluating request expressions. */
function createRequestMetadata(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  sourcePath: string,
  method: string,
  endpoint: ts.Expression | undefined,
  responseType: ts.TypeNode | undefined,
  inventory: PreviewDataSourceInventory,
  includeStaticIdentity = true,
): PreviewDataRequestMetadata {
  const location = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
  const url = endpoint === undefined ? undefined : readStaticEndpoint(endpoint);
  const shape =
    responseType === undefined
      ? ({ kind: 'unknown' } as const)
      : createPreviewDataShape(
          responseType,
          inventory.typeDeclarations,
          { fields: 0 },
          0,
          new Set(),
        );
  const evidence =
    responseType === undefined
      ? 'endpoint and field-name inference'
      : `TypeScript: ${boundEvidenceText(responseType.getText(sourceFile))}`;
  const ownerName = readPreviewDataRequestOwnerName(call);
  return {
    column: location.character + 1,
    evidence,
    ...(url === undefined
      ? {}
      : {
          ...(includeStaticIdentity ? { id: createRequestIdentity(sourcePath, method, url) } : {}),
          url,
        }),
    kind: 'rest',
    line: location.line + 1,
    method,
    ...(ownerName === undefined ? {} : { ownerName }),
    shape,
    sourcePath: path.normalize(sourcePath),
  };
}

/** Finds the nearest authored function so a request blocker can stay on its component path. */
function readPreviewDataRequestOwnerName(node: ts.Node): string | undefined {
  let current = node.parent;
  while (!ts.isSourceFile(current)) {
    if (
      ts.isArrowFunction(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isMethodDeclaration(current)
    ) {
      let candidate: string | undefined;
      if (
        (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) &&
        current.name !== undefined
      ) {
        candidate = current.name.text;
      }
      if (candidate === undefined && ts.isMethodDeclaration(current)) {
        candidate =
          ts.isIdentifier(current.name) || ts.isStringLiteral(current.name)
            ? current.name.text
            : undefined;
      }
      const parent = current.parent;
      if (
        candidate === undefined &&
        ts.isVariableDeclaration(parent) &&
        parent.initializer === current &&
        ts.isIdentifier(parent.name)
      ) {
        candidate = parent.name.text;
      }
      if (
        candidate === undefined &&
        ts.isPropertyAssignment(parent) &&
        parent.initializer === current
      ) {
        candidate =
          ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)
            ? parent.name.text
            : undefined;
      }
      if (candidate !== undefined) return candidate;
    }
    current = current.parent;
  }
  return undefined;
}

/** Reads a literal fetch `method` option; dynamic init objects defer identity to the browser. */
function readStaticFetchMethod(init: ts.Expression | undefined): string | undefined {
  if (init === undefined || !ts.isObjectLiteralExpression(init)) return undefined;
  for (const property of init.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      readSafePropertyName(property.name) === 'method' &&
      (ts.isStringLiteral(property.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(property.initializer))
    ) {
      return property.initializer.text.toUpperCase().slice(0, 16);
    }
  }
  return undefined;
}

/** Finds a response annotation attached to a JSON conversion in the fetch call's statement. */
function findFetchResponseType(call: ts.CallExpression): ts.TypeNode | undefined {
  let boundary: ts.Node = call;
  while (!ts.isStatement(boundary) && !ts.isSourceFile(boundary)) {
    boundary = boundary.parent;
  }
  let selected: ts.TypeNode | undefined;
  let responseBinding: string | undefined;
  let ancestor: ts.Node = call;
  while (!ts.isStatement(ancestor) && !ts.isSourceFile(ancestor)) {
    ancestor = ancestor.parent;
    if (
      ts.isVariableDeclaration(ancestor) &&
      ts.isIdentifier(ancestor.name) &&
      ancestor.initializer !== undefined
    ) {
      responseBinding = ancestor.name.text;
    }
  }
  /** Finds the nearest explicit type connected to a `.json()` conversion. */
  function visit(node: ts.Node): void {
    if (selected !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json'
    ) {
      selected = node.typeArguments?.[0] ?? readTypeFromWrappers(node);
      if (selected !== undefined) return;
    }
    ts.forEachChild(node, visit);
  }
  visit(boundary);
  if (selected !== undefined || responseBinding === undefined) return selected;
  let scope: ts.Node = boundary;
  while (!ts.isBlock(scope) && !ts.isSourceFile(scope)) {
    scope = scope.parent;
  }
  /** Follows a local response binding to a later `response.json()` type assertion. */
  function visitResponseBinding(node: ts.Node): void {
    if (selected !== undefined) return;
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === responseBinding
    ) {
      selected = node.typeArguments?.[0] ?? readTypeFromWrappers(node);
      return;
    }
    ts.forEachChild(node, visitResponseBinding);
  }
  visitResponseBinding(scope);
  return selected;
}

/** Reads an assertion or typed variable surrounding one response-producing expression. */
function readTypeFromWrappers(node: ts.Node): ts.TypeNode | undefined {
  let current = node;
  for (let depth = 0; depth < 8 && !ts.isSourceFile(current); depth += 1) {
    const parent = current.parent;
    if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) return parent.type;
    if (ts.isVariableDeclaration(parent) && parent.type !== undefined) return parent.type;
    if (ts.isStatement(parent)) return undefined;
    current = parent;
  }
  return undefined;
}

/** Converts a local TypeScript type into a finite JSON-oriented runtime descriptor. */
function createPreviewDataShape(
  typeNode: ts.TypeNode,
  declarations: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  budget: PreviewDataShapeBudget,
  depth: number,
  activeTypes: ReadonlySet<string>,
): PreviewDataShape {
  if (depth > MAX_SHAPE_DEPTH || budget.fields >= MAX_SHAPE_FIELDS) return { kind: 'unknown' };
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return { kind: 'string' };
  if (
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BigIntKeyword
  ) {
    return { kind: 'number' };
  }
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' };
  if (
    typeNode.kind === ts.SyntaxKind.NullKeyword ||
    typeNode.kind === ts.SyntaxKind.UndefinedKeyword ||
    typeNode.kind === ts.SyntaxKind.VoidKeyword
  ) {
    return { kind: 'null' };
  }
  if (ts.isArrayTypeNode(typeNode)) {
    return {
      items: createPreviewDataShape(
        typeNode.elementType,
        declarations,
        budget,
        depth + 1,
        activeTypes,
      ),
      kind: 'array',
    };
  }
  if (ts.isTupleTypeNode(typeNode)) {
    const first = typeNode.elements[0];
    return {
      items:
        first === undefined
          ? { kind: 'unknown' }
          : createPreviewDataShape(first, declarations, budget, depth + 1, activeTypes),
      kind: 'array',
    };
  }
  if (ts.isUnionTypeNode(typeNode)) {
    const preferred = typeNode.types.find(
      (candidate) =>
        ![
          ts.SyntaxKind.NullKeyword,
          ts.SyntaxKind.UndefinedKeyword,
          ts.SyntaxKind.VoidKeyword,
        ].includes(candidate.kind),
    );
    return preferred === undefined
      ? { kind: 'null' }
      : createPreviewDataShape(preferred, declarations, budget, depth + 1, activeTypes);
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    if (ts.isStringLiteral(typeNode.literal)) return { kind: 'string' };
    if (ts.isNumericLiteral(typeNode.literal)) return { kind: 'number' };
    if (
      typeNode.literal.kind === ts.SyntaxKind.TrueKeyword ||
      typeNode.literal.kind === ts.SyntaxKind.FalseKeyword
    ) {
      return { kind: 'boolean' };
    }
    return { kind: 'unknown' };
  }
  if (ts.isTypeLiteralNode(typeNode)) {
    return createObjectShape(typeNode.members, declarations, budget, depth, activeTypes);
  }
  if (ts.isTypeReferenceNode(typeNode) && ts.isIdentifier(typeNode.typeName)) {
    const name = typeNode.typeName.text;
    const firstArgument = typeNode.typeArguments?.[0];
    if (name === 'Array' || name === 'ReadonlyArray' || name === 'Set') {
      return {
        items:
          firstArgument === undefined
            ? { kind: 'unknown' }
            : createPreviewDataShape(firstArgument, declarations, budget, depth + 1, activeTypes),
        kind: 'array',
      };
    }
    if (['Promise', 'AxiosResponse', 'ApiResponse'].includes(name) && firstArgument !== undefined) {
      return createPreviewDataShape(firstArgument, declarations, budget, depth + 1, activeTypes);
    }
    const declaration = declarations.get(name);
    if (declaration !== undefined && !activeTypes.has(name)) {
      const nextActiveTypes = new Set(activeTypes).add(name);
      return ts.isInterfaceDeclaration(declaration)
        ? createObjectShape(declaration.members, declarations, budget, depth, nextActiveTypes)
        : createPreviewDataShape(
            declaration.type,
            declarations,
            budget,
            depth + 1,
            nextActiveTypes,
          );
    }
  }
  return { kind: 'unknown' };
}

/** Converts property signatures in an interface or type literal into safe object fields. */
function createObjectShape(
  members: ts.NodeArray<ts.TypeElement>,
  declarations: ReadonlyMap<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
  budget: PreviewDataShapeBudget,
  depth: number,
  activeTypes: ReadonlySet<string>,
): PreviewDataShape {
  const fields: Record<string, PreviewDataShape> = {};
  for (const member of members) {
    if (budget.fields >= MAX_SHAPE_FIELDS) break;
    if (!ts.isPropertySignature(member) || member.type === undefined) continue;
    const name = readSafePropertyName(member.name);
    if (name === undefined) continue;
    budget.fields += 1;
    fields[name] = createPreviewDataShape(
      member.type,
      declarations,
      budget,
      depth + 1,
      activeTypes,
    );
  }
  return { fields, kind: 'object' };
}

/** Reads only non-prototype identifier/string/numeric property names. */
function readSafePropertyName(name: ts.PropertyName): string | undefined {
  const value =
    ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
      ? name.text
      : undefined;
  return value === undefined || ['__proto__', 'constructor', 'prototype'].includes(value)
    ? undefined
    : value;
}

/** Reads an interpolation-free endpoint literal without evaluating expressions. */
function readStaticEndpoint(expression: ts.Expression): string | undefined {
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)
    ? expression.text.slice(0, 512)
    : undefined;
}

/** Creates a stable request key without embedding source paths into generated property names. */
function createRequestIdentity(sourcePath: string, method: string, url: string): string {
  return `request:${createHash('sha256')
    .update(JSON.stringify([path.normalize(sourcePath), method, url]))
    .digest('hex')
    .slice(0, 20)}`;
}

/** Returns the global Inspector API expression shared with conditional-render instrumentation. */
function createInspectorApiExpression(): string {
  return `globalThis[Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_API_SYMBOL)})]`;
}

/** Applies non-overlapping outer calls right-to-left so parser offsets remain stable. */
function applyPreviewDataRequestReplacements(
  sourceText: string,
  replacements: readonly PreviewDataRequestReplacement[],
): string {
  const selected = replacements.filter(
    (candidate) =>
      !replacements.some(
        (other) =>
          other !== candidate && other.start < candidate.start && other.end >= candidate.end,
      ),
  );
  let transformed = sourceText;
  for (const replacement of [...selected].sort((left, right) => right.start - left.start)) {
    transformed = `${transformed.slice(0, replacement.start)}${replacement.replacement}${transformed.slice(replacement.end)}`;
  }
  return transformed;
}

/** Reports whether one top-level statement declares a requested binding name. */
function declaresTopLevelName(statement: ts.Statement, name: string): boolean {
  if (
    (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
    statement.name?.text === name
  ) {
    return true;
  }
  if (!ts.isVariableStatement(statement)) return false;
  return statement.declarationList.declarations.some((declaration) =>
    bindingNameContains(declaration.name, name),
  );
}

/** Searches identifier and destructuring bindings without inspecting initializer expressions. */
function bindingNameContains(binding: ts.BindingName, name: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === name;
  return binding.elements.some(
    (element) => !ts.isOmittedExpression(element) && bindingNameContains(element.name, name),
  );
}

/** Selects parser grammar from the source extension. */
function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Restricts instrumentation to code formats handled by the preview compiler. */
function isJavaScriptLikeSource(sourcePath: string): boolean {
  return /\.(?:[cm]?[jt]sx?)$/iu.test(sourcePath);
}

/** Avoids a TypeScript parse for modules that cannot contain a supported request. */
function mayContainBackendRequest(sourceText: string): boolean {
  return sourceText.includes('fetch') || sourceText.includes('axios');
}

/** Reads parser-recovery diagnostics through TypeScript's intentionally non-public field. */
function readParseDiagnostics(sourceFile: ts.SourceFile): readonly ts.Diagnostic[] {
  return (
    (sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] })
      .parseDiagnostics ?? []
  );
}

/** Keeps displayed TypeScript evidence compact and single-line. */
function boundEvidenceText(value: string): string {
  return value.replace(/\s+/gu, ' ').slice(0, 180);
}
