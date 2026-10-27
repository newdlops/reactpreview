/** Indexes inert module declarations and bounded oversized type aliases. */
import ts from 'typescript';
import {
  BLOCKED_PROPERTY_NAMES,
  MAX_EXTRACTED_TYPE_CHARACTERS,
  type ComponentFunctionCandidate,
  type ExportedTypeBinding,
  type ImportedTypeBinding,
  type ParsedTypeDemandModule,
  type TypeDeclaration,
} from './previewRuntimeHookChildTypeModel';
import { collectPrimitivePropertyLiteralHints } from './previewRuntimeHookChildTypeShape';
import {
  hasDefaultModifier,
  hasExportModifier,
  readReactComponentPropsType,
  unwrapExpression,
  unwrapTypeNode,
} from './previewRuntimeHookChildTypeSyntax';

/** Extracts one top-level exported type alias without tokenizing an oversized generated module. */
export function extractOversizedTypeAlias(
  sourceText: string,
  typeName: string,
  requireExport: boolean,
): string | undefined {
  if (!/^[$A-Z_a-z][$\w]*$/u.test(typeName)) return undefined;
  const escapedName = typeName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const declarationPrefix = requireExport
    ? `export[\\t ]+(?:declare[\\t ]+)?type`
    : `(?:export[\\t ]+(?:declare[\\t ]+)?)?type`;
  const match = new RegExp(
    `(?:^|[\\r\\n])[\\t ]*${declarationPrefix}[\\t ]+${escapedName}(?=[\\t <=>\\r\\n])`,
    'mu',
  ).exec(sourceText);
  if (match?.index === undefined) return undefined;
  const declarationOffset = requireExport
    ? match[0].lastIndexOf('export')
    : match[0].search(/(?:export[\t ]+(?:declare[\t ]+)?)?type\b/u);
  const start = match.index + Math.max(0, declarationOffset);
  const limit = Math.min(sourceText.length, start + MAX_EXTRACTED_TYPE_CHARACTERS);
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let quote: "'" | '"' | '`' | undefined;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < limit; index += 1) {
    const character = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) {
      if (character === '\n' || character === '\r') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== undefined) {
      if (character === '\\') {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') braces += 1;
    else if (character === '}') braces = Math.max(0, braces - 1);
    else if (character === '[') brackets += 1;
    else if (character === ']') brackets = Math.max(0, brackets - 1);
    else if (character === '(') parentheses += 1;
    else if (character === ')') parentheses = Math.max(0, parentheses - 1);
    else if (character === ';' && braces === 0 && brackets === 0 && parentheses === 0) {
      return sourceText.slice(start, index + 1);
    }
  }
  return undefined;
}

/** Reads the literal key from `Type["field"]` without expanding unions or computed types. */
export function readStaticIndexedAccessTypeProperty(typeNode: ts.TypeNode): string | undefined {
  const current = unwrapTypeNode(typeNode);
  return ts.isLiteralTypeNode(current) && ts.isStringLiteralLike(current.literal)
    ? current.literal.text
    : undefined;
}

/** Reads the finite string-key set accepted by a built-in `Pick<T, Keys>` utility type. */
export function readStaticTypePropertyNames(
  typeNode: ts.TypeNode | undefined,
): readonly string[] | undefined {
  if (typeNode === undefined) return undefined;
  const current = unwrapTypeNode(typeNode);
  const members = ts.isUnionTypeNode(current) ? current.types : [current];
  const names: string[] = [];
  for (const member of members) {
    const propertyName = readStaticIndexedAccessTypeProperty(member);
    if (propertyName === undefined || BLOCKED_PROPERTY_NAMES.has(propertyName)) return undefined;
    names.push(propertyName);
  }
  return Object.freeze([...new Set(names)]);
}

