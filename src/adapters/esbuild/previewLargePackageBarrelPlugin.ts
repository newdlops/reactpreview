/**
 * Narrows very large, side-effect-free package barrels to the exact named exports one importer uses.
 * The optimization is evidence driven: the package manifest, root ESM barrel, public export map,
 * physical leaf file, and esbuild's own deep-subpath resolution must all agree before substitution.
 */
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import ts from 'typescript';
import { canonicalizeExistingPath } from '../../shared/pathIdentity';
import { PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';
import { resolvePreviewYarnVirtualPath } from './previewYarnVirtualPath';

const LARGE_BARREL_NAMESPACE = 'react-preview-large-package-barrel';
const PACKAGE_ROOT_PATTERN = /^(?:@[^/]+\/[^/]+|[^./][^/]*)$/;
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024;
const MAXIMUM_BARREL_BYTES = 4 * 1024 * 1024;
const MAXIMUM_PACKAGE_ANCESTORS = 12;
const MAXIMUM_EXPORT_TREE_NODES = 512;
const MINIMUM_LARGE_BARREL_EXPORTS = 256;

/** Reads unsaved importers before using the filesystem copy. */
export interface PreviewLargePackageBarrelPluginOptions {
  /** Returns the current editor snapshot for a project source when one exists. */
  readonly readSource?: (sourcePath: string) => string | undefined;
  /** Trusted workspace used only to restore Yarn virtual importer identities. */
  readonly workspaceRoot: string;
}

/** Runtime import demand proven from one authored importer. */
interface NamedImportDemand {
  /** Runtime export names requested from the exact package root. */
  readonly exportNames: readonly string[];
  /** Whether default, namespace, dynamic, require, side-effect, or re-export syntax was present. */
  readonly safe: boolean;
}

/** One direct named re-export in the package's root ESM barrel. */
interface BarrelExportMapping {
  /** Binding name exported by the physical leaf module. */
  readonly importedName: string;
  /** Package-root public name requested by project source. */
  readonly publicName: string;
  /** Canonical physical file selected by the root barrel. */
  readonly sourcePath: string;
}

/** Inert package evidence retained only for the current esbuild rebuild. */
interface LargePackageBarrelEvidence {
  /** Direct unique public-name mappings from the root ESM barrel. */
  readonly mappingsByName: ReadonlyMap<string, BarrelExportMapping>;
  /** Parsed manifest containing the public subpath export contract. */
  readonly manifest: LargePackageManifest;
  /** Canonical package root containing both manifest and runtime files. */
  readonly packageRoot: string;
  /** Root barrel watched so a package update invalidates the virtual projection. */
  readonly rootEntryPath: string;
}

/** Bounded package manifest fields required by the proof. */
interface LargePackageManifest {
  readonly exports?: unknown;
  readonly name?: unknown;
  readonly sideEffects?: unknown;
}

/** One public export key and runtime target pattern extracted without executing package code. */
interface PackageSubpathPattern {
  readonly key: string;
  readonly target: string;
}

/** Validated mapping transported to the private virtual module loader. */
interface ResolvedBarrelProjection {
  readonly importedName: string;
  readonly publicName: string;
  readonly sourcePath: string;
  readonly specifier: string;
}

/** Private immutable data associated with one importer-scoped projection. */
interface LargeBarrelPluginData {
  readonly manifestPath: string;
  readonly mappings: readonly ResolvedBarrelProjection[];
  readonly rootEntryPath: string;
}

/**
 * Creates a fail-closed optimizer for enormous ESM package barrels.
 *
 * Only ordinary named import statements are eligible. A package must declare `sideEffects: false`,
 * expose at least 256 direct named re-exports, and publicly export a deep subpath that esbuild resolves
 * to the same physical leaf. Any uncertainty returns `undefined` and preserves normal root bundling.
 */
export function createPreviewLargePackageBarrelPlugin(
  options: PreviewLargePackageBarrelPluginOptions,
): Plugin {
  const workspaceRoot = canonicalizeExistingPath(options.workspaceRoot);
  let demandByImporter = new Map<string, NamedImportDemand>();
  let evidenceByEntry = new Map<string, Promise<LargePackageBarrelEvidence | undefined>>();
  let resolvedMappingByIdentity = new Map<string, Promise<ResolvedBarrelProjection | undefined>>();

  return {
    name: 'react-preview-large-package-barrel',
    setup(build): void {
      /** Package files and editor imports may change between persistent-context rebuilds. */
      build.onStart(() => {
        demandByImporter = new Map<string, NamedImportDemand>();
        evidenceByEntry = new Map<string, Promise<LargePackageBarrelEvidence | undefined>>();
        resolvedMappingByIdentity = new Map<
          string,
          Promise<ResolvedBarrelProjection | undefined>
        >();
      });

      /** Replaces one safe named root import with an importer-scoped deep-subpath projection. */
      async function resolveLargeBarrel(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (!isEligibleRootImport(arguments_)) return undefined;
        const importerPath = resolvePreviewYarnVirtualPath(arguments_.importer, workspaceRoot);
        if (importerPath === undefined) return undefined;
        const demandKey = `${sourceIdentity(importerPath)}\0${arguments_.path}`;
        let demand = demandByImporter.get(demandKey);
        if (demand === undefined) {
          demand = await readNamedImportDemand(importerPath, arguments_.path, options.readSource);
          demandByImporter.set(demandKey, demand);
        }
        if (!demand.safe || demand.exportNames.length === 0) return undefined;

        const rootResolution = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
          with: arguments_.with,
        });
        if (
          rootResolution.errors.length > 0 ||
          rootResolution.external ||
          rootResolution.namespace !== 'file'
        ) {
          return undefined;
        }
        const physicalEntry = resolvePreviewYarnVirtualPath(rootResolution.path, workspaceRoot);
        if (physicalEntry === undefined) return undefined;
        const entryIdentity = sourceIdentity(physicalEntry);
        let evidencePromise = evidenceByEntry.get(entryIdentity);
        if (evidencePromise === undefined) {
          evidencePromise = analyzeLargePackageBarrel(physicalEntry, arguments_.path);
          evidenceByEntry.set(entryIdentity, evidencePromise);
        }
        const evidence = await evidencePromise;
        if (evidence === undefined) return undefined;

        const mappings = await Promise.all(
          demand.exportNames.map(async (exportName) => {
            const mappingIdentity = `${entryIdentity}\0${exportName}`;
            let mappingPromise = resolvedMappingByIdentity.get(mappingIdentity);
            if (mappingPromise === undefined) {
              mappingPromise = resolveBarrelProjection(
                build,
                arguments_,
                evidence,
                exportName,
                workspaceRoot,
              );
              resolvedMappingByIdentity.set(mappingIdentity, mappingPromise);
            }
            return await mappingPromise;
          }),
        );
        if (mappings.some((mapping) => mapping === undefined)) return undefined;
        const projections = mappings as ResolvedBarrelProjection[];
        const manifestPath = path.join(evidence.packageRoot, 'package.json');
        return {
          namespace: LARGE_BARREL_NAMESPACE,
          path: createProjectionIdentity(importerPath, arguments_.path, projections),
          pluginData: {
            manifestPath,
            mappings: projections,
            rootEntryPath: evidence.rootEntryPath,
          } satisfies LargeBarrelPluginData,
          sideEffects: false,
        };
      }

      /** Emits only direct public deep imports, keeping every selected package leaf authentic. */
      function loadLargeBarrel(arguments_: OnLoadArgs): OnLoadResult {
        const data = readLargeBarrelPluginData(arguments_.pluginData);
        if (data === undefined) {
          return { errors: [{ text: 'React Preview lost large-barrel projection metadata.' }] };
        }
        return {
          contents: data.mappings
            .map(
              (mapping) =>
                `export { ${formatExportBinding(mapping.importedName, mapping.publicName)} } from ${JSON.stringify(mapping.specifier)};`,
            )
            .join('\n'),
          loader: 'js',
          resolveDir: path.dirname(data.rootEntryPath),
          watchFiles: [
            data.manifestPath,
            data.rootEntryPath,
            ...data.mappings.map((mapping) => mapping.sourcePath),
          ],
        };
      }

      build.onResolve({ filter: PACKAGE_ROOT_PATTERN }, resolveLargeBarrel);
      build.onLoad({ filter: /.*/, namespace: LARGE_BARREL_NAMESPACE }, loadLargeBarrel);
    },
  };
}

