/**
 * Derives bounded preview-only defaults for required props of components exported by the target.
 * The analyzer is syntax-only and never evaluates application expressions. Its strongest generic
 * signal is a required prop used to index a module-scope record: the first real record key is a
 * valid domain value and is safer than inventing a project-specific enum member.
 */
import ts from 'typescript';
import { isReactComponentTypeSyntax } from './reactComponentTypeSyntax';

const MAX_FALLBACKS_PER_TARGET = 32;
const MAX_LITERAL_LENGTH = 2_048;
const BLOCKED_PROP_NAMES = new Set(['__proto__', 'constructor', 'key', 'prototype', 'ref']);

/** One insertion that adds a default initializer to an exported component's binding element. */
export interface ReactExportPropFallbackReplacement {
  /** Exclusive source offset after the binding identifier where the initializer is inserted. */
  readonly end: number;
  /** Human-readable prop name retained for tests and future runtime diagnostics. */
  readonly propName: string;
  /** Preview-only JavaScript expression evaluated only when the incoming prop is `undefined`. */
  readonly replacement: string;
  /** Inclusive insertion offset, equal to `end` for a zero-width source edit. */
  readonly start: number;
}

/** Function-like declaration whose first parameter may describe root component props. */
type ExportedFunctionLike = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression;

/** Same-module declaration that can describe an object-shaped props contract without semantics. */
type LocalPropsTypeDeclaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;

/**
 * Finds safe default initializers for the current target's directly exported React functions.
 *
 * Setup props and real parent props still win because JavaScript binding defaults run only when a
 * property is absent or explicitly `undefined`. Optional props, existing defaults, imported type
 * contracts, computed names, nested functions, and ambiguous declarations fail closed.
 *
 * @param sourcePath Absolute target path used to select the TypeScript or TSX parser grammar.
 * @param sourceText Unsaved editor snapshot analyzed without module resolution or execution.
 * @returns Ordered zero-width insertions suitable for the shared source rewrite pass.
 */
export function createReactExportPropFallbackReplacements(
  sourcePath: string,
  sourceText: string,
): readonly ReactExportPropFallbackReplacement[] {
  if (!isTypeScriptSource(sourcePath)) {
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

  const localTypes = collectLocalPropsTypes(sourceFile);
  const moduleValues = collectModuleValueBindings(sourceFile);
  const typedLiteralCandidates = collectTypedLiteralCandidates(sourceFile);
  const exportedFunctions = collectExportedFunctions(sourceFile);
  const replacements: ReactExportPropFallbackReplacement[] = [];

  for (const functionLike of exportedFunctions) {
    const parameter = functionLike.parameters[0];
    if (parameter === undefined || !ts.isObjectBindingPattern(parameter.name)) {
      continue;
    }
    const requiredPropTypes = collectRequiredPropTypes(parameter.type, localTypes);
    if (requiredPropTypes.size === 0) {
      continue;
    }
    const shadowedModuleValues = collectFunctionLocalBindings(functionLike);

    for (const element of parameter.name.elements) {
      if (
        replacements.length >= MAX_FALLBACKS_PER_TARGET ||
        element.dotDotDotToken !== undefined ||
        element.initializer !== undefined ||
        !ts.isIdentifier(element.name)
      ) {
        continue;
      }
      const propName = readBindingPropertyName(element);
      if (propName === undefined || BLOCKED_PROP_NAMES.has(propName)) {
        continue;
      }
      const propType = requiredPropTypes.get(propName);
      if (propType === undefined) {
        continue;
      }

      const recordBinding = findIndexedRecordBinding(
        functionLike,
        element.name.text,
        moduleValues,
        shadowedModuleValues,
      );
      const typedLiteral = typedLiteralCandidates.get(readTypeIdentity(propType, sourceFile));
      const fallbackExpression =
        typedLiteral ??
        (recordBinding === undefined ? undefined : `Object.keys(${recordBinding})[0]`) ??
        createNeutralPropExpression(propType, localTypes, new Set());
      if (fallbackExpression === undefined) {
        continue;
      }

      replacements.push({
        end: element.name.end,
        propName,
        replacement: ` = ${fallbackExpression}`,
        start: element.name.end,
      });
    }
  }

  return replacements.sort((left, right) => left.start - right.start);
}

/**
 * Indexes the first pure literal in a typed top-level array as a valid domain-value candidate.
 * A declaration such as `const PAGES: PageName[] = ['DashboardPage']` proves more than a neutral
 * empty string while still requiring no type checker, import traversal, or application execution.
 */
function collectTypedLiteralCandidates(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const candidates = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (
        declaration.type === undefined ||
        declaration.initializer === undefined ||
        !ts.isArrayLiteralExpression(declaration.initializer) ||
        declaration.initializer.elements.length === 0
      ) {
        continue;
      }
      const elementType = readArrayElementType(declaration.type);
      const firstElement = declaration.initializer.elements[0];
      if (
        elementType === undefined ||
        firstElement === undefined ||
        ts.isSpreadElement(firstElement)
      ) {
        continue;
      }
      const expression = readStaticLiteralExpression(firstElement);
      if (expression === undefined || expression.length > MAX_LITERAL_LENGTH) {
        continue;
      }
      const typeIdentity = readTypeIdentity(elementType, sourceFile);
      if (!candidates.has(typeIdentity)) {
        candidates.set(typeIdentity, expression);
      }
    }
  }
  return candidates;
}

