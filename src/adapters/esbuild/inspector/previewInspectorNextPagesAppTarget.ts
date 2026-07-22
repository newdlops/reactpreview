/**
 * Expands a selected Next.js Pages Router `_app` into a non-recursive page composition.
 *
 * `_app` receives its `Component` prop from Next.js rather than from an authored import. Mounting
 * that module as an ordinary component therefore produces an undefined React element. This module
 * owns only the filesystem convention and default-export check needed to choose a real page leaf;
 * candidate construction and browser composition remain in their existing planner/root modules.
 */
import path from 'node:path';
import ts from 'typescript';
import {
  collectPreviewInspectorNextPagesShell,
  type PreviewInspectorNextPagesShell,
} from './previewInspectorNextPagesShell';

const NEXT_PAGES_APP_PATTERN = /^_app\.[cm]?[jt]sx?$/iu;
const NEXT_PAGES_SOURCE_PATTERN = /\.[cm]?[jt]sx?$/iu;
const NEXT_PAGES_IGNORED_FILE_PATTERN = /^(?:404|500|_app|_document|_error)$/iu;

/** Minimal source reader kept independent from the ancestor planner's wider graph contract. */
export type ReadPreviewInspectorNextPagesAppTargetSource = (
  sourcePath: string,
) => Promise<string | undefined>;

/** Inputs bounded to the selected package's existing source inventory. */
export interface CollectPreviewInspectorNextPagesAppTargetOptions {
  /** Selected default export path that may be a conventional `_app` module. */
  readonly appPath: string;
  /** Exact selected runtime export; Next invokes only `_app`'s default export. */
  readonly exportName: string;
  /** Dirty-editor-aware inert source reader used only to prove a runtime default page export. */
  readonly readSource: ReadPreviewInspectorNextPagesAppTargetSource;
  /** Nearest package or monorepo package inventory already bounded by the caller. */
  readonly sourcePaths: readonly string[];
}

/** Inputs for collecting several real Pages Router leaves behind one framework `_app`. */
export interface CollectPreviewInspectorNextPagesAppTargetsOptions extends CollectPreviewInspectorNextPagesAppTargetOptions {
  /** Strict upper bound that prevents a large pages directory from becoming an eager gallery. */
  readonly maximumCount: number;
}

/** Authored page selected to supply the framework-owned `_app.Component` prop. */
export interface PreviewInspectorNextPagesAuthoredAppTarget {
  readonly kind: 'authored-page';
  readonly page: {
    readonly exportName: 'default';
    readonly sourcePath: string;
  };
  readonly shell: PreviewInspectorNextPagesShell;
}

/** Safe shell-only fallback used when a project contains `_app` but no importable page leaf. */
export interface PreviewInspectorNextPagesSyntheticAppTarget {
  readonly kind: 'synthetic-page';
  readonly shell: PreviewInspectorNextPagesShell;
}

/** Complete non-recursive composition choice for a selected Pages Router `_app`. */
export type PreviewInspectorNextPagesAppTarget =
  PreviewInspectorNextPagesAuthoredAppTarget | PreviewInspectorNextPagesSyntheticAppTarget;

/**
 * Selects the safest same-root page for `_app`, preferring the root index route.
 *
 * API routes, framework special modules, private underscore segments, declarations, tests, and
 * files without a runtime default export are excluded. When no eligible page exists, a marked
 * synthetic shell is returned rather than falling back to direct `_app` mounting.
 */
export async function collectPreviewInspectorNextPagesAppTarget(
  options: CollectPreviewInspectorNextPagesAppTargetOptions,
): Promise<PreviewInspectorNextPagesAppTarget | undefined> {
  return (await collectPreviewInspectorNextPagesAppTargets({ ...options, maximumCount: 1 }))[0];
}

/**
 * Collects a bounded set of authored Pages Router leaves for one selected `_app`.
 *
 * Every candidate is still lazy in the browser. The extension reads only enough source files to
 * prove `maximumCount` runtime default exports, and retains the synthetic page solely when no real
 * visual leaf exists. This makes `_app` a page selector instead of incorrectly treating it as `/`.
 */
