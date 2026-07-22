/**
 * Reconnects a Next.js App Router layout to the ordinary descendant pages it implicitly wraps.
 *
 * Next does not represent `layout -> page` as a JavaScript import: the framework inserts each
 * page into the nearest layout/template `children` slot. Reverse-import discovery therefore stops
 * at a selected shell wrapper (or at a helper used only by it) unless this filesystem edge is
 * added explicitly. This adapter remains convention-bounded and never evaluates Next config.
 */
import { Buffer } from 'node:buffer';
import path from 'node:path';
import ts from 'typescript';
import type { ResolvePreviewRenderGraphModule } from '../renderGraph';
import { freezePreviewInspectorPageCandidate } from './previewInspectorAncestorFreezing';
import type { PreviewInspectorPageCandidate } from './previewInspectorAncestorTypes';
import {
  collectPreviewInspectorNextAppLayoutChain,
  type PreviewInspectorNextAppLayoutChain,
} from './previewInspectorNextAppLayoutChain';
import { collectRefinedPreviewInspectorNextAppLayoutChain } from './previewInspectorNextAppParameterEvidence';

const NEXT_APP_SHELL_PATTERN = /^(?:layout|template)\.[cm]?[jt]sx?$/iu;
const NEXT_APP_PAGE_PATTERN = /^page\.[cm]?[jt]sx?$/iu;
const MAXIMUM_COST_SHORTLIST_SIZE = 16;
const COST_SHORTLIST_MULTIPLIER = 4;
const MAXIMUM_COST_SOURCE_BYTES = 4 * 1024 * 1024;
const MAXIMUM_COST_IMPORTS = 512;
const IMPORT_EDGE_COST_BYTES = 16 * 1024;
const BROAD_MODULE_COST_BYTES = 512 * 1024;
const MAXIMUM_COST_PARSE_CHARACTERS = 512 * 1024;
const BROAD_MODULE_SEGMENT_PATTERN =
  /(?:^|[-_.])(?:generated|registry|manifest|catalog|__index__)(?:$|[-_.])/iu;

/** Inputs kept independent from graph parsing so discovery can reuse the bounded source inventory. */
export interface CollectPreviewInspectorNextAppDescendantPagesOptions {
  /** Existing nearest-owner candidate whose root may be an implicit layout or template. */
  readonly base: PreviewInspectorPageCandidate;
  /** Maximum selectable leaves retained after deterministic nearest-page ranking. */
  readonly maximumCount: number;
  /** Reads a bounded cost shortlist plus selected `generateStaticParams` evidence. */
  readonly readSource: (sourcePath: string) => Promise<string | undefined>;
  /** Project-aware resolver for imported static route parameter registries. */
  readonly resolveModule?: ResolvePreviewRenderGraphModule;
  /** Package-local inventory already collected by the compiler; no new filesystem walk occurs. */
  readonly sourcePaths: readonly string[];
}

/** One proven ordinary page and the complete layout shell that will mount it. */
interface DescendantPageEvidence {
  readonly pagePath: string;
  readonly shell: PreviewInspectorNextAppLayoutChain;
}

/** Bounded static estimate used only to order equally near descendant pages. */
interface DescendantPageCost {
  /** Broad registry/catalog edges that often fan out into generated module inventories. */
  readonly broadModuleCount: number;
  /** Runtime module edges visible in the page source without resolving their transitive graph. */
  readonly importCount: number;
  /** Saturated aggregate estimate; lower values indicate a cheaper likely first bundle. */
  readonly score: number;
  /** UTF-8 source size retained separately so ties remain explainable and deterministic. */
  readonly sourceBytes: number;
}

/** One shortlist entry paired with its source-only bundle cost estimate. */
interface CostedDescendantPageEvidence extends DescendantPageEvidence {
  /** Undefined leaves an unreadable/stale inventory entry on the legacy lexical fallback path. */
  readonly cost: DescendantPageCost | undefined;
}

/**
 * Creates independently selectable page candidates below one selected App Router shell wrapper.
 *
 * Parallel and intercepted branches are rejected by the shared layout-chain analyzer because a
 * lone named slot cannot truthfully stand in for Next's simultaneously active route tree.
 */
