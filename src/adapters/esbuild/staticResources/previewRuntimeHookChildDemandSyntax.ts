/** Reads lexical child bindings, module syntax, and parse validity. */
import ts from 'typescript';
import type { PreviewRuntimeFunction } from './previewRuntimeHookSyntax';

/** Detects a nested function parameter that replaces the analyzed hook-result identifier. */
export function functionShadowsName(
  scope: PreviewRuntimeFunction,
  identifierName: string,
): boolean {
  return scope.parameters.some((parameter) => bindingContainsName(parameter.name, identifierName));
}

/** Recursively checks one parameter pattern without evaluating authored defaults. */
export function bindingContainsName(binding: ts.BindingName, identifierName: string): boolean {
  if (ts.isIdentifier(binding)) return binding.text === identifierName;
  return binding.elements.some(
    (element) =>
      !ts.isOmittedExpression(element) && bindingContainsName(element.name, identifierName),
  );
}

/** Selects the parser grammar without trusting file contents. */
export function readScriptKind(sourcePath: string): ts.ScriptKind {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (lower.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts'))
    return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

/** Rejects TypeScript parser recovery before relying on source offsets or binding identities. */
export function hasParseDiagnostics(sourceFile: ts.SourceFile): boolean {
  const diagnostics = (
    sourceFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }
  ).parseDiagnostics;
  return diagnostics !== undefined && diagnostics.length > 0;
}

/** Mirrors React's conventional component identifier casing without guessing lowercase wrappers. */
export function isPascalCase(name: string): boolean {
  return /^\p{Lu}[$_\p{L}\p{N}\u200C\u200D]*$/u.test(name);
}
