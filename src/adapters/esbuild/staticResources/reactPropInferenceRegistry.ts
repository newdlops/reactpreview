/** Reads primitive discriminants from static imported registries without evaluating modules. */
import ts from 'typescript';
import { readPreviewAnalysisSourceFile } from '../previewAnalysisSourceFile';
import {
  MAX_STATIC_REGISTRY_HINTS,
  MAX_STATIC_REGISTRY_SOURCE_BYTES,
  type PreviewPropInferenceOptions,
  type PreviewStaticRegistryImportBinding,
  type PreviewStaticRegistryKey,
  type PreviewStaticRegistryModule,
} from './reactPropInferenceModel';
import { hasParseDiagnostics, readScriptKind, unwrapExpression } from './reactPropInferenceSyntax';

/**
 * Recovers one accepted discriminator from a statically indexed label/renderer registry.
 *
 * A component that renders `StatusCopy[status]` proves that `status` must be one of the registry's
 * keys. Generic name semantics would otherwise generate `"PREVIEW"`, which is structurally valid
 * but rejected by every authored status branch. Only direct local/named-import object bindings and
 * primitive object keys participate; calls, getters, spreads, and transitive imports stay opaque.
 */
export function collectStaticRegistryDiscriminantHints(
  sourceFile: ts.SourceFile,
  sourcePath: string,
  options: PreviewPropInferenceOptions,
): ReadonlyMap<string, PreviewStaticRegistryKey> {
  const localModule = collectStaticRegistryModule(sourceFile);
  const imports = collectStaticRegistryImports(sourceFile);
  const resolvedKeys = new Map<string, PreviewStaticRegistryKey | undefined>();
  const hints = new Map<string, PreviewStaticRegistryKey>();
  const readRegistryKey = (bindingName: string): PreviewStaticRegistryKey | undefined => {
    if (resolvedKeys.has(bindingName)) return resolvedKeys.get(bindingName);
    let key = readStaticRegistryObjectFirstKey(localModule.objects.get(bindingName), localModule);
    const imported = imports.get(bindingName);
    if (key === undefined && imported !== undefined && options.resolveImport !== undefined) {
      const resolved = options.resolveImport(imported.moduleSpecifier, sourcePath);
      if (
        resolved !== undefined &&
        Buffer.byteLength(resolved.sourceText, 'utf8') <= MAX_STATIC_REGISTRY_SOURCE_BYTES
      ) {
        const importedFile = readPreviewAnalysisSourceFile(
          resolved.sourcePath,
          resolved.sourceText,
          readScriptKind(resolved.sourcePath),
        );
        if (!hasParseDiagnostics(importedFile)) {
          const importedModule = collectStaticRegistryModule(importedFile);
          key = readStaticRegistryObjectFirstKey(
            importedModule.objects.get(imported.importedName),
            importedModule,
          );
        }
      }
    }
    resolvedKeys.set(bindingName, key);
    return key;
  };
  const visit = (node: ts.Node): void => {
    if (hints.size >= MAX_STATIC_REGISTRY_HINTS) return;
    if (ts.isElementAccessExpression(node)) {
      const registry = unwrapExpression(node.expression);
      const discriminant = unwrapExpression(node.argumentExpression);
      const discriminantName = ts.isIdentifier(discriminant)
        ? discriminant.text
        : ts.isPropertyAccessExpression(discriminant)
          ? discriminant.name.text
          : undefined;
      if (
        ts.isIdentifier(registry) &&
        discriminantName !== undefined &&
        !hints.has(discriminantName)
      ) {
        const key = readRegistryKey(registry.text);
        if (key !== undefined) hints.set(discriminantName, key);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hints;
}

/** Indexes only top-level immutable-looking declarations used by one static registry read. */
export function collectStaticRegistryModule(
  sourceFile: ts.SourceFile,
): PreviewStaticRegistryModule {
  const enums = new Map<string, ts.EnumDeclaration>();
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const values = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (ts.isEnumDeclaration(statement)) {
      enums.set(statement.name.text, statement);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.initializer === undefined) continue;
      const initializer = unwrapExpression(declaration.initializer);
      values.set(declaration.name.text, initializer);
      if (ts.isObjectLiteralExpression(initializer)) {
        objects.set(declaration.name.text, initializer);
      }
    }
  }
  return { enums, objects, values };
}

/** Maps direct named imports to their source binding without evaluating either module. */
export function collectStaticRegistryImports(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewStaticRegistryImportBinding> {
  const imports = new Map<string, PreviewStaticRegistryImportBinding>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      statement.importClause?.namedBindings === undefined ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      imports.set(element.name.text, {
        importedName: element.propertyName?.text ?? element.name.text,
        moduleSpecifier: statement.moduleSpecifier.text,
      });
    }
  }
  return imports;
}