export async function collectPreviewInspectorNextAppDescendantPages(
  options: CollectPreviewInspectorNextAppDescendantPagesOptions,
): Promise<readonly PreviewInspectorPageCandidate[]> {
  const shellPath = path.normalize(options.base.root.sourcePath);
  if (
    options.base.root.exportName !== 'default' ||
    !NEXT_APP_SHELL_PATTERN.test(path.basename(shellPath)) ||
    options.maximumCount <= 0
  ) {
    return Object.freeze([]);
  }

  const shellDirectory = path.dirname(shellPath);
  const nearbyEvidence = [
    ...new Set(options.sourcePaths.map((sourcePath) => path.normalize(sourcePath))),
  ]
    .filter((sourcePath) => isDescendantPage(shellDirectory, sourcePath))
    .map((pagePath): DescendantPageEvidence | undefined => {
      const shell = collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath,
        sourcePaths: options.sourcePaths,
      });
      return shell?.layouts.some((layout) => path.normalize(layout.sourcePath) === shellPath) ===
        true
        ? { pagePath, shell }
        : undefined;
    })
    .filter((item): item is DescendantPageEvidence => item !== undefined)
    .sort((left, right) => compareDescendantPages(shellDirectory, left.pagePath, right.pagePath));
  const sourceByPath = new Map<string, Promise<string | undefined>>();
  const readSource = (sourcePath: string): Promise<string | undefined> => {
    const normalizedPath = path.normalize(sourcePath);
    const cached = sourceByPath.get(normalizedPath);
    if (cached !== undefined) return cached;
    const pending = options.readSource(normalizedPath);
    sourceByPath.set(normalizedPath, pending);
    return pending;
  };
  const shortlistSize = Math.min(
    nearbyEvidence.length,
    MAXIMUM_COST_SHORTLIST_SIZE,
    Math.max(options.maximumCount, options.maximumCount * COST_SHORTLIST_MULTIPLIER),
  );
  const costedShortlist = await Promise.all(
    nearbyEvidence
      .slice(0, shortlistSize)
      .map(async (item): Promise<CostedDescendantPageEvidence> => {
        const source = await readSource(item.pagePath);
        return { ...item, cost: estimateDescendantPageCost(item.pagePath, source) };
      }),
  );
  const shortlistCostByPath = new Map<string, DescendantPageCost>();
  for (const item of costedShortlist) {
    if (item.cost !== undefined) shortlistCostByPath.set(path.normalize(item.pagePath), item.cost);
  }
  const evidence = nearbyEvidence
    .sort((left, right) =>
      compareCostedDescendantPages(shellDirectory, left, right, shortlistCostByPath),
    )
    .slice(0, options.maximumCount);

  return Object.freeze(
    await Promise.all(
      evidence.map(async ({ pagePath, shell: initialShell }) => {
        const refinement = await collectRefinedPreviewInspectorNextAppLayoutChain({
          exportName: 'default',
          pagePath,
          readSource,
          ...(options.resolveModule === undefined ? {} : { resolveModule: options.resolveModule }),
          sourcePaths: options.sourcePaths,
        });
        const shell = refinement?.shell ?? initialShell;
        const dependencies = new Set(options.base.dependencyPaths);
        dependencies.add(pagePath);
        for (const dependencyPath of refinement?.dependencyPaths ?? []) {
          dependencies.add(dependencyPath);
        }
        for (const layout of shell.layouts) dependencies.add(layout.sourcePath);
        return freezePreviewInspectorPageCandidate({
          complete: true,
          dependencies,
          edges: options.base.edges,
          id: `next-app-descendant:${pagePath}`,
          renderPath: options.base.renderPath,
          root: Object.freeze({ exportName: 'default', sourcePath: pagePath }),
          rootAutomaticProps: Object.freeze({}),
          nextAppLayoutChain: shell.layouts,
          rootOwnsRouter: false,
          routeLocation: shell.routeLocation,
          stopReason: 'root-reached',
          targetAutomaticProps: options.base.targetAutomaticProps,
        });
      }),
    ),
  );
}

