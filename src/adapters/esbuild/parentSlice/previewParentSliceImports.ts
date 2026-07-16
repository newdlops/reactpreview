/**
 * Builds the inert import-symbol table used by bounded parent JSX render-slice analysis.
 * Resolution is lexical only: relative paths are compared without source extensions, while
 * caller-approved aliases and complete slash-delimited target suffixes support monorepo sources.
 */
import path from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSION_PATTERN = /(?:\.d)?\.[cm]?[jt]sx?$/iu;

/** Runtime import binding that can be reproduced by a generated virtual preview module. */
export interface PreviewParentSliceImportBinding {
  /** Original runtime export selected by the import declaration. */
  readonly importedName: string;
  /** Consumer-local identifier used as the root of a JSX tag. */
  readonly localName: string;
  /** Authored module specifier retained for package and alias-aware bundler resolution. */
  readonly moduleSpecifier: string;
}

/**
 * Collects default, named, and namespace runtime imports keyed by their consumer-local names.
 *
 * @param sourceFile Parsed consumer module.
 * @returns Stable lookup table excluding erased type-only and deferred-phase imports.
 */
export function collectPreviewParentSliceImportBindings(
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, PreviewParentSliceImportBinding> {
  const imports = new Map<string, PreviewParentSliceImportBinding>();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier !== undefined) {
      continue;
    }
    const moduleSpecifier = statement.moduleSpecifier.text;
    if (clause.name !== undefined) {
      imports.set(clause.name.text, {
        importedName: 'default',
        localName: clause.name.text,
        moduleSpecifier,
      });
    }
    if (clause.namedBindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, {
        importedName: '*',
        localName: clause.namedBindings.name.text,
        moduleSpecifier,
      });
      continue;
    }
    for (const element of clause.namedBindings.elements) {
      if (element.isTypeOnly) {
        continue;
      }
      imports.set(element.name.text, {
        importedName: (element.propertyName ?? element.name).text,
        localName: element.name.text,
        moduleSpecifier,
      });
    }
  }

  return imports;
}

/**
 * Reports whether one authored import specifier resolves to the selected preview target.
 *
 * @param moduleSpecifier Authored specifier from the consumer's import declaration.
 * @param consumerPath Absolute path of the module containing that import.
 * @param targetPath Absolute path of the selected React source module.
 * @param acceptedSpecifiers Optional aliases already resolved by the compiler or project index.
 * @returns `true` only for an exact lexical path or complete target suffix match.
 */
export function matchesPreviewParentSliceTargetImport(
  moduleSpecifier: string,
  consumerPath: string,
  targetPath: string,
  acceptedSpecifiers: ReadonlySet<string>,
): boolean {
  const cleanSpecifier = cleanModuleSpecifier(moduleSpecifier);
  if (cleanSpecifier === undefined) {
    return false;
  }
  if (acceptedSpecifiers.has(cleanSpecifier)) {
    return true;
  }

  const canonicalTarget = canonicalizeSourceModulePath(targetPath);
  if (cleanSpecifier.startsWith('.') || path.isAbsolute(cleanSpecifier)) {
    const resolvedPath = path.isAbsolute(cleanSpecifier)
      ? cleanSpecifier
      : path.resolve(path.dirname(consumerPath), cleanSpecifier);
    return canonicalizeSourceModulePath(resolvedPath) === canonicalTarget;
  }

  const aliasPath = cleanSpecifier.replace(/^(?:@|~)\//u, '');
  const normalizedTarget = canonicalTarget.replaceAll('\\', '/');
  return (
    normalizedTarget.endsWith(`/${aliasPath}`) || normalizedTarget.endsWith(`/${aliasPath}/index`)
  );
}

/**
 * Removes loader query/hash suffixes and normalizes separators without interpreting package data.
 *
 * @param moduleSpecifier Raw string-literal module specifier.
 * @returns A non-empty normalized specifier, or `undefined` for an unusable value.
 */
function cleanModuleSpecifier(moduleSpecifier: string): string | undefined {
  const cleanSpecifier = moduleSpecifier.split(/[?#]/u, 1)[0]?.replaceAll('\\', '/');
  return cleanSpecifier === undefined || cleanSpecifier.length === 0 ? undefined : cleanSpecifier;
}

/**
 * Canonicalizes extensionless and directory-index source references to the same lexical identity.
 *
 * @param sourcePath Absolute or resolved source module path.
 * @returns Normalized path without a supported script extension or trailing index segment.
 */
function canonicalizeSourceModulePath(sourcePath: string): string {
  const withoutExtension = path.normalize(sourcePath).replace(SOURCE_EXTENSION_PATTERN, '');
  return withoutExtension.endsWith(`${path.sep}index`)
    ? withoutExtension.slice(0, -`${path.sep}index`.length)
    : withoutExtension;
}
