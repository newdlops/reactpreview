/**
 * Derives preview-only React Context defaults from inline and same-module TypeScript structures.
 * The compatibility layer is deliberately narrow: it only replaces an explicit missing default on
 * `createContext` calls that are statically tied to a React import and whose complete neutral value
 * can be represented by a small, bounded expression without resolving imported application types.
 */
import ts from 'typescript';

const MAX_FALLBACKS_PER_MODULE = 64;
const MAX_GENERATED_LENGTH = 4_096;
const MAX_NESTED_TYPE_DEPTH = 8;
const MAX_STRUCTURAL_PROPERTIES = 64;

/** One argument replacement computed against the original, unmodified TypeScript module text. */
export interface ReactContextFallbackReplacement {
  /** Exclusive source offset after the missing context-default expression. */
  readonly end: number;
  /** Type-guided neutral expression, cast only inside the generated preview source. */
  readonly replacement: string;
  /** Inclusive source offset at the beginning of the context-default expression. */
  readonly start: number;
}

/** React import names that can be proven to refer to `createContext` without module resolution. */
interface ReactImportBindings {
  /** Named imports such as `createContext` or `createContext as makeContext`. */
  readonly direct: ReadonlySet<string>;
  /** Default or namespace imports used as `React.createContext`. */
  readonly objects: ReadonlySet<string>;
}

/** Mutable per-context limits shared across nested type-literal generation. */
interface NeutralValueBudget {
  /** Total object properties materialized for this one context default. */
  propertyCount: number;
}

/** Same-module non-generic declarations that can be expanded without TypeScript module resolution. */
type LocalTypeDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/** Immutable resolver state shared across one context fallback's recursive type traversal. */
interface NeutralValueContext {
  /** Declaration names currently being expanded, used to reject recursive structural cycles. */
  readonly activeTypeNames: Set<string>;
  /** Per-context property budget retained across aliases and nested objects. */
  readonly budget: NeutralValueBudget;
  /** Unique top-level declarations safe to resolve within the current source file. */
  readonly localTypes: ReadonlyMap<string, LocalTypeDeclaration>;
}

/**
 * Finds safe argument-level replacements for missing React Context defaults in project TypeScript.
 *
 * This function performs syntax-only analysis. It never resolves imports, evaluates initializers,
 * loads a project configuration, or invents values for imported application types. The caller can
 * add the returned ranges to a larger rewrite pass because every offset addresses `sourceText`.
 *
 * @param sourcePath Project-owned `.ts`, `.tsx`, `.mts`, or `.cts` file path.
 * @param sourceText Original module contents used to compute replacement offsets.
 * @returns Ordered, non-overlapping replacements for defaults that can be derived completely.
 */