/** Indexes type bindings, local component bodies, and exact export identities for one module. */
export function indexTypeDemandModule(
  sourcePath: string,
  file: ts.SourceFile,
): ParsedTypeDemandModule {
  const imports = new Map<string, ImportedTypeBinding>();
  const exports = new Map<string, ExportedTypeBinding>();
  const localTypes = new Map<string, TypeDeclaration>();
  const localFunctions = new Map<string, ComponentFunctionCandidate>();
  const literalHints = collectPrimitivePropertyLiteralHints(file);
  let starIndex = 0;
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const clause = statement.importClause;
      if (clause?.name !== undefined)
        imports.set(clause.name.text, {
          moduleSpecifier: statement.moduleSpecifier.text,
          sourceName: 'default',
        });
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          imports.set(element.name.text, {
            moduleSpecifier: statement.moduleSpecifier.text,
            sourceName: element.propertyName?.text ?? element.name.text,
          });
        }
      }
      continue;
    }
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      localTypes.set(statement.name.text, statement);
      if (hasExportModifier(statement))
        exports.set(hasDefaultModifier(statement) ? 'default' : statement.name.text, {
          localName: statement.name.text,
          sourceName: statement.name.text,
        });
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      localFunctions.set(statement.name.text, { functionLike: statement });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
        const contextualPropsType = readReactComponentPropsType(declaration.type);
        localFunctions.set(declaration.name.text, {
          ...(declaration.type === undefined ? {} : { contextualFunctionType: declaration.type }),
          ...(contextualPropsType === undefined ? {} : { contextualPropsType }),
          initializer: declaration.initializer,
        });
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      const expression = unwrapExpression(statement.expression);
      if (!statement.isExportEquals && ts.isIdentifier(expression)) {
        exports.set('default', {
          localName: expression.text,
          sourceName: expression.text,
        });
      }
      continue;
    }
    if (!ts.isExportDeclaration(statement)) continue;
    const moduleSpecifier =
      statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        exports.set(element.name.text, {
          ...(moduleSpecifier === undefined
            ? { localName: element.propertyName?.text ?? element.name.text }
            : { moduleSpecifier }),
          sourceName: element.propertyName?.text ?? element.name.text,
        });
      }
    } else if (moduleSpecifier !== undefined) {
      exports.set(`*:${starIndex.toString()}`, { moduleSpecifier, sourceName: '*' });
      starIndex += 1;
    }
  }
  return { exports, file, imports, literalHints, localFunctions, localTypes, sourcePath };
}

/** Enumerates direct/default/named component exports without executing HOC factories. */
export function collectExportedComponentCandidates(
  module: ParsedTypeDemandModule,
): ReadonlyMap<string, ComponentFunctionCandidate> {
  const result = new Map<string, ComponentFunctionCandidate>();
  for (const statement of module.file.statements) {
    if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement)) {
      result.set(hasDefaultModifier(statement) ? 'default' : (statement.name?.text ?? ''), {
        functionLike: statement,
      });
    } else if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const candidate = module.localFunctions.get(declaration.name.text);
        if (candidate !== undefined) result.set(declaration.name.text, candidate);
      }
    } else if (ts.isExportAssignment(statement)) {
      result.set('default', { initializer: statement.expression });
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        const candidate = module.localFunctions.get((element.propertyName ?? element.name).text);
        if (candidate !== undefined) result.set(element.name.text, candidate);
      }
    }
  }
  result.delete('');
  return result;
}

/** Finds the first component parameter type through cycle-safe same-file wrapper expressions. */
export function readComponentPropsType(
  candidate: ComponentFunctionCandidate,
  declarations: ReadonlyMap<string, ComponentFunctionCandidate>,
  activeNames: Set<string>,
): ts.TypeNode | undefined {
  if (candidate.contextualPropsType !== undefined) return candidate.contextualPropsType;
  const direct = candidate.functionLike?.parameters[0]?.type;
  if (direct !== undefined) return direct;
  const expression = candidate.initializer;
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) {
    return current.parameters[0]?.type;
  }
  if (ts.isIdentifier(current)) {
    if (activeNames.has(current.text)) return undefined;
    const next = declarations.get(current.text);
    if (next === undefined) return undefined;
    activeNames.add(current.text);
    const result = readComponentPropsType(next, declarations, activeNames);
    activeNames.delete(current.text);
    return result;
  }
  const call = ts.isTaggedTemplateExpression(current) ? unwrapExpression(current.tag) : current;
  if (!ts.isCallExpression(call)) return undefined;
  for (const argument of call.arguments) {
    const propsType = readComponentPropsType({ initializer: argument }, declarations, activeNames);
    if (propsType !== undefined) return propsType;
  }
  return undefined;
}

/** Resolves one ordinary function body through exact same-file value aliases. */
export function readRuntimeFunctionLike(
  candidate: ComponentFunctionCandidate,
  declarations: ReadonlyMap<string, ComponentFunctionCandidate>,
  activeNames: Set<string>,
): ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression | undefined {
  if (candidate.functionLike !== undefined) return candidate.functionLike;
  const expression = candidate.initializer;
  if (expression === undefined) return undefined;
  const current = unwrapExpression(expression);
  if (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) return current;
  if (!ts.isIdentifier(current) || activeNames.has(current.text)) return undefined;
  const next = declarations.get(current.text);
  if (next === undefined) return undefined;
  activeNames.add(current.text);
  const result = readRuntimeFunctionLike(next, declarations, activeNames);
  activeNames.delete(current.text);
  return result;
}