/** Accepts only exact page modules strictly below the selected layout directory. */
function isDescendantPage(layoutDirectory: string, sourcePath: string): boolean {
  if (!NEXT_APP_PAGE_PATTERN.test(path.basename(sourcePath))) return false;
  const relative = path.relative(layoutDirectory, sourcePath);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Prefers the closest route leaf, then a stable lexical path for repeated builds. */
function compareDescendantPages(layoutDirectory: string, left: string, right: string): number {
  return (
    readDescendantDepth(layoutDirectory, left) - readDescendantDepth(layoutDirectory, right) ||
    left.localeCompare(right)
  );
}

/** Counts filesystem segments between the selected shell and one ordinary page leaf. */
function readDescendantDepth(layoutDirectory: string, sourcePath: string): number {
  return path.relative(layoutDirectory, path.dirname(sourcePath)).split(path.sep).filter(Boolean)
    .length;
}

/**
 * Preserves route proximity, then prefers the cheaper analyzed page inside the bounded shortlist.
 *
 * Unread candidates retain their prior lexical position behind the shortlist. This makes the new
 * policy useful for large sibling sets without turning candidate discovery into an unbounded file
 * scan or claiming that an unread page is more expensive than a measured one.
 */
function compareCostedDescendantPages(
  layoutDirectory: string,
  left: DescendantPageEvidence,
  right: DescendantPageEvidence,
  costByPath: ReadonlyMap<string, DescendantPageCost>,
): number {
  const depthDifference =
    readDescendantDepth(layoutDirectory, left.pagePath) -
    readDescendantDepth(layoutDirectory, right.pagePath);
  if (depthDifference !== 0) return depthDifference;
  const leftCost = costByPath.get(path.normalize(left.pagePath));
  const rightCost = costByPath.get(path.normalize(right.pagePath));
  if (leftCost !== undefined && rightCost !== undefined) {
    return leftCost.score - rightCost.score || left.pagePath.localeCompare(right.pagePath);
  }
  if (leftCost !== undefined) return -1;
  if (rightCost !== undefined) return 1;
  return left.pagePath.localeCompare(right.pagePath);
}

/**
 * Estimates the amount of work a page is likely to add before any transitive module is opened.
 *
 * Source bytes approximate parse cost, each runtime import approximates one graph edge, and broad
 * generated registry/catalog imports receive a larger fan-out penalty. Values are saturated so a
 * pathological editor snapshot cannot overflow the deterministic numeric comparison.
 */
function estimateDescendantPageCost(
  sourcePath: string,
  source: string | undefined,
): DescendantPageCost | undefined {
  if (source === undefined) return undefined;
  const sourceBytes = Math.min(Buffer.byteLength(source, 'utf8'), MAXIMUM_COST_SOURCE_BYTES);
  const moduleSpecifiers = collectRuntimeModuleSpecifiers(
    sourcePath,
    source.slice(0, MAXIMUM_COST_PARSE_CHARACTERS),
  );
  const importCount = Math.min(moduleSpecifiers.length, MAXIMUM_COST_IMPORTS);
  const broadModuleCount = Math.min(
    moduleSpecifiers.filter(isBroadGeneratedModuleSpecifier).length,
    MAXIMUM_COST_IMPORTS,
  );
  return {
    broadModuleCount,
    importCount,
    score:
      sourceBytes +
      importCount * IMPORT_EDGE_COST_BYTES +
      broadModuleCount * BROAD_MODULE_COST_BYTES,
    sourceBytes,
  };
}

/** Collects bounded runtime import/export/require edges without resolving or executing modules. */
function collectRuntimeModuleSpecifiers(sourcePath: string, source: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    selectPageScriptKind(sourcePath),
  );
  const specifiers: string[] = [];
  const addSpecifier = (specifier: ts.Expression | undefined): void => {
    if (
      specifiers.length >= MAXIMUM_COST_IMPORTS ||
      specifier === undefined ||
      (!ts.isStringLiteral(specifier) && !ts.isNoSubstitutionTemplateLiteral(specifier))
    ) {
      return;
    }
    specifiers.push(specifier.text);
  };
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && importDeclarationHasRuntimeValue(statement)) {
      addSpecifier(statement.moduleSpecifier);
    } else if (ts.isExportDeclaration(statement) && exportDeclarationHasRuntimeValue(statement)) {
      addSpecifier(statement.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      !ts.isTypeOnlyImportDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      addSpecifier(statement.moduleReference.expression);
    }
  }
  const visitCalls = (node: ts.Node): void => {
    if (specifiers.length >= MAXIMUM_COST_IMPORTS) return;
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      addSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visitCalls);
  };
  ts.forEachChild(sourceFile, visitCalls);
  return specifiers;
}

/** Ignores erased type-only declarations while retaining side-effect and mixed imports. */
function importDeclarationHasRuntimeValue(statement: ts.ImportDeclaration): boolean {
  const clause = statement.importClause;
  if (clause === undefined) return true;
  if (ts.isTypeOnlyImportDeclaration(statement)) return false;
  if (clause.name !== undefined) return true;
  const namedBindings = clause.namedBindings;
  if (namedBindings === undefined || ts.isNamespaceImport(namedBindings)) return true;
  return (
    namedBindings.elements.length === 0 ||
    namedBindings.elements.some((element) => !element.isTypeOnly)
  );
}

/** Ignores an erased type-only re-export while retaining side-effecting export-from edges. */
function exportDeclarationHasRuntimeValue(statement: ts.ExportDeclaration): boolean {
  if (ts.isTypeOnlyExportDeclaration(statement) || statement.moduleSpecifier === undefined) {
    return false;
  }
  const clause = statement.exportClause;
  if (clause === undefined || ts.isNamespaceExport(clause)) return true;
  return clause.elements.length === 0 || clause.elements.some((element) => !element.isTypeOnly);
}

/** Recognizes general generated inventory names without depending on one repository's paths. */
function isBroadGeneratedModuleSpecifier(specifier: string): boolean {
  const cleanSpecifier = specifier.split(/[?#]/u, 1)[0] ?? specifier;
  return cleanSpecifier
    .split(/[\\/]/u)
    .map((segment) => segment.replace(/\.[cm]?[jt]sx?$/iu, ''))
    .some((segment) => BROAD_MODULE_SEGMENT_PATTERN.test(segment));
}

/** Selects the TypeScript parser grammar from the conventional App Router page extension. */
function selectPageScriptKind(sourcePath: string): ts.ScriptKind {
  const extension = path.extname(sourcePath).toLowerCase();
  if (extension === '.tsx') return ts.ScriptKind.TSX;
  if (extension === '.jsx') return ts.ScriptKind.JSX;
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}
