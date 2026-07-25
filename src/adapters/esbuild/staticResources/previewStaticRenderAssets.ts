/**
 * Converts statically known render-resource values into explicit bounded asset imports.
 *
 * JavaScript bundlers only discover files referenced by imports, CSS URL tokens, or `new URL`.
 * Plain JSX such as `<img src="/logo.png" />` remains a browser URL and therefore points at the
 * generated webview artifact instead of the application's public directory. This analyzer bridges
 * that final gap without crawling a whole public tree: it follows only source-authored values in
 * URL-bearing render positions, proves that the referenced file exists inside the workspace, and
 * emits the same `?url` import already enforced by the preview asset boundary.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isInlinePreviewAssetPath } from '../previewLoaderPolicy';
import type { PreviewSourceBindingAllocator } from './previewSourceBindingAllocator';
import type { PreviewSourceReplacement } from './previewSourceReplacement';
import type { StaticSourceAnalysis } from './staticCallParser';

/** Render properties whose literal values are interpreted as browser resource locations. */
const RESOURCE_PROPERTY_NAMES = new Set([
  'backgroundimage',
  'href',
  'icon',
  'image',
  'imageurl',
  'poster',
  'src',
  'xlinkhref',
]);

/** JSX-only responsive image property handled as a comma-separated URL candidate list. */
const SOURCE_SET_PROPERTY_NAME = 'srcset';

/** CSS object properties where one exact `url(...)` value can be made bundle-visible. */
const CSS_URL_PROPERTY_NAMES = new Set([
  'background',
  'backgroundimage',
  'borderimage',
  'liststyleimage',
  'mask',
  'maskimage',
]);

/** Identifier suffixes that prove a literal variable carries a render-resource URL. */
const RESOURCE_IDENTIFIER_SUFFIX =
  /(?:asset|avatar|background|icon|image|img|logo|poster|src|url|uri)$/iu;