/** Restricts the optimization to a package-root ESM named import. */
function isEligibleRootImport(arguments_: OnResolveArgs): boolean {
  return (
    arguments_.namespace === 'file' &&
    arguments_.kind === 'import-statement' &&
    (arguments_.pluginData as unknown) !== PREVIEW_RESOLVE_GUARD &&
    arguments_.importer.length > 0 &&
    PACKAGE_ROOT_PATTERN.test(arguments_.path)
  );
}

/** Reads and parses one importer without retaining its source beyond this rebuild's small demand. */
async function readNamedImportDemand(
  importerPath: string,
  packageName: string,
  readSource: PreviewLargePackageBarrelPluginOptions['readSource'],
): Promise<NamedImportDemand> {
  let sourceText: string;
  try {
    sourceText = readSource?.(importerPath) ?? (await readFile(importerPath, 'utf8'));
  } catch {
    return { exportNames: [], safe: false };
  }
  const sourceFile = ts.createSourceFile(importerPath, sourceText, ts.ScriptTarget.Latest, false);
  const exportNames = new Set<string>();
  let safe = true;
  const visit = (node: ts.Node): void => {
    if (!safe) return;
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === packageName
    ) {
      const importClause = node.importClause;
      if (
        importClause === undefined ||
        importClause.name !== undefined ||
        importClause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
        importClause.namedBindings === undefined ||
        !ts.isNamedImports(importClause.namedBindings) ||
        node.attributes !== undefined
      ) {
        safe = false;
        return;
      }
      for (const element of importClause.namedBindings.elements) {
        if (!element.isTypeOnly) exportNames.add(element.propertyName?.text ?? element.name.text);
      }
      return;
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      node.moduleSpecifier.text === packageName
    ) {
      safe = false;
      return;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression) &&
      node.moduleReference.expression.text === packageName
    ) {
      safe = false;
      return;
    }
    if (ts.isCallExpression(node) && isDynamicPackageLoad(node, packageName)) {
      safe = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { exportNames: [...exportNames].sort(), safe };
}

