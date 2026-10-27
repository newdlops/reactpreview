/** Finds exported and local React component declarations and prop type annotations. */
import ts from 'typescript';
import {
  MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH,
  type ComponentFunctionCandidate,
  type ExportedComponentFunction,
  type LocalComponentDeclaration,
  type LocalObjectType,
} from './reactPropInferenceModel';
import {
  hasDefaultModifier,
  hasExportModifier,
  readPropertyName,
  unwrapExpression,
} from './reactPropInferenceSyntax';

/** Collects direct/default/local-clause exports while statically following same-file HOC inputs. */
export function collectExportedComponentFunctions(
  sourceFile: ts.SourceFile,
): readonly ExportedComponentFunction[] {
  const localDeclarations = collectLocalComponentDeclarations(sourceFile);
  const selected: ExportedComponentFunction[] = [];
  const seenNames = new Set<string>();
  const add = (exportName: string, candidate: ComponentFunctionCandidate | undefined): void => {
    if (
      candidate === undefined ||
      seenNames.has(exportName) ||
      (exportName !== 'default' && !/^\p{Lu}/u.test(exportName))
    )
      return;
    seenNames.add(exportName);
    selected.push({ exportName, ...candidate });
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const candidate = { functionLike: statement };
      if (hasExportModifier(statement)) {
        add(hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''), candidate);
      }
    } else if (ts.isClassDeclaration(statement)) {
      if (hasExportModifier(statement)) {
        add(
          hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''),
          resolveClassComponent(statement),
        );
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const candidate = resolveLocalComponent(declaration.name.text, localDeclarations);
        if (hasExportModifier(statement)) add(declaration.name.text, candidate);
      }
    } else if (ts.isExportAssignment(statement)) {
      add('default', resolveComponentExpression(statement.expression, localDeclarations));
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const localName = (element.propertyName ?? element.name).text;
        add(element.name.text, resolveLocalComponent(localName, localDeclarations));
      }
    }
  }
  return selected;
}

/** Indexes unique top-level declarations without resolving imports or evaluating initializers. */
export function collectLocalComponentDeclarations(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalComponentDeclaration> {
  const declarations = new Map<string, LocalComponentDeclaration>();
  const ambiguous = new Set<string>();
  const add = (name: string, declaration: LocalComponentDeclaration): void => {
    if (ambiguous.has(name)) return;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else declarations.set(name, declaration);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      add(statement.name.text, { functionLike: statement });
    } else if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      const candidate = resolveClassComponent(statement);
      if (candidate !== undefined) add(statement.name.text, candidate);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const contextualPropsType = readReactComponentPropsType(declaration.type);
        add(declaration.name.text, {
          expression: declaration.initializer,
          ...(contextualPropsType === undefined ? {} : { contextualPropsType }),
        });
      }
    }
  }
  return declarations;
}

/** Extracts the props argument from common `FC<Props>` variable annotations. */
export function readReactComponentPropsType(
  typeNode: ts.TypeNode | undefined,
): ts.TypeNode | undefined {
  if (typeNode === undefined || !ts.isTypeReferenceNode(typeNode)) return undefined;
  const typeName = ts.isIdentifier(typeNode.typeName)
    ? typeNode.typeName.text
    : typeNode.typeName.right.text;
  return /^(?:FC|FunctionComponent|VFC|VoidFunctionComponent)$/u.test(typeName)
    ? typeNode.typeArguments?.[0]
    : undefined;
}

/** Resolves one unique same-file declaration through bounded HOC/alias chains; cycles fail closed. */
export function resolveLocalComponent(
  name: string,
  declarations: ReadonlyMap<string, LocalComponentDeclaration>,
  activeNames: Set<string> = new Set<string>(),
  depth = 0,
): ComponentFunctionCandidate | undefined {
  if (depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH || activeNames.has(name)) return undefined;
  const declaration = declarations.get(name);
  if (declaration === undefined) return undefined;
  activeNames.add(name);
  const candidate = declaration.functionLike
    ? {
        functionLike: declaration.functionLike,
        ...(declaration.classComponentProps === true ? { classComponentProps: true as const } : {}),
      }
    : resolveComponentExpression(declaration.expression, declarations, activeNames, depth + 1);
  activeNames.delete(name);
  return candidate === undefined
    ? undefined
    : {
        ...candidate,
        ...(declaration.contextualPropsType === undefined
          ? {}
          : { contextualPropsType: declaration.contextualPropsType }),
      };
}

/** Reads direct functions or local component arguments from nested common React HOC syntax. */
export function resolveComponentExpression(
  expression: ts.Expression | undefined,
  declarations: ReadonlyMap<string, LocalComponentDeclaration>,
  activeNames: Set<string> = new Set<string>(),
  depth = 0,
): ComponentFunctionCandidate | undefined {
  if (expression === undefined || depth > MAX_LOCAL_COMPONENT_RESOLUTION_DEPTH) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return { functionLike: current };
  }
  if (ts.isClassExpression(current)) return resolveClassComponent(current);
  if (ts.isIdentifier(current)) {
    return resolveLocalComponent(current.text, declarations, activeNames, depth + 1);
  }
  const call = ts.isTaggedTemplateExpression(current) ? unwrapExpression(current.tag) : current;
  if (!ts.isCallExpression(call) || call.arguments.length === 0) return undefined;
  for (const argument of call.arguments) {
    const candidate = unwrapExpression(argument);
    if (ts.isArrowFunction(candidate) || ts.isFunctionExpression(candidate)) {
      return { functionLike: candidate };
    }
  }
  for (const argument of call.arguments) {
    const candidate = resolveComponentExpression(argument, declarations, activeNames, depth + 1);
    if (candidate !== undefined) return candidate;
  }
  return undefined;
}

/** Resolves one unambiguous instance render method without executing the class or its base. */
export function resolveClassComponent(
  declaration: ts.ClassDeclaration | ts.ClassExpression,
): ComponentFunctionCandidate | undefined {
  const renderMethods = declaration.members.filter(
    (member): member is ts.MethodDeclaration =>
      ts.isMethodDeclaration(member) &&
      member.body !== undefined &&
      readPropertyName(member.name) === 'render' &&
      !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
  );
  const renderMethod = renderMethods[0];
  return renderMethods.length === 1 && renderMethod !== undefined
    ? { classComponentProps: true, functionLike: renderMethod }
    : undefined;
}

/** Indexes unique non-generic same-file type/interface declarations. */
export function collectLocalObjectTypes(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, LocalObjectType> {
  const declarations = new Map<string, LocalObjectType>();
  const ambiguous = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue;
    const name = statement.name.text;
    if (declarations.has(name)) {
      declarations.delete(name);
      ambiguous.add(name);
    } else if (!ambiguous.has(name)) {
      declarations.set(name, statement);
    }
  }
  return declarations;
}