export function createReactContextFallbackReplacements(
  sourcePath: string,
  sourceText: string,
): readonly ReactContextFallbackReplacement[] {
  if (!isProjectTypeScriptSource(sourcePath)) {
    return [];
  }

  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (hasParseDiagnostics(sourceFile)) {
    return [];
  }

  const importedBindings = collectReactImportBindings(sourceFile);
  if (importedBindings.direct.size === 0 && importedBindings.objects.size === 0) {
    return [];
  }

  const candidateNames = new Set([...importedBindings.direct, ...importedBindings.objects]);
  const shadowedNames = collectNonImportValueBindings(sourceFile, candidateNames);
  const bindings: ReactImportBindings = {
    direct: new Set([...importedBindings.direct].filter((name) => !shadowedNames.has(name))),
    objects: new Set([...importedBindings.objects].filter((name) => !shadowedNames.has(name))),
  };
  const localTypes = collectLocalTypeDeclarations(sourceFile);
  const replacements: ReactContextFallbackReplacement[] = [];

  /** Visits expressions after import and shadow classification has made callee checks inexpensive. */
  const visit = (node: ts.Node): void => {
    if (
      replacements.length < MAX_FALLBACKS_PER_MODULE &&
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined
    ) {
      const replacement = createCallReplacement(node, sourceFile, bindings, localTypes);
      if (replacement !== undefined) {
        replacements.push(replacement);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return replacements.sort((left, right) => left.start - right.start);
}

/** Creates one neutral replacement only when every part of the call is statically supported. */
function createCallReplacement(
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
  bindings: ReactImportBindings,
  localTypes: ReadonlyMap<string, LocalTypeDeclaration>,
): ReactContextFallbackReplacement | undefined {
  if (
    call.arguments.length !== 1 ||
    call.typeArguments?.length !== 1 ||
    !isReactCreateContextCallee(call.expression, bindings)
  ) {
    return undefined;
  }

  const argument = call.arguments[0];
  const contextType = call.typeArguments[0];
  if (argument === undefined || contextType === undefined || !isExplicitMissingValue(argument)) {
    return undefined;
  }

  const neutralValue = createNeutralValue(contextType, 0, {
    activeTypeNames: new Set(),
    budget: { propertyCount: 0 },
    localTypes,
  });
  if (
    neutralValue === undefined ||
    neutralValue === 'undefined' ||
    neutralValue.length > MAX_GENERATED_LENGTH
  ) {
    return undefined;
  }

  return {
    end: argument.end,
    replacement: `((${neutralValue}) as any)`,
    start: argument.getStart(sourceFile),
  };
}

/**
 * Indexes unique top-level aliases and interfaces whose expansion needs no generic substitution.
 * Declaration merging, generic declarations, and interface heritage are skipped because resolving
 * them correctly would require TypeScript semantic analysis outside this lightweight adapter.
 */
function collectLocalTypeDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalTypeDeclaration> {
  const declarations = new Map<string, LocalTypeDeclaration>();
  const ambiguousNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
      continue;
    }
    if ((statement.typeParameters?.length ?? 0) > 0) {
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) && (statement.heritageClauses?.length ?? 0) > 0) {
      continue;
    }
    const name = statement.name.text;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguousNames.add(name);
      continue;
    }
    if (!ambiguousNames.has(name)) {
      declarations.set(name, statement);
    }
  }
  return declarations;
}

/** Collects only value-capable React imports whose local binding shape is unambiguous. */
function collectReactImportBindings(sourceFile: ts.SourceFile): ReactImportBindings {
  const direct = new Set<string>();
  const objects = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== 'react'
    ) {
      continue;
    }

    const importClause = statement.importClause;
    if (importClause === undefined || importClause.phaseModifier !== undefined) {
      continue;
    }
    if (importClause.name !== undefined) {
      objects.add(importClause.name.text);
    }

    const namedBindings = importClause.namedBindings;
    if (namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      objects.add(namedBindings.name.text);
      continue;
    }

    for (const element of namedBindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === 'createContext') {
        direct.add(element.name.text);
      } else if (importedName === 'default') {
        objects.add(element.name.text);
      }
    }
  }

  return { direct, objects };
}

/**
 * Finds any non-import value declaration using a candidate import name.
 *
 * A complete lexical binder would add complexity and risk transforming a shadowed call. Skipping
 * all calls for a name shadowed anywhere in the module is a safe false negative for preview use.
 */
function collectNonImportValueBindings(
  sourceFile: ts.SourceFile,
  candidateNames: ReadonlySet<string>,
): ReadonlySet<string> {
  const shadowedNames = new Set<string>();

  /** Records declaration binding patterns while ignoring property keys and type-only declarations. */
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      return;
    }

    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingName(node.name, candidateNames, shadowedNames);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isImportEqualsDeclaration(node)
    ) {
      const name = node.name;
      if (name !== undefined && ts.isIdentifier(name) && candidateNames.has(name.text)) {
        shadowedNames.add(name.text);
      }
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      collectBindingName(node.variableDeclaration.name, candidateNames, shadowedNames);
    }

    ts.forEachChild(node, collect);
  };

  collect(sourceFile);
  return shadowedNames;
}

/** Recursively extracts value names from identifier, array, and object binding patterns. */
function collectBindingName(
  name: ts.BindingName,
  candidateNames: ReadonlySet<string>,
  destination: Set<string>,
): void {
  if (ts.isIdentifier(name)) {
    if (candidateNames.has(name.text)) {
      destination.add(name.text);
    }
    return;
  }

  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingName(element.name, candidateNames, destination);
    }
  }
}