/** Reads the first primitive object key under a fixed recursive expression budget. */
export function readStaticRegistryObjectFirstKey(
  object: ts.ObjectLiteralExpression | undefined,
  module: PreviewStaticRegistryModule,
): PreviewStaticRegistryKey | undefined {
  if (object === undefined) return undefined;
  const budget = { nodes: 0 };
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) continue;
    const key = readStaticRegistryPropertyKey(property.name, module, budget);
    if (key !== undefined) return key;
  }
  return undefined;
}

/** Resolves an ordinary or computed object property name to its runtime primitive key. */
export function readStaticRegistryPropertyKey(
  name: ts.PropertyName | undefined,
  module: PreviewStaticRegistryModule,
  budget: { nodes: number },
): PreviewStaticRegistryKey | undefined {
  if (name === undefined) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isNumericLiteral(name)) return Number(name.text);
  return ts.isComputedPropertyName(name)
    ? readStaticRegistryPrimitive(name.expression, module, budget)
    : undefined;
}

/** Resolves literals and same-module constant/enum member reads without executing project code. */
export function readStaticRegistryPrimitive(
  expression: ts.Expression,
  module: PreviewStaticRegistryModule,
  budget: { nodes: number },
): PreviewStaticRegistryKey | undefined {
  if (budget.nodes >= 64) return undefined;
  budget.nodes += 1;
  const current = unwrapExpression(expression);
  if (ts.isStringLiteralLike(current)) return current.text;
  if (ts.isNumericLiteral(current)) return Number(current.text);
  if (current.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (current.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(current) &&
    current.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(unwrapExpression(current.operand))
  ) {
    return -Number(unwrapExpression(current.operand).getText());
  }
  if (ts.isIdentifier(current)) {
    const value = module.values.get(current.text);
    return value === undefined ? undefined : readStaticRegistryPrimitive(value, module, budget);
  }
  const member = readStaticRegistryMemberAccess(current);
  if (member === undefined) return undefined;
  const object = module.objects.get(member.ownerName);
  if (object !== undefined) {
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        continue;
      }
      const key = readStaticRegistryPropertyKey(property.name, module, budget);
      if (String(key) !== member.memberName) continue;
      const value = ts.isPropertyAssignment(property)
        ? property.initializer
        : module.values.get(property.name.text);
      return value === undefined ? undefined : readStaticRegistryPrimitive(value, module, budget);
    }
  }
  const declaration = module.enums.get(member.ownerName);
  const enumMember = declaration?.members.find(
    (candidate) =>
      readStaticRegistryPropertyKey(candidate.name, module, budget) === member.memberName,
  );
  return enumMember?.initializer === undefined
    ? undefined
    : readStaticRegistryPrimitive(enumMember.initializer, module, budget);
}

/** Reads `Registry.KEY` and `Registry['KEY']` without following arbitrary access chains. */
export function readStaticRegistryMemberAccess(
  expression: ts.Expression,
): { readonly memberName: string; readonly ownerName: string } | undefined {
  if (ts.isPropertyAccessExpression(expression)) {
    const owner = unwrapExpression(expression.expression);
    return ts.isIdentifier(owner)
      ? { memberName: expression.name.text, ownerName: owner.text }
      : undefined;
  }
  if (ts.isElementAccessExpression(expression)) {
    const owner = unwrapExpression(expression.expression);
    const member = unwrapExpression(expression.argumentExpression);
    return ts.isIdentifier(owner) && (ts.isStringLiteralLike(member) || ts.isNumericLiteral(member))
      ? { memberName: member.text, ownerName: owner.text }
      : undefined;
  }
  return undefined;
}