export async function collectPreviewInspectorNextPagesAppTargets(
  options: CollectPreviewInspectorNextPagesAppTargetsOptions,
): Promise<readonly PreviewInspectorNextPagesAppTarget[]> {
  const appPath = path.normalize(options.appPath);
  const pagesRoot = path.dirname(appPath);
  if (
    options.maximumCount <= 0 ||
    options.exportName !== 'default' ||
    path.basename(pagesRoot).toLowerCase() !== 'pages' ||
    !NEXT_PAGES_APP_PATTERN.test(path.basename(appPath)) ||
    !isPreferredNextPagesApp(appPath, options.sourcePaths)
  ) {
    return Object.freeze([]);
  }

  const pagePaths = options.sourcePaths
    .map((sourcePath) => path.normalize(sourcePath))
    .filter((sourcePath) => isSafeNextPagesLeaf(sourcePath, appPath, pagesRoot))
    .sort((left, right) => compareNextPagesLeaves(left, right, pagesRoot));

  const targets: PreviewInspectorNextPagesAppTarget[] = [];
  for (const pagePath of pagePaths) {
    const sourceText = await options.readSource(pagePath);
    if (sourceText === undefined || !hasRuntimeDefaultExport(pagePath, sourceText)) continue;
    const shell = collectPreviewInspectorNextPagesShell({
      exportName: 'default',
      pagePath,
      sourcePaths: options.sourcePaths,
    });
    if (shell === undefined || path.normalize(shell.app.sourcePath) !== appPath) continue;
    targets.push(
      Object.freeze({
        kind: 'authored-page',
        page: Object.freeze({ exportName: 'default', sourcePath: pagePath }),
        shell,
      }),
    );
    if (targets.length >= options.maximumCount) break;
  }

  if (targets.length > 0) return Object.freeze(targets);

  return Object.freeze([
    Object.freeze({
      kind: 'synthetic-page',
      shell: Object.freeze({
        app: Object.freeze({ exportName: 'default', sourcePath: appPath }),
        routeLocation: Object.freeze({
          componentName: 'NextPagesPage',
          evidenceKind: 'next-pages-synthetic',
          pathname: '/',
          pattern: '/',
          sourcePath: appPath,
        }),
        syntheticPage: true,
      }),
    }),
  ]);
}

/** Requires the selected `_app` to be the framework-preferred sibling extension. */
function isPreferredNextPagesApp(appPath: string, sourcePaths: readonly string[]): boolean {
  const extensionRank = new Map([
    ['.tsx', 0],
    ['.jsx', 1],
    ['.ts', 2],
    ['.js', 3],
  ]);
  const selected = sourcePaths
    .map((sourcePath) => path.normalize(sourcePath))
    .filter(
      (sourcePath) =>
        path.dirname(sourcePath) === path.dirname(appPath) &&
        NEXT_PAGES_APP_PATTERN.test(path.basename(sourcePath)),
    )
    .sort(
      (left, right) =>
        (extensionRank.get(path.extname(left).toLowerCase()) ?? 4) -
          (extensionRank.get(path.extname(right).toLowerCase()) ?? 4) || left.localeCompare(right),
    )[0];
  return selected === appPath;
}

/** Rejects paths that Next cannot safely use as a visual page leaf. */
function isSafeNextPagesLeaf(sourcePath: string, appPath: string, pagesRoot: string): boolean {
  if (sourcePath === appPath || !NEXT_PAGES_SOURCE_PATTERN.test(sourcePath)) return false;
  const relativePath = path.relative(pagesRoot, sourcePath);
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    /(?:^|\.)d\.[cm]?[jt]s$/iu.test(path.basename(sourcePath)) ||
    /\.(?:spec|test|stories?|story)\.[cm]?[jt]sx?$/iu.test(path.basename(sourcePath))
  ) {
    return false;
  }
  const segments = relativePath.split(path.sep);
  const fileStem = path.basename(sourcePath).replace(NEXT_PAGES_SOURCE_PATTERN, '');
  return (
    segments[0]?.toLowerCase() !== 'api' &&
    !segments.slice(0, -1).some((segment) => segment.startsWith('_')) &&
    !NEXT_PAGES_IGNORED_FILE_PATTERN.test(fileStem)
  );
}

/** Orders root index, nested index, then shallow static routes before dynamic alternatives. */
function compareNextPagesLeaves(left: string, right: string, pagesRoot: string): number {
  const score = (sourcePath: string): number => {
    const relativePath = path.relative(pagesRoot, sourcePath);
    const segments = relativePath.split(path.sep);
    const stem = path.basename(sourcePath).replace(NEXT_PAGES_SOURCE_PATTERN, '');
    const indexRank = stem.toLowerCase() === 'index' ? (segments.length === 1 ? 0 : 100) : 1_000;
    const dynamicPenalty = segments.some((segment) => segment.includes('[')) ? 100 : 0;
    // Development-only pages are valid Next routes, but are poor representatives of the authored
    // production shell when `_app` itself is selected. Keep them selectable only after real pages.
    const developmentPenalty = segments.some((segment) =>
      /^(?:dev|demo|examples?|playground|sandbox)$/iu.test(segment),
    )
      ? 100_000
      : 0;
    return indexRank + dynamicPenalty + developmentPenalty + segments.length;
  };
  return score(left) - score(right) || left.localeCompare(right);
}

/** Proves a runtime default export without evaluating the candidate page module. */
function hasRuntimeDefaultExport(sourcePath: string, sourceText: string): boolean {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    readScriptKind(sourcePath),
  );
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return !statement.isExportEquals;
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      ts.canHaveModifiers(statement) &&
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)
    ) {
      return true;
    }
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      return false;
    }
    return statement.exportClause.elements.some(
      (element) =>
        !element.isTypeOnly &&
        (element.name.text === 'default' || element.propertyName?.text === 'default'),
    );
  });
}

/** Selects TS/JS JSX grammar from the page extension. */
function readScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
