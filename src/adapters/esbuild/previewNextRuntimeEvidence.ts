/**
 * Proves Next.js route and runtime use before optional Page Inspector analysis requests inventory.
 * The probe is intentionally bounded to inert manifest data, the selected source AST, and a small
 * fixed set of conventional files. It never walks a directory, imports configuration, or starts
 * a framework process, so generic React projects retain their direct first-paint path.
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import type { PreviewBuildRequest } from '../../domain/preview';
import {
  findPreviewDependencySpecifier,
  type PreviewDependencyProfile,
} from '../node/previewDependencyProfile';

const NEXT_CONFIG_SENTINELS = ['next.config.js', 'next.config.mjs', 'next.config.ts'] as const;
const NEXT_ROUTE_CONTEXT_SENTINELS = ['next-env.d.ts'] as const;
const MAXIMUM_PACKAGE_MANIFEST_BYTES = 1024 * 1024;
const PACKAGE_DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

/** Separates page-context discovery from source-transform authority at a leaf package boundary. */
export interface PreviewNextRuntimeEvidence {
  /** Explicit package/generated evidence may enable bounded App Router planning and facades. */
  readonly routeContext: boolean;
  /** Leaf declaration, import, or config may enable framework-owned source transformations. */
  readonly projectRuntime: boolean;
}

/**
 * Accepts declared, imported, configured, or generated Next evidence for the selected package.
 * Missing `node_modules` is deliberately irrelevant: a declared or authored Next application can
 * still use React Preview's static facade and managed runtime dependencies.
 */
export async function collectPreviewNextRuntimeEvidence(
  profile: PreviewDependencyProfile | undefined,
  projectRoot: string,
  request: Pick<PreviewBuildRequest, 'documentPath' | 'sourceText'>,
): Promise<PreviewNextRuntimeEvidence> {
  const declaredRuntime =
    profile !== undefined
      ? findPreviewDependencySpecifier(profile, 'next') !== undefined
      : await hasDeclaredNextDependency(projectRoot);
  const importedRuntime = hasStaticNextModuleReference(request.documentPath, request.sourceText);
  const configuredRuntime = await hasAnyFile(
    NEXT_CONFIG_SENTINELS.map((fileName) => path.join(projectRoot, fileName)),
  );
  const projectRuntime = declaredRuntime || importedRuntime || configuredRuntime;
  const generatedRouteContext = await hasAnyFile(
    NEXT_ROUTE_CONTEXT_SENTINELS.map((fileName) => path.join(projectRoot, fileName)),
  );
  const routeContext = projectRuntime || generatedRouteContext;
  return Object.freeze({ projectRuntime, routeContext });
}

/** Reads only bounded inert dependency maps when no managed-environment profile was requested. */
async function hasDeclaredNextDependency(projectRoot: string): Promise<boolean> {
  const manifestPath = path.join(projectRoot, 'package.json');
  try {
    const metadata = await stat(manifestPath);
    if (!metadata.isFile() || metadata.size > MAXIMUM_PACKAGE_MANIFEST_BYTES) return false;
    const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const manifest = parsed as Readonly<Record<string, unknown>>;
    return PACKAGE_DEPENDENCY_FIELDS.some((field) => {
      const dependencies = manifest[field];
      return (
        dependencies !== null &&
        typeof dependencies === 'object' &&
        !Array.isArray(dependencies) &&
        typeof (dependencies as Readonly<Record<string, unknown>>).next === 'string'
      );
    });
  } catch {
    return false;
  }
}

/** Parses only the active editor source so comments and string literals cannot mimic an import. */
function hasStaticNextModuleReference(sourcePath: string, sourceText: string): boolean {
  if (!sourceText.includes('next')) return false;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    sourcePath.toLowerCase().endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return sourceFile.statements.some((statement) => {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(statement.moduleSpecifier)
    ) {
      return isNextSpecifier(statement.moduleSpecifier.text);
    }
    if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      ts.isStringLiteralLike(statement.moduleReference.expression)
    ) {
      return isNextSpecifier(statement.moduleReference.expression.text);
    }
    return false;
  });
}

/** Resolves one bounded sentinel list without allowing a missing or unreadable file to fail build. */
async function hasAnyFile(candidates: readonly string[]): Promise<boolean> {
  const results = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        return (await stat(candidate)).isFile();
      } catch {
        return false;
      }
    }),
  );
  return results.some(Boolean);
}

/** Accepts only Next's public package root and subpath requests. */
function isNextSpecifier(specifier: string): boolean {
  return specifier === 'next' || specifier.startsWith('next/');
}