/** Reads `T` from `T[]`, `Array<T>`, or `ReadonlyArray<T>` without resolving aliases. */
function readArrayElementType(typeNode: ts.TypeNode): ts.TypeNode | undefined {
  if (ts.isArrayTypeNode(typeNode)) {
    return typeNode.elementType;
  }
  if (
    ts.isTypeReferenceNode(typeNode) &&
    ts.isIdentifier(typeNode.typeName) &&
    (typeNode.typeName.text === 'Array' || typeNode.typeName.text === 'ReadonlyArray') &&
    typeNode.typeArguments?.length === 1
  ) {
    return typeNode.typeArguments[0];
  }
  return undefined;
}

/** Creates a stable syntax identity for two type nodes parsed from the same target module. */
function readTypeIdentity(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): string {
  return typeNode.getText(sourceFile).replace(/\s+/gu, '');
}

/** Serializes one pure array element and rejects identifiers, calls, objects, and spread values. */
function readStaticLiteralExpression(expression: ts.Expression): string | undefined {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return JSON.stringify(expression.text);
  }
  if (ts.isNumericLiteral(expression)) {
    return expression.text;
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword) {
    return 'true';
  }
  if (expression.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return `-${expression.operand.text}`;
  }
  return undefined;
}

/** Collects direct and aliased runtime exports while preserving each local function once. */
function collectExportedFunctions(sourceFile: ts.SourceFile): readonly ExportedFunctionLike[] {
  const functionByLocalName = new Map<string, ExportedFunctionLike>();
  const directlyExportedNames = new Set<string>();
  const clauseExportedNames = new Set<string>();
  const anonymousDefaults: ExportedFunctionLike[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      if (statement.name !== undefined) {
        functionByLocalName.set(statement.name.text, statement);
        if (hasExportModifier(statement) && isPreviewExportName(statement.name.text, statement)) {
          directlyExportedNames.add(statement.name.text);
        }
      } else if (hasDefaultExportModifiers(statement)) {
        anonymousDefaults.push(statement);
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      const exported = hasExportModifier(statement);
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          declaration.initializer === undefined ||
          (!ts.isArrowFunction(declaration.initializer) &&
            !ts.isFunctionExpression(declaration.initializer))
        ) {
          continue;
        }
        functionByLocalName.set(declaration.name.text, declaration.initializer);
        if (exported && isPascalCase(declaration.name.text)) {
          directlyExportedNames.add(declaration.name.text);
        }
      }
      continue;
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) {
          continue;
        }
        const exportedName = element.name.text;
        if (exportedName === 'default' || isPascalCase(exportedName)) {
          clauseExportedNames.add((element.propertyName ?? element.name).text);
        }
      }
      continue;
    }

    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        clauseExportedNames.add(statement.expression.text);
      } else if (
        ts.isArrowFunction(statement.expression) ||
        ts.isFunctionExpression(statement.expression)
      ) {
        anonymousDefaults.push(statement.expression);
      }
    }
  }

  const selected = new Set<ExportedFunctionLike>(anonymousDefaults);
  for (const localName of [...directlyExportedNames, ...clauseExportedNames]) {
    const functionLike = functionByLocalName.get(localName);
    if (functionLike !== undefined) {
      selected.add(functionLike);
    }
  }
  return [...selected];
}

/** Indexes unique, non-generic local object declarations used by explicit props annotations. */
function collectLocalPropsTypes(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalPropsTypeDeclaration> {
  const declarations = new Map<string, LocalPropsTypeDeclaration>();
  const ambiguousNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) {
      continue;
    }
    if (
      (statement.typeParameters?.length ?? 0) > 0 ||
      (ts.isInterfaceDeclaration(statement) && (statement.heritageClauses?.length ?? 0) > 0)
    ) {
      continue;
    }
    const name = statement.name.text;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguousNames.add(name);
    } else if (!ambiguousNames.has(name)) {
      declarations.set(name, statement);
    }
  }
  return declarations;
}