/** Reports whether a callee is tied directly to one of the classified React import bindings. */
function isReactCreateContextCallee(
  expression: ts.Expression,
  bindings: ReactImportBindings,
): boolean {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) {
    return bindings.direct.has(callee.text);
  }
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    callee.name.text === 'createContext'
  ) {
    const owner = unwrapExpression(callee.expression);
    return ts.isIdentifier(owner) && bindings.objects.has(owner.text);
  }
  return false;
}

/** Accepts only explicit, side-effect-free missing defaults such as `undefined as any` or `void 0`. */
function isExplicitMissingValue(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return true;
  }
  if (ts.isIdentifier(unwrapped) && unwrapped.text === 'undefined') {
    return true;
  }
  if (ts.isVoidExpression(unwrapped)) {
    const operand = unwrapExpression(unwrapped.expression);
    return (
      (ts.isNumericLiteral(operand) && Number(operand.text) === 0) ||
      (ts.isIdentifier(operand) && operand.text === 'undefined')
    );
  }
  return false;
}

/** Removes syntax-only wrappers without evaluating or simplifying the wrapped expression. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * Converts a supported inline or same-module type node to a neutral runtime expression.
 * Imported, conditional, mapped, indexed, recursive, and executable types fail closed.
 */
function createNeutralValue(
  typeNode: ts.TypeNode,
  depth: number,
  context: NeutralValueContext,
): string | undefined {
  if (depth > MAX_NESTED_TYPE_DEPTH) {
    return undefined;
  }

  if (ts.isParenthesizedTypeNode(typeNode)) {
    return createNeutralValue(typeNode.type, depth + 1, context);
  }
  if (ts.isUnionTypeNode(typeNode)) {
    return createUnionNeutralValue(typeNode, depth, context);
  }
  if (ts.isTypeLiteralNode(typeNode)) {
    return createObjectNeutralValue(typeNode.members, depth, context);
  }
  if (ts.isFunctionTypeNode(typeNode)) {
    return '() => undefined';
  }
  if (ts.isArrayTypeNode(typeNode) || ts.isTupleTypeNode(typeNode)) {
    return '[]';
  }
  if (ts.isTypeReferenceNode(typeNode)) {
    return createReferenceNeutralValue(typeNode, depth, context);
  }
  if (ts.isTypeOperatorNode(typeNode) && typeNode.operator === ts.SyntaxKind.ReadonlyKeyword) {
    return createNeutralValue(typeNode.type, depth + 1, context);
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    return createLiteralNeutralValue(typeNode.literal);
  }

  switch (typeNode.kind) {
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.TemplateLiteralType:
      return "''";
    case ts.SyntaxKind.NumberKeyword:
      return '0';
    case ts.SyntaxKind.BigIntKeyword:
      return '0n';
    case ts.SyntaxKind.BooleanKeyword:
      return 'false';
    case ts.SyntaxKind.ObjectKeyword:
      return '{}';
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.NeverKeyword:
      return 'undefined';
    default:
      return undefined;
  }
}

/** Selects the first fully supported non-nullish branch while restoring budget on failed branches. */
function createUnionNeutralValue(
  typeNode: ts.UnionTypeNode,
  depth: number,
  context: NeutralValueContext,
): string | undefined {
  for (const member of typeNode.types) {
    if (isNullishType(member)) {
      continue;
    }
    const propertyCountBeforeBranch = context.budget.propertyCount;
    const neutralValue = createNeutralValue(member, depth + 1, context);
    if (neutralValue !== undefined && neutralValue !== 'undefined') {
      return neutralValue;
    }
    context.budget.propertyCount = propertyCountBeforeBranch;
  }
  return 'undefined';
}

