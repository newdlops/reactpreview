/** Discovers unshadowed imported Context hooks and exact runtime candidates. */
import path from 'node:path';
import ts from 'typescript';
import {
  CONTEXT_HOOK_NAME_PATTERN,
  type ContextHookImports,
  type HookCandidate,
  MAX_CANDIDATES_PER_MODULE,
  type RuntimeFunction,
} from './reactContextFallbackModel';
import { isRuntimeFunction, unwrapExpression } from './reactContextFallbackSyntax';

/** Selects TypeScript parser grammar without loading or evaluating a project configuration. */
export function selectScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** Rejects declarations, dependencies, and non-runtime source extensions. */
export function isProjectRuntimeSource(sourcePath: string): boolean {
  const normalizedPath = sourcePath.replaceAll('\\', '/').toLowerCase();
  return (
    !normalizedPath.includes('/node_modules/') &&
    !normalizedPath.endsWith('.d.ts') &&
    /\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u.test(normalizedPath)
  );
}

/** Reads parser recovery diagnostics without invoking the TypeScript type checker. */
export function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return (diagnostics?.length ?? 0) > 0;
}

/** Collects value-capable direct and namespace imports with conventional Context-hook names. */
export function collectContextHookImports(sourceFile: ts.SourceFile): ContextHookImports {
  const direct = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.importClause?.phaseModifier !== undefined
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (
      importClause?.name !== undefined &&
      CONTEXT_HOOK_NAME_PATTERN.test(importClause.name.text)
    ) {
      direct.add(importClause.name.text);
    }
    const bindings = importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const importedName = element.propertyName?.text ?? element.name.text;
      if (CONTEXT_HOOK_NAME_PATTERN.test(importedName)) {
        direct.add(element.name.text);
      }
    }
  }
  return { direct, namespaces };
}

/**
 * Removes an imported binding when any non-import declaration shadows it in the module.
 * This intentionally accepts false negatives instead of implementing a complete lexical binder.
 */
export function removeShadowedHookImports(
  sourceFile: ts.SourceFile,
  imports: ContextHookImports,
): ContextHookImports {
  const candidates = new Set([...imports.direct, ...imports.namespaces]);
  const shadowed = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingNames(node.name, shadowed, candidates);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassDeclaration(node) ||
      ts.isClassExpression(node)
    ) {
      if (node.name !== undefined && candidates.has(node.name.text)) {
        shadowed.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    direct: new Set([...imports.direct].filter((name) => !shadowed.has(name))),
    namespaces: new Set([...imports.namespaces].filter((name) => !shadowed.has(name))),
  };
}

/** Recursively records identifiers from one binding pattern, optionally filtering candidates. */
export function collectBindingNames(
  name: ts.BindingName,
  destination: Set<string>,
  candidates?: ReadonlySet<string>,
): void {
  if (ts.isIdentifier(name)) {
    if (candidates === undefined || candidates.has(name.text)) destination.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      collectBindingNames(element.name, destination, candidates);
    }
  }
}

/** Finds imported hook calls nested inside runtime functions while rejecting optional invocation. */
export function collectHookCandidates(
  sourceFile: ts.SourceFile,
  imports: ContextHookImports,
): readonly HookCandidate[] {
  const candidates: HookCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (
      candidates.length < MAX_CANDIDATES_PER_MODULE &&
      ts.isCallExpression(node) &&
      node.questionDotToken === undefined &&
      isImportedContextHookCallee(node.expression, imports)
    ) {
      const owner = findNearestRuntimeFunction(node);
      if (owner !== undefined) candidates.push({ call: node, owner });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

/** Recognizes a direct imported hook or one conventional property of an imported namespace. */
export function isImportedContextHookCallee(
  expression: ts.Expression,
  imports: ContextHookImports,
): boolean {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) return imports.direct.has(callee.text);
  if (
    ts.isPropertyAccessExpression(callee) &&
    callee.questionDotToken === undefined &&
    CONTEXT_HOOK_NAME_PATTERN.test(callee.name.text)
  ) {
    const owner = unwrapExpression(callee.expression);
    return ts.isIdentifier(owner) && imports.namespaces.has(owner.text);
  }
  return false;
}

/** Locates the closest arrow or function body that safely defers fallback access until invocation. */
export function findNearestRuntimeFunction(node: ts.Node): RuntimeFunction | undefined {
  let current: ts.Node = node.parent;
  for (;;) {
    if (isRuntimeFunction(current)) return current;
    if (ts.isSourceFile(current)) return undefined;
    current = current.parent;
  }
}