/** Resolves one inline or unambiguous same-file props object to its required property types. */
function collectRequiredPropTypes(
  typeNode: ts.TypeNode | undefined,
  localTypes: ReadonlyMap<string, LocalPropsTypeDeclaration>,
): ReadonlyMap<string, ts.TypeNode> {
  if (typeNode === undefined) {
    return new Map();
  }
  const resolvedType = unwrapLocalPropsType(typeNode, localTypes);
  const members = ts.isTypeLiteralNode(resolvedType)
    ? resolvedType.members
    : ts.isInterfaceDeclaration(resolvedType)
      ? resolvedType.members
      : undefined;
  if (members === undefined) {
    return new Map();
  }

  const properties = new Map<string, ts.TypeNode>();
  for (const member of members) {
    if (
      !ts.isPropertySignature(member) ||
      member.questionToken !== undefined ||
      member.type === undefined
    ) {
      continue;
    }
    const name = readPropertyName(member.name);
    if (name !== undefined && !properties.has(name)) {
      properties.set(name, member.type);
    }
  }
  return properties;
}

/** Resolves at most one local alias hop; imported, recursive, and composite references stay inert. */
function unwrapLocalPropsType(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalPropsTypeDeclaration>,
): ts.TypeNode | LocalPropsTypeDeclaration {
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return typeNode;
  }
  const declaration = localTypes.get(typeNode.typeName.text);
  if (declaration === undefined) {
    return typeNode;
  }
  return ts.isTypeAliasDeclaration(declaration) ? declaration.type : declaration;
}

/** Collects imported and declared module values that are safe to reference from parameter defaults. */
function collectModuleValueBindings(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const bindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause === undefined || clause.phaseModifier !== undefined) {
        continue;
      }
      if (clause.name !== undefined) {
        bindings.add(clause.name.text);
      }
      const namedBindings = clause.namedBindings;
      if (namedBindings !== undefined) {
        if (ts.isNamespaceImport(namedBindings)) {
          bindings.add(namedBindings.name.text);
        } else {
          for (const element of namedBindings.elements) {
            if (!element.isTypeOnly) {
              bindings.add(element.name.text);
            }
          }
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          bindings.add(declaration.name.text);
        }
      }
    }
  }
  return bindings;
}