/** Detects dynamic import and CommonJS require calls for the exact package root. */
function isDynamicPackageLoad(node: ts.CallExpression, packageName: string): boolean {
  const argument = node.arguments[0];
  if (
    argument === undefined ||
    !ts.isStringLiteralLike(argument) ||
    argument.text !== packageName
  ) {
    return false;
  }
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) && node.expression.text === 'require')
  );
}

/** Builds a unique direct-export index only for a large, side-effect-free package root barrel. */
async function analyzeLargePackageBarrel(
  rootEntryPath: string,
  expectedPackageName: string,
): Promise<LargePackageBarrelEvidence | undefined> {
  const canonicalEntry = canonicalizeExistingPath(rootEntryPath);
  const packageRecord = await findOwningPackage(canonicalEntry, expectedPackageName);
  if (packageRecord?.manifest.sideEffects !== false) return undefined;
  let sourceText: string;
  try {
    const entryStat = await stat(canonicalEntry);
    if (!entryStat.isFile() || entryStat.size > MAXIMUM_BARREL_BYTES) return undefined;
    sourceText = await readFile(canonicalEntry, 'utf8');
  } catch {
    return undefined;
  }
  const sourceFile = ts.createSourceFile(canonicalEntry, sourceText, ts.ScriptTarget.Latest, false);
  const mappingsByName = new Map<string, BarrelExportMapping>();
  const ambiguousNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause) ||
      statement.moduleSpecifier === undefined ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith('.')
    ) {
      continue;
    }
    const sourcePath = resolveBarrelLeafPath(
      path.dirname(canonicalEntry),
      statement.moduleSpecifier.text,
      packageRecord.packageRoot,
    );
    if (sourcePath === undefined) continue;
    for (const element of statement.exportClause.elements) {
      // ECMAScript also permits quoted export names. They require a different generated syntax,
      // so this narrowly optimized path leaves them on the authentic root barrel.
      if (
        element.isTypeOnly ||
        !ts.isIdentifier(element.name) ||
        (element.propertyName !== undefined && !ts.isIdentifier(element.propertyName))
      ) {
        continue;
      }
      const publicName = element.name.text;
      const mapping = {
        importedName: element.propertyName?.text ?? publicName,
        publicName,
        sourcePath,
      } satisfies BarrelExportMapping;
      const existing = mappingsByName.get(publicName);
      if (
        existing !== undefined &&
        (existing.importedName !== mapping.importedName ||
          existing.sourcePath !== mapping.sourcePath)
      ) {
        ambiguousNames.add(publicName);
        mappingsByName.delete(publicName);
      } else if (!ambiguousNames.has(publicName)) {
        mappingsByName.set(publicName, mapping);
      }
    }
  }
  if (mappingsByName.size < MINIMUM_LARGE_BARREL_EXPORTS) return undefined;
  return {
    mappingsByName,
    manifest: packageRecord.manifest,
    packageRoot: packageRecord.packageRoot,
    rootEntryPath: canonicalEntry,
  };
}

