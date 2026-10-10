/**
 * Finds HTTPS stylesheet links that application wrappers render at runtime, such as a web font in
 * `<Helmet><link rel="stylesheet" href="https://…/pretendard.css" /></Helmet>`.
 *
 * Page Inspector mounts the selected page below the app shell, so a provider that injects a font
 * link from the shell never runs and the page falls back to system fonts. This module reads the
 * render path's modules, outermost first, and the project components they use (as JSX or composed
 * through helpers such as `nest(ThemeProvider, …)`) up to two imports deep, as inert text. It
 * collects static `<link>` elements whose `rel` is `stylesheet` and whose `href` is a plain HTTPS
 * literal. The document shell then links them like the project's `index.html` stylesheets.
 */
import path from 'node:path';
import ts from 'typescript';
import type { ReadPreviewProjectSourceOptions } from './previewProjectFileAnalysisCache';

const MAXIMUM_MODULE_BYTES = 512 * 1024;
const MAXIMUM_DEPTH = 2;
const MAXIMUM_MODULES = 64;
const MAXIMUM_CACHED_MODULES = 512;
/** Name tiers: document-level wrappers first, then providers, then app and layout shells. */
const NAME_TIERS = [
  /Theme|Helmet|Head|Font|Style/u,
  /Provider|Base|Root|Shell/u,
  /App|Layout/u,
] as const;

/** Links and component imports read from one module text. */
interface PreviewModuleLinkFacts {
  readonly imports: readonly { readonly name: string; readonly specifier: string }[];
  readonly links: readonly string[];
  readonly sourceText: string;
}

/** Parsed facts per module, reused while the cached source text is unchanged. */
const factsBySourcePath = new Map<string, PreviewModuleLinkFacts>();
const MAXIMUM_LINKS = 8;
const MAXIMUM_URL_LENGTH = 2048;

/** Inputs for one bounded link scan. */
export interface CollectPreviewApplicationStylesheetLinksOptions {
  /** Cached byte-bounded source reader shared with the rest of preview preparation. */
  readonly readSource: (options: ReadPreviewProjectSourceOptions) => Promise<string | undefined>;
  /** Project-aware resolver for imports of the scanned modules. */
  readonly resolveModule: (moduleSpecifier: string, consumerPath: string) => string | undefined;
  /** Render-path modules from the selected target up to the application entry. */
  readonly rootSourcePaths: readonly string[];
}

/** Links found plus the module that declared the first one, for rebuild routing. */
export interface PreviewApplicationStylesheetLinks {
  readonly dependencyPath: string;
  readonly links: readonly string[];
}

/**
 * Collects static HTTPS stylesheet links from render-path modules and their JSX wrappers.
 *
 * @param options Cached reader, resolver, and render-path modules.
 * @returns Links in discovery order, or `undefined` when none were found.
 */