/** Generates an object literal only when each runtime-visible property has a supported value. */
function createObjectNeutralValue(
  members: ts.NodeArray<ts.TypeElement>,
  depth: number,
  context: NeutralValueContext,
): string | undefined {
  const properties: string[] = [];

  for (const member of members) {
    if (ts.isIndexSignatureDeclaration(member)) {
      continue;
    }
    if (ts.isCallSignatureDeclaration(member) || ts.isConstructSignatureDeclaration(member)) {
      return undefined;
    }
    if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) {
      return undefined;
    }

    const propertyName = readStaticPropertyName(member.name);
    if (propertyName === undefined || context.budget.propertyCount >= MAX_STRUCTURAL_PROPERTIES) {
      return undefined;
    }
    context.budget.propertyCount += 1;

    const propertyValue = ts.isMethodSignature(member)
      ? '() => undefined'
      : member.type === undefined
        ? undefined
        : createNeutralValue(member.type, depth + 1, context);
    if (propertyValue === undefined) {
      return undefined;
    }
    properties.push(`${JSON.stringify(propertyName)}: ${propertyValue}`);
  }

  return `{ ${properties.join(', ')} }`;
}

/** Resolves safe global containers or one acyclic same-module structural declaration. */
function createReferenceNeutralValue(
  typeNode: ts.TypeReferenceNode,
  depth: number,
  context: NeutralValueContext,
): string | undefined {
  if (!ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }
  const typeArgumentCount = typeNode.typeArguments?.length ?? 0;
  if (
    (typeNode.typeName.text === 'Array' || typeNode.typeName.text === 'ReadonlyArray') &&
    typeArgumentCount === 1
  ) {
    return '[]';
  }
  if (typeNode.typeName.text === 'Record' && typeArgumentCount === 2) {
    return '{}';
  }
  if (typeArgumentCount > 0 || context.activeTypeNames.has(typeNode.typeName.text)) {
    return undefined;
  }
  const declaration = context.localTypes.get(typeNode.typeName.text);
  if (declaration === undefined) {
    return undefined;
  }

  const propertyCountBeforeReference = context.budget.propertyCount;
  context.activeTypeNames.add(typeNode.typeName.text);
  const neutralValue = ts.isTypeAliasDeclaration(declaration)
    ? createNeutralValue(declaration.type, depth + 1, context)
    : createObjectNeutralValue(declaration.members, depth + 1, context);
  context.activeTypeNames.delete(typeNode.typeName.text);
  if (neutralValue === undefined) {
    context.budget.propertyCount = propertyCountBeforeReference;
  }
  return neutralValue;
}

/** Maps primitive literal types to neutral values of the same runtime primitive category. */
function createLiteralNeutralValue(literal: ts.LiteralTypeNode['literal']): string | undefined {
  if (ts.isStringLiteral(literal)) {
    return "''";
  }
  if (ts.isNumericLiteral(literal) || ts.isPrefixUnaryExpression(literal)) {
    return '0';
  }
  if (ts.isBigIntLiteral(literal)) {
    return '0n';
  }
  if (literal.kind === ts.SyntaxKind.TrueKeyword || literal.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  if (literal.kind === ts.SyntaxKind.NullKeyword) {
    return 'undefined';
  }
  return undefined;
}

/** Reads identifier, quoted, and numeric property names without evaluating computed expressions. */
function readStaticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/** Reports whether a union member is syntactically nullish and should not be the fallback branch. */
function isNullishType(typeNode: ts.TypeNode): boolean {
  const node = ts.isParenthesizedTypeNode(typeNode) ? typeNode.type : typeNode;
  return (
    node.kind === ts.SyntaxKind.NullKeyword ||
    node.kind === ts.SyntaxKind.UndefinedKeyword ||
    node.kind === ts.SyntaxKind.VoidKeyword ||
    node.kind === ts.SyntaxKind.NeverKeyword
  );
}

/** Keeps the preview rewrite away from JavaScript, declaration output, and installed dependencies. */
function isProjectTypeScriptSource(sourcePath: string): boolean {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  return (
    !normalizedPath.includes('/node_modules/') &&
    !normalizedPath.endsWith('.d.ts') &&
    /\.(?:cts|mts|ts|tsx)$/u.test(normalizedPath)
  );
}

/** Treats parser recovery as unsupported so malformed source is never rewritten heuristically. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & {
      readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[];
    }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}