/** Cheap gate that avoids any additional AST walk for modules without static render URLs. */
const STATIC_RENDER_ASSET_EVIDENCE =
  /(?:\b(?:background(?:Image)?|href|icon|image(?:Url)?|poster|src(?:Set)?|xlinkHref)\s*(?:=|:)\s*(?:\{?\s*)?["'`]|\b[A-Za-z_$][\w$]*(?:asset|avatar|background|icon|image|img|logo|poster|src|url|uri)\s*=\s*["'`])/iu;

/** One source-authored URL plus the source range that should become a generated binding. */
interface SingleAssetCandidate {
  /** Replacement form required by JSX attributes versus ordinary JavaScript expressions. */
  readonly context: 'expression' | 'jsx-attribute';
  /** Exclusive source offset after the complete value expression. */
  readonly end: number;
  /** Static browser path decoded by TypeScript without evaluating project code. */
  readonly requestPath: string;
  /** Inclusive source offset at the start of the complete value expression. */
  readonly start: number;
  /** Optional CSS wrapper retained around the imported URL. */
  readonly wrapper?: 'css-url';
}

/** One responsive `srcSet` string decomposed into independently bundleable entries. */
interface SourceSetCandidate {
  /** Exclusive source offset after the complete JSX attribute initializer. */
  readonly end: number;
  /** Ordered responsive image entries including their density or width descriptors. */
  readonly entries: readonly SourceSetEntry[];
  /** Inclusive source offset at the start of the complete JSX attribute initializer. */
  readonly start: number;
}

/** One URL and optional descriptor from a static responsive image source list. */
interface SourceSetEntry {
  /** Authored suffix such as `2x` or `640w`, excluding surrounding whitespace. */
  readonly descriptor: string;
  /** Static browser path before the descriptor. */
  readonly requestPath: string;
}

/** Every bounded static render-resource shape supported by this analyzer. */
type StaticAssetCandidate = SingleAssetCandidate | SourceSetCandidate;

/** A proven local asset and the exact query-bearing import used by esbuild. */
interface ResolvedAsset {
  /** Absolute workspace file path used for dependency watching and trusted resolution. */
  readonly filePath: string;
  /** Absolute `?url` specifier, retaining only an authored URL fragment. */
  readonly importSpecifier: string;
}

/** Inputs shared with the compilation-scoped source transformer. */
export interface PreviewStaticRenderAssetOptions {
  /** Collision-free binding allocator built from the same immutable source AST. */
  readonly bindings: PreviewSourceBindingAllocator;
  /** Nearest package boundary containing the conventional public directory. */
  readonly projectRoot: string;
  /** Existing syntax analysis whose TypeScript tree must be reused rather than reparsed. */
  readonly sourceAnalysis: StaticSourceAnalysis;
  /** Absolute module path used to resolve explicitly relative resource strings. */
  readonly sourcePath: string;
  /** Original module text addressed by returned replacement offsets. */
  readonly sourceText: string;
  /** Trusted workspace boundary applied before any generated import is emitted. */
  readonly workspaceRoot: string;
}

/** Generated imports and source edits contributed to the central compatibility pipeline. */
export interface PreviewStaticRenderAssetTransform {
  /** Explicit data-URL imports appended to the transformed source module. */
  readonly imports: readonly string[];
  /** Non-overlapping edits computed against the original module text. */
  readonly replacements: readonly PreviewSourceReplacement[];
}

/**
 * Creates bounded imports for static image, media, document, and font locations used by rendering.
 *
 * Missing files deliberately remain untouched. A backend URL, generated route, or unresolved public
 * path can still be represented by application code, while a proven local file becomes immediately
 * usable inside the serverless webview.
 *
 * @param options Source tree, project boundaries, and shared binding allocator.
 * @returns Empty output when no local value is proven, otherwise deterministic imports and edits.
 */
export async function createPreviewStaticRenderAssetTransform(
  options: PreviewStaticRenderAssetOptions,
): Promise<PreviewStaticRenderAssetTransform> {
  if (!STATIC_RENDER_ASSET_EVIDENCE.test(options.sourceText)) {
    return { imports: [], replacements: [] };
  }

  const candidates = collectStaticAssetCandidates(options.sourceAnalysis.getSourceFile());
  if (candidates.length === 0) {
    return { imports: [], replacements: [] };
  }

  const requestPaths = [
    ...new Set(
      candidates.flatMap((candidate) =>
        'requestPath' in candidate
          ? [candidate.requestPath]
          : candidate.entries.map((entry) => entry.requestPath),
      ),
    ),
  ];
  const resolutions = new Map<string, ResolvedAsset | undefined>();
  await Promise.all(
    requestPaths.map(async (requestPath) => {
      resolutions.set(requestPath, await resolveStaticAsset(requestPath, options));
    }),
  );

  const bindingBySpecifier = new Map<string, string>();
  const imports: string[] = [];
  const replacements: PreviewSourceReplacement[] = [];
  const getBinding = (resolved: ResolvedAsset): string => {
    const existing = bindingBySpecifier.get(resolved.importSpecifier);
    if (existing !== undefined) return existing;
    const binding = options.bindings.next('renderAsset');
    bindingBySpecifier.set(resolved.importSpecifier, binding);
    imports.push(`import ${binding} from ${JSON.stringify(resolved.importSpecifier)};`);
    return binding;
  };

  for (const candidate of candidates) {
    if ('requestPath' in candidate) {
      const resolved = resolutions.get(candidate.requestPath);
      if (resolved === undefined) continue;
      const binding = getBinding(resolved);
      const value = candidate.wrapper === 'css-url' ? `\`url("\${${binding}}")\`` : binding;
      replacements.push({
        end: candidate.end,
        replacement: candidate.context === 'jsx-attribute' ? `{${value}}` : value,
        start: candidate.start,
      });
      continue;
    }

    const resolvedEntries = candidate.entries.map((entry) => ({
      binding: resolutions.get(entry.requestPath),
      descriptor: entry.descriptor,
    }));
    if (resolvedEntries.some((entry) => entry.binding === undefined)) continue;
    const values: string[] = [];
    for (const entry of resolvedEntries) {
      if (entry.binding === undefined) continue;
      const binding = getBinding(entry.binding);
      values.push(
        entry.descriptor.length === 0
          ? binding
          : `${binding} + ${JSON.stringify(` ${entry.descriptor}`)}`,
      );
    }
    if (values.length !== resolvedEntries.length) continue;
    replacements.push({
      end: candidate.end,
      replacement: `{[${values.join(', ')}].join(", ")}`,
      start: candidate.start,
    });
  }

  return { imports, replacements };
}

/**
 * Walks only syntax positions with browser resource semantics and records their original ranges.
 *
 * @param sourceFile Shared syntax-valid TypeScript source tree.
 * @param sourceText Original text used to preserve exact replacement offsets.
 * @returns Deduplicated candidates in source order.
 */
function collectStaticAssetCandidates(sourceFile: ts.SourceFile): readonly StaticAssetCandidate[] {
  const candidates: StaticAssetCandidate[] = [];
  const occupiedRanges = new Set<string>();
  const add = (candidate: StaticAssetCandidate): void => {
    const key = `${candidate.start.toString()}:${candidate.end.toString()}`;
    if (occupiedRanges.has(key)) return;
    occupiedRanges.add(key);
    candidates.push(candidate);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.initializer !== undefined) {
      const propertyName = node.name.getText(sourceFile).toLowerCase();
      const staticValue = readJsxStaticValue(node.initializer);
      if (staticValue !== undefined) {
        if (propertyName === SOURCE_SET_PROPERTY_NAME) {
          const entries = parseSourceSet(staticValue);
          if (entries !== undefined) {
            add({
              end: node.initializer.end,
              entries,
              start: node.initializer.getStart(sourceFile),
            });
          }
        } else if (RESOURCE_PROPERTY_NAMES.has(propertyName)) {
          add({
            context: 'jsx-attribute',
            end: node.initializer.end,
            requestPath: staticValue,
            start: node.initializer.getStart(sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
      return;
    }

    if (ts.isPropertyAssignment(node)) {
      const propertyName = readPropertyName(node.name);
      const staticValue = readStaticExpression(node.initializer);
      if (propertyName !== undefined && staticValue !== undefined) {
        const lowerName = propertyName.toLowerCase();
        const cssUrl = CSS_URL_PROPERTY_NAMES.has(lowerName)
          ? readSingleCssUrl(staticValue)
          : undefined;
        if (cssUrl !== undefined) {
          add({
            context: 'expression',
            end: node.initializer.end,
            requestPath: cssUrl,
            start: node.initializer.getStart(sourceFile),
            wrapper: 'css-url',
          });
        } else if (RESOURCE_PROPERTY_NAMES.has(lowerName)) {
          add({
            context: 'expression',
            end: node.initializer.end,
            requestPath: staticValue,
            start: node.initializer.getStart(sourceFile),
          });
        }
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      RESOURCE_IDENTIFIER_SUFFIX.test(node.name.text)
    ) {
      const staticValue = readStaticExpression(node.initializer);
      if (staticValue !== undefined) {
        add({
          context: 'expression',
          end: node.initializer.end,
          requestPath: staticValue,
          start: node.initializer.getStart(sourceFile),
        });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates.sort((left, right) => left.start - right.start);
}

/** Reads a quoted JSX attribute or a string-only JSX expression without executing it. */
function readJsxStaticValue(initializer: ts.JsxAttributeValue): string | undefined {
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (!ts.isJsxExpression(initializer) || initializer.expression === undefined) return undefined;
  return readStaticExpression(initializer.expression);
}

/** Reads a string or interpolation-free template after removing TypeScript-only wrappers. */
function readStaticExpression(expression: ts.Expression): string | undefined {
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
  return ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)
    ? current.text
    : undefined;
}

/** Reads an identifier, quoted key, or numeric-free property name used by an object literal. */
function readPropertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return undefined;
}

/** Parses one exact CSS `url(...)` string while preserving neither quotes nor wrapper whitespace. */
function readSingleCssUrl(value: string): string | undefined {
  const match = /^\s*url\(\s*(?:(["'])(.*?)\1|([^"'()]*?))\s*\)\s*$/iu.exec(value);
  const requestPath = (match?.[2] ?? match?.[3])?.trim();
  return requestPath === '' ? undefined : requestPath;
}

/** Parses a bounded static `srcSet` into URL/descriptor pairs; data URLs remain browser-owned. */
function parseSourceSet(value: string): readonly SourceSetEntry[] | undefined {
  if (value.includes('data:')) return undefined;
  const parts = value.split(',');
  if (parts.length === 0 || parts.length > 32) return undefined;
  const entries: SourceSetEntry[] = [];
  for (const part of parts) {
    const match = /^\s*(\S+)(?:\s+(.+?))?\s*$/u.exec(part);
    const requestPath = match?.[1];
    if (requestPath === undefined) return undefined;
    entries.push({ descriptor: match?.[2]?.trim() ?? '', requestPath });
  }
  return entries;
}

/**
 * Resolves one authored browser path to a regular workspace file without directory enumeration.
 *
 * @param requestPath Static URL including an optional cache query or fragment.
 * @param options Project and workspace boundaries plus the importing module path.
 * @returns Trusted absolute import identity, or `undefined` when the value remains browser-owned.
 */
async function resolveStaticAsset(
  requestPath: string,
  options: Pick<PreviewStaticRenderAssetOptions, 'projectRoot' | 'sourcePath' | 'workspaceRoot'>,
): Promise<ResolvedAsset | undefined> {
  const { pathPattern, fragment } = splitBrowserAssetPath(requestPath);
  if (pathPattern.length === 0 || pathPattern.startsWith('//')) return undefined;
  if (!isInlinePreviewAssetPath(pathPattern)) return undefined;

  let filePath: string;
  let publicImportPath: string | undefined;
  if (pathPattern.startsWith('file:')) {
    try {
      filePath = fileURLToPath(pathPattern);
    } catch {
      return undefined;
    }
  } else if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(pathPattern)) {
    return undefined;
  } else if (path.isAbsolute(pathPattern) && isPathInside(options.workspaceRoot, pathPattern)) {
    filePath = path.resolve(pathPattern);
  } else if (pathPattern.startsWith('/')) {
    const publicDirectory = path.resolve(options.projectRoot, 'public');
    filePath = path.resolve(publicDirectory, pathPattern.slice(1));
    if (!isPathInside(publicDirectory, filePath)) return undefined;
    publicImportPath = pathPattern;
  } else if (pathPattern.startsWith('./') || pathPattern.startsWith('../')) {
    filePath = path.resolve(path.dirname(options.sourcePath), pathPattern);
  } else {
    const publicDirectory = path.resolve(options.projectRoot, 'public');
    filePath = path.resolve(publicDirectory, pathPattern);
    if (!isPathInside(publicDirectory, filePath)) return undefined;
    publicImportPath = `/${pathPattern}`;
  }

  if (!isPathInside(options.workspaceRoot, filePath)) return undefined;
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) return undefined;
  } catch {
    return undefined;
  }
  return {
    filePath,
    importSpecifier: `${publicImportPath ?? filePath}?url${fragment}`,
  };
}

/** Separates cache/query text from the local path while retaining a meaningful URL fragment. */
function splitBrowserAssetPath(value: string): {
  readonly fragment: string;
  readonly pathPattern: string;
} {
  const queryIndex = value.indexOf('?');
  const fragmentIndex = value.indexOf('#');
  const suffixIndex = [queryIndex, fragmentIndex]
    .filter((index) => index >= 0)
    .reduce((lowest, index) => Math.min(lowest, index), value.length);
  return {
    fragment: fragmentIndex < 0 ? '' : value.slice(fragmentIndex),
    pathPattern: value.slice(0, suffixIndex),
  };
}

/** Reports whether one absolute candidate remains lexically inside the trusted workspace. */
function isPathInside(directoryPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
  );
}