export async function collectPreviewApplicationStylesheetLinks(
  options: CollectPreviewApplicationStylesheetLinksOptions,
): Promise<PreviewApplicationStylesheetLinks | undefined> {
  const links: string[] = [];
  let dependencyPath: string | undefined;
  const visited = new Set<string>();
  // Render paths run inner-to-outer; document providers live near the application root.
  const pending = [...options.rootSourcePaths]
    .reverse()
    .map((sourcePath, order) => ({ depth: 0, order, score: 0, sourcePath }));
  let order = pending.length;
  while (pending.length > 0 && visited.size < MAXIMUM_MODULES && links.length < MAXIMUM_LINKS) {
    pending.sort((left, right) => left.score - right.score || left.order - right.order);
    const next = pending.shift();
    if (next === undefined) break;
    const sourcePath = path.normalize(next.sourcePath);
    if (visited.has(sourcePath) || sourcePath.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    visited.add(sourcePath);
    const sourceText = await options.readSource({ maximumBytes: MAXIMUM_MODULE_BYTES, sourcePath });
    if (sourceText === undefined) continue;
    const facts = readModuleLinkFacts(sourcePath, sourceText);
    for (const link of facts.links) {
      if (links.includes(link) || links.length >= MAXIMUM_LINKS) continue;
      links.push(link);
      dependencyPath ??= sourcePath;
    }
    if (next.depth >= MAXIMUM_DEPTH) continue;
    for (const { name, specifier } of facts.imports) {
      const resolved = options.resolveModule(specifier, sourcePath);
      if (resolved === undefined) continue;
      const tier = NAME_TIERS.findIndex((pattern) => pattern.test(name));
      const score = next.depth + 1 + (tier < 0 ? NAME_TIERS.length : tier);
      pending.push({ depth: next.depth + 1, order: order++, score, sourcePath: resolved });
    }
  }
  return dependencyPath === undefined ? undefined : { dependencyPath, links };
}

/** Parses one module once per unchanged text and keeps a bounded cache. */
function readModuleLinkFacts(sourcePath: string, sourceText: string): PreviewModuleLinkFacts {
  const cached = factsBySourcePath.get(sourcePath);
  if (cached?.sourceText === sourceText) return cached;
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    /\.[cm]?ts$/iu.test(sourcePath) ? ts.ScriptKind.TS : ts.ScriptKind.TSX,
  );
  const facts: PreviewModuleLinkFacts = {
    imports: readComponentImports(sourceFile),
    links: /<link\b/u.test(sourceText) ? readStylesheetLinks(sourceFile) : [],
    sourceText,
  };
  factsBySourcePath.delete(sourcePath);
  factsBySourcePath.set(sourcePath, facts);
  if (factsBySourcePath.size > MAXIMUM_CACHED_MODULES) {
    const oldest = factsBySourcePath.keys().next().value;
    if (oldest !== undefined) factsBySourcePath.delete(oldest);
  }
  return facts;
}

/** Reads `<link rel="stylesheet" href="https://…">` elements with literal attributes. */
function readStylesheetLinks(sourceFile: ts.SourceFile): string[] {
  const links: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'link'
    ) {
      const attributes = new Map<string, string>();
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.initializer === undefined) continue;
        const value = ts.isStringLiteral(attribute.initializer)
          ? attribute.initializer.text
          : ts.isJsxExpression(attribute.initializer) &&
              attribute.initializer.expression !== undefined &&
              ts.isStringLiteralLike(attribute.initializer.expression)
            ? attribute.initializer.expression.text
            : undefined;
        if (value !== undefined) attributes.set(attribute.name.getText(sourceFile), value);
      }
      const relations = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/u);
      const href = attributes.get('href')?.trim();
      const stylesheet =
        relations.includes('stylesheet') ||
        (relations.includes('preload') && attributes.get('as')?.toLowerCase() === 'style');
      if (
        stylesheet &&
        href !== undefined &&
        href.length <= MAXIMUM_URL_LENGTH &&
        /^https:\/\/[^\s/]+\//iu.test(href) &&
        !/[%{}<>\s\\]/u.test(href)
      ) {
        links.push(href);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return links;
}

/** Reads imports of PascalCase bindings this module uses as JSX tags or other values. */
function readComponentImports(
  sourceFile: ts.SourceFile,
): { readonly name: string; readonly specifier: string }[] {
  const imported = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const clause = statement.importClause;
    if (clause === undefined || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = clause.namedBindings;
    const names = [
      ...(clause.name === undefined ? [] : [clause.name.text]),
      ...(bindings !== undefined && ts.isNamedImports(bindings)
        ? bindings.elements
            .filter((element) => !element.isTypeOnly)
            .map((element) => element.name.text)
        : []),
    ];
    for (const name of names) {
      if (/^[A-Z]/u.test(name)) imported.set(name, statement.moduleSpecifier.text);
    }
  }
  const used = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && imported.has(node.text)) used.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...used].flatMap((name) => {
    const specifier = imported.get(name);
    return specifier === undefined ? [] : [{ name, specifier }];
  });
}