/** Collects function-local declarations so a shadowed record is never referenced too early. */
function collectFunctionLocalBindings(functionLike: ExportedFunctionLike): ReadonlySet<string> {
  const bindings = new Set<string>();
  const body = functionLike.body;
  if (body === undefined) {
    return bindings;
  }

  /** Visits the component body but not callbacks whose lexical bindings belong to another scope. */
  const visit = (node: ts.Node): void => {
    if (node !== body && isFunctionLikeNode(node)) {
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      collectBindingIdentifiers(node.name, bindings);
    } else if (ts.isFunctionDeclaration(node) && node.name !== undefined) {
      bindings.add(node.name.text);
    } else if (ts.isClassDeclaration(node) && node.name !== undefined) {
      bindings.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return bindings;
}

/** Finds the first direct `record[prop]` use in the component's own lexical body. */
function findIndexedRecordBinding(
  functionLike: ExportedFunctionLike,
  localPropName: string,
  moduleValues: ReadonlySet<string>,
  shadowedModuleValues: ReadonlySet<string>,
): string | undefined {
  let selected: string | undefined;
  const body = functionLike.body;
  if (body === undefined) {
    return undefined;
  }

  /** Stops after the first source-ordered evidence and never attributes nested callback bindings. */
  const visit = (node: ts.Node): void => {
    if (selected !== undefined || (node !== body && isFunctionLikeNode(node))) {
      return;
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ts.isIdentifier(node.argumentExpression) &&
      node.argumentExpression.text === localPropName &&
      moduleValues.has(node.expression.text) &&
      !shadowedModuleValues.has(node.expression.text) &&
      node.expression.text !== localPropName
    ) {
      selected = node.expression.text;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return selected;
}

/** Creates small primitive defaults only when the annotated type is completely syntax-resolvable. */
function createNeutralPropExpression(
  typeNode: ts.TypeNode,
  localTypes: ReadonlyMap<string, LocalPropsTypeDeclaration>,
  activeTypeNames: Set<string>,
): string | undefined {
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return createNeutralPropExpression(typeNode.type, localTypes, activeTypeNames);
  }
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) {
    return "''";
  }
  if (
    typeNode.kind === ts.SyntaxKind.NumberKeyword ||
    typeNode.kind === ts.SyntaxKind.BigIntKeyword
  ) {
    return '0';
  }
  if (typeNode.kind === ts.SyntaxKind.BooleanKeyword) {
    return 'false';
  }
  if (ts.isArrayTypeNode(typeNode) || ts.isTupleTypeNode(typeNode)) {
    return '[]';
  }
  if (ts.isFunctionTypeNode(typeNode)) {
    return '() => undefined';
  }
  if (isReactComponentTypeSyntax(typeNode)) {
    return '() => null';
  }
  if (ts.isLiteralTypeNode(typeNode)) {
    return readLiteralExpression(typeNode.literal);
  }
  if (ts.isUnionTypeNode(typeNode)) {
    for (const member of typeNode.types) {
      if (
        member.kind === ts.SyntaxKind.UndefinedKeyword ||
        member.kind === ts.SyntaxKind.NullKeyword ||
        member.kind === ts.SyntaxKind.VoidKeyword
      ) {
        continue;
      }
      const expression = createNeutralPropExpression(member, localTypes, activeTypeNames);
      if (expression !== undefined) {
        return expression;
      }
    }
    return undefined;
  }
  if (!ts.isTypeReferenceNode(typeNode) || !ts.isIdentifier(typeNode.typeName)) {
    return undefined;
  }
  if (typeNode.typeName.text === 'Array' || typeNode.typeName.text === 'ReadonlyArray') {
    return '[]';
  }
  const declaration = localTypes.get(typeNode.typeName.text);
  if (
    declaration === undefined ||
    activeTypeNames.has(typeNode.typeName.text) ||
    !ts.isTypeAliasDeclaration(declaration)
  ) {
    return undefined;
  }
  activeTypeNames.add(typeNode.typeName.text);
  const expression = createNeutralPropExpression(declaration.type, localTypes, activeTypeNames);
  activeTypeNames.delete(typeNode.typeName.text);
  return expression;
}

/** Serializes only primitive type literals; template and expression-based literals are excluded. */
function readLiteralExpression(literal: ts.LiteralTypeNode['literal']): string | undefined {
  if (ts.isStringLiteral(literal)) {
    return JSON.stringify(literal.text);
  }
  if (ts.isNumericLiteral(literal)) {
    return literal.text;
  }
  if (literal.kind === ts.SyntaxKind.TrueKeyword) {
    return 'true';
  }
  if (literal.kind === ts.SyntaxKind.FalseKeyword) {
    return 'false';
  }
  if (
    ts.isPrefixUnaryExpression(literal) &&
    literal.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(literal.operand)
  ) {
    return `-${literal.operand.text}`;
  }
  return undefined;
}

/** Returns the external prop key for shorthand and renamed object binding elements. */
function readBindingPropertyName(element: ts.BindingElement): string | undefined {
  if (element.propertyName === undefined) {
    return ts.isIdentifier(element.name) ? element.name.text : undefined;
  }
  return readPropertyName(element.propertyName);
}

/** Reads non-computed identifier or literal property names without evaluating expressions. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;
}

/** Recursively records identifiers from a local binding pattern. */
function collectBindingIdentifiers(name: ts.BindingName, destination: Set<string>): void {
  if (ts.isIdentifier(name)) {
    destination.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingIdentifiers(element.name, destination);
    }
  }
}

/** Narrows nested callback and declaration nodes without relying on TypeScript-internal helpers. */
function isFunctionLikeNode(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

/** Reports a normal runtime export modifier on a declaration. */
function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
        false)
    : false;
}

/** Reports the paired `export default` modifiers used by anonymous function declarations. */
function hasDefaultExportModifiers(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) {
    return false;
  }
  const modifiers = ts.getModifiers(node) ?? [];
  return (
    modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
    modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
  );
}

/** Admits named gallery conventions and any declaration explicitly marked as the default export. */
function isPreviewExportName(name: string, node: ts.Node): boolean {
  return hasDefaultExportModifiers(node) || isPascalCase(name);
}

/** Mirrors the gallery's conservative PascalCase export convention. */
function isPascalCase(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}\u200C\u200D]*$/u.test(name);
}

/** Restricts source rewriting to TypeScript where required prop syntax is explicit and preserved. */
function isTypeScriptSource(sourcePath: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/iu.test(sourcePath);
}

/** Rejects parser recovery so insertion offsets never address an incomplete syntax tree. */
function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}