/** Package root and manifest proven by a matching bounded package.json ancestor. */
interface OwningPackageRecord {
  readonly manifest: LargePackageManifest;
  readonly packageRoot: string;
}

/** Finds the exact package manifest without crossing an unbounded ancestry. */
async function findOwningPackage(
  entryPath: string,
  packageName: string,
): Promise<OwningPackageRecord | undefined> {
  let directory = path.dirname(entryPath);
  for (let depth = 0; depth <= MAXIMUM_PACKAGE_ANCESTORS; depth += 1) {
    const manifestPath = path.join(directory, 'package.json');
    try {
      const manifestStat = await stat(manifestPath);
      if (manifestStat.isFile() && manifestStat.size <= MAXIMUM_MANIFEST_BYTES) {
        const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (isUnknownRecord(parsed) && parsed.name === packageName) {
          return { manifest: parsed, packageRoot: canonicalizeExistingPath(directory) };
        }
      }
    } catch {
      // Missing or malformed ancestors are not package proof; continue toward node_modules root.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/** Resolves one relative ESM leaf and rejects absent files or package-root escapes. */
function resolveBarrelLeafPath(
  barrelDirectory: string,
  moduleSpecifier: string,
  packageRoot: string,
): string | undefined {
  const candidate = path.resolve(barrelDirectory, moduleSpecifier);
  const canonicalCandidate = canonicalizeExistingPath(candidate);
  return isPathInside(packageRoot, canonicalCandidate) && ts.sys.fileExists(canonicalCandidate)
    ? canonicalCandidate
    : undefined;
}

/** Proves a public deep specifier whose active esbuild conditions select the exact barrel leaf. */
async function resolveBarrelProjection(
  build: Parameters<Plugin['setup']>[0],
  arguments_: OnResolveArgs,
  evidence: LargePackageBarrelEvidence,
  exportName: string,
  workspaceRoot: string,
): Promise<ResolvedBarrelProjection | undefined> {
  const mapping = evidence.mappingsByName.get(exportName);
  if (mapping === undefined) return undefined;
  const candidates = derivePublicDeepSpecifiers(
    arguments_.path,
    evidence.packageRoot,
    mapping.sourcePath,
    evidence.manifest.exports,
  );
  const confirmedSpecifiers: string[] = [];
  for (const specifier of candidates) {
    const resolution = await build.resolve(specifier, {
      importer: arguments_.importer,
      kind: 'import-statement',
      namespace: 'file',
      pluginData: PREVIEW_RESOLVE_GUARD,
      resolveDir: arguments_.resolveDir,
    });
    const physicalResolution =
      resolution.errors.length === 0 && resolution.namespace === 'file' && !resolution.external
        ? resolvePreviewYarnVirtualPath(resolution.path, workspaceRoot)
        : undefined;
    if (
      physicalResolution !== undefined &&
      sourceIdentity(physicalResolution) === sourceIdentity(mapping.sourcePath)
    ) {
      confirmedSpecifiers.push(specifier);
    }
  }
  // More than one public spelling for the same leaf is intentionally not guessed. Besides making
  // the generated module deterministic, this prevents an alias export from silently becoming the
  // canonical package API when package authors expose overlapping wildcard patterns.
  const [confirmedSpecifier, duplicateSpecifier] = confirmedSpecifiers;
  return confirmedSpecifier !== undefined && duplicateSpecifier === undefined
    ? { ...mapping, specifier: confirmedSpecifier }
    : undefined;
}

/** Inverts public export targets to candidate subpaths for one exact physical leaf. */
function derivePublicDeepSpecifiers(
  packageName: string,
  packageRoot: string,
  sourcePath: string,
  exportsField: unknown,
): readonly string[] {
  const relativeLeaf = `./${path.relative(packageRoot, sourcePath).replaceAll(path.sep, '/')}`;
  const subpaths = new Set<string>();
  for (const pattern of collectPackageSubpathPatterns(exportsField)) {
    const capture = matchSingleWildcardPattern(pattern.target, relativeLeaf);
    if (capture === undefined) continue;
    const subpath = substituteSingleWildcard(pattern.key, capture);
    if (subpath === undefined || !subpath.startsWith('./') || subpath === '.') continue;
    subpaths.add(`${packageName}/${subpath.slice(2)}`);
  }
  return [...subpaths].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  );
}

/** Extracts bounded subpath/target pairs from inert conditional package exports. */
function collectPackageSubpathPatterns(exportsField: unknown): readonly PackageSubpathPattern[] {
  if (!isUnknownRecord(exportsField)) return [];
  const output: PackageSubpathPattern[] = [];
  let visited = 0;
  const collectTargets = (key: string, value: unknown): void => {
    if (visited >= MAXIMUM_EXPORT_TREE_NODES) return;
    visited += 1;
    if (typeof value === 'string') {
      if (value.startsWith('./')) output.push({ key, target: value });
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) collectTargets(key, child);
      return;
    }
    if (!isUnknownRecord(value)) return;
    for (const [condition, child] of Object.entries(value)) {
      if (condition !== 'types') collectTargets(key, child);
    }
  };
  for (const [key, value] of Object.entries(exportsField)) {
    if (key.startsWith('./') && key !== '.') collectTargets(key, value);
  }
  return output;
}

/** Matches exact or single-wildcard package target patterns. */
function matchSingleWildcardPattern(pattern: string, value: string): string | undefined {
  const wildcard = pattern.indexOf('*');
  if (wildcard < 0) return pattern === value ? '' : undefined;
  if (pattern.slice(wildcard + 1).includes('*')) return undefined;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return undefined;
  return value.slice(prefix.length, value.length - suffix.length);
}

/** Applies one capture to an exact or single-wildcard public export key. */
function substituteSingleWildcard(pattern: string, capture: string): string | undefined {
  const wildcard = pattern.indexOf('*');
  if (wildcard < 0) return capture.length === 0 ? pattern : undefined;
  if (pattern.slice(wildcard + 1).includes('*')) return undefined;
  return `${pattern.slice(0, wildcard)}${capture}${pattern.slice(wildcard + 1)}`;
}

/** Formats one ESM re-export binding without changing alias semantics. */
function formatExportBinding(importedName: string, publicName: string): string {
  return importedName === publicName ? publicName : `${importedName} as ${publicName}`;
}

/** Produces a stable private identity for one importer/package/export projection. */
function createProjectionIdentity(
  importerPath: string,
  packageName: string,
  mappings: readonly ResolvedBarrelProjection[],
): string {
  const digest = createHash('sha256')
    .update(importerPath)
    .update('\0')
    .update(packageName)
    .update('\0')
    .update(mappings.map((mapping) => mapping.publicName).join('\0'))
    .digest('hex')
    .slice(0, 24);
  return `${packageName}/${digest}.js`;
}

/** Validates plugin-private load data before using any filesystem path. */
function readLargeBarrelPluginData(value: unknown): LargeBarrelPluginData | undefined {
  if (!isUnknownRecord(value) || !Array.isArray(value.mappings)) return undefined;
  const mappings = value.mappings;
  return typeof value.manifestPath === 'string' &&
    typeof value.rootEntryPath === 'string' &&
    mappings.every(
      (mapping) =>
        isUnknownRecord(mapping) &&
        typeof mapping.importedName === 'string' &&
        typeof mapping.publicName === 'string' &&
        typeof mapping.sourcePath === 'string' &&
        typeof mapping.specifier === 'string',
    )
    ? (value as unknown as LargeBarrelPluginData)
    : undefined;
}

/** Returns a path identity stable across macOS aliases and Yarn virtual package paths. */
function sourceIdentity(sourcePath: string): string {
  return path.normalize(canonicalizeExistingPath(sourcePath));
}

/** Checks canonical containment without accepting sibling-prefix paths. */
function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return (
    relativePath.length === 0 ||
    (relativePath !== '..' &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

/** Narrows unknown JSON or plugin data to a property-bearing record. */
function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
