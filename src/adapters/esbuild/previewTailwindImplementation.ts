/**
 * Loads a project or managed-store Tailwind implementation without evaluating project-authored
 * configuration. Kept separate from the esbuild plugin so package loading policy remains small,
 * testable, and independent from CSS graph traversal.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  findPreviewDependencySpecifier,
  type PreviewDependencyProfile,
} from '../node/previewDependencyProfile';
import type {
  PreviewTailwindScannerConstructor,
  PreviewTailwindSnapshotSource,
} from './previewTailwindCandidates';
import { readPreviewTailwindStaticConfig } from './previewTailwindStaticConfig';

/** Project-anchored CommonJS resolver returned by Node's `createRequire`. */
type PreviewProjectRequire = ReturnType<typeof createRequire>;

const PROJECT_SOURCE_EXTENSIONS = 'html,js,jsx,md,mdx,ts,tsx,vue,svelte';
const PROBE_MARKUP = '<div class="flex"></div>';
const PROBE_UTILITY_PATTERN = /\.flex\b[^{]*\{[^}]*display:\s*flex/u;

/**
 * Known ways to compile Tailwind; adapter learning chooses among these, never invents one.
 * `v4-postcss` passes unsaved-editor classes through `@source inline(...)` (Tailwind 4.1+);
 * `v4-postcss-scan` relies on the adapter's own file scan, which every v4 release supports.
 */
export type PreviewTailwindStrategy =
  'legacy-content' | 'legacy-purge' | 'v4-postcss' | 'v4-postcss-scan';

/** Minimal PostCSS message fields used for bounded dependency and directory watching. */
export interface PreviewPostcssMessage {
  /** Filesystem directory reported by a `dir-dependency` message. */
  readonly dir?: unknown;
  /** Filesystem dependency reported by Tailwind's processor. */
  readonly file?: unknown;
  /** PostCSS result message kind. */
  readonly type?: unknown;
}

/** Structural PostCSS result returned by supported project-local releases. */
export interface PreviewPostcssResult {
  /** Fully transformed CSS. */
  readonly css: string;
  /** Optional dependency messages emitted by Tailwind. */
  readonly messages?: readonly PreviewPostcssMessage[];
}

/** Structural PostCSS processor kept independent from any project package's type declarations. */
export interface PreviewPostcssProcessor {
  /** Processes one stylesheet while retaining its original filesystem identity. */
  process(source: string, options: { readonly from: string }): Promise<PreviewPostcssResult>;
}

/** Loaded implementation and the policy required to instantiate one safe processor. */
export interface PreviewTailwindImplementation {
  /** Adapter generation selected from exact installed packages. */
  readonly kind: 'legacy' | 'v4';
  /** Optional native scanner paired with the v4 adapter. */
  readonly Scanner?: PreviewTailwindScannerConstructor;
  /** Creates a processor for the current bounded dirty-source inventory. */
  createProcessor(
    snapshotSources: readonly PreviewTailwindSnapshotSource[],
  ): PreviewPostcssProcessor;
  /** Statically read configuration files and the keys left out of the last processor. */
  readConfigEvidence?(): {
    readonly dependencyPaths: readonly string[];
    readonly skipped: readonly string[];
  };
  /** Strategy this implementation uses, for adapter learning. */
  readonly strategy?: PreviewTailwindStrategy;
  /** Whether unsaved-editor class candidates may be appended as `@source inline(...)`. */
  readonly inlineSources?: boolean;
  /** Compiles a fixed one-utility probe; `true` when the strategy produced `.flex`. */
  selfTest?(): Promise<boolean>;
}

/** Loadable strategies of one package graph, in rule order, plus learning identity. */
export interface PreviewTailwindStrategyCandidates {
  /** Static package-metadata features of the installed `tailwindcss` package. */
  readonly features: readonly number[];
  /** Rule-ordered implementations; the first is what the version rules alone would use. */
  readonly implementations: readonly PreviewTailwindImplementation[];
  /** Exact `tailwindcss@version` identity. */
  readonly packageKey: string;
}

/**
 * Chooses the Tailwind compiler package to acquire into the managed dependency store when the
 * project declares Tailwind with lockfile evidence but has no installed copy (for example when
 * dependencies come only from the managed store). Tailwind v4 compiles through its PostCSS
 * adapter package; v2/v3 compile through the `tailwindcss` package itself, whose export is the
 * PostCSS plugin. The declared range decides, so a project upgrade changes the acquired version
 * without a preview update.
 *
 * @param profile Project manifest and lock evidence.
 * @returns Package name to acquire, or `undefined` when nothing should be acquired.
 */
export function selectPreviewTailwindCompilerPackage(
  profile: PreviewDependencyProfile | undefined,
): string | undefined {
  if (profile?.hasReusableLockEvidence !== true) return undefined;
  if (findPreviewDependencySpecifier(profile, '@tailwindcss/postcss') !== undefined) {
    return '@tailwindcss/postcss';
  }
  const declared = findPreviewDependencySpecifier(profile, 'tailwindcss');
  const major = declared === undefined ? undefined : /\d+/u.exec(declared)?.[0];
  return major !== undefined && Number(major) < 4 ? 'tailwindcss' : undefined;
}

/**
 * Loads v4 first, then a v2/v3 fallback whose configuration is read as data, from each trusted
 * package graph.
 *
 * @param styleRoot Package directory that owns the stylesheet and its Tailwind configuration.
 * @param fallbackNodeModulesPaths Managed dependency roots tried after the project's own packages.
 * @param configBoundaryRoot Workspace directory that configuration token modules must stay inside.
 * @returns Loaded implementation, or `undefined` when no Tailwind compiler is installed.
 */
export function loadPreviewTailwindImplementation(
  styleRoot: string,
  fallbackNodeModulesPaths: readonly string[] = [],
  configBoundaryRoot: string = styleRoot,
): PreviewTailwindImplementation | undefined {
  return collectPreviewTailwindStrategyCandidates(
    styleRoot,
    fallbackNodeModulesPaths,
    configBoundaryRoot,
  )?.implementations[0];
}

/**
 * Loads every known strategy from the first package graph that has a Tailwind compiler.
 *
 * @param styleRoot Package directory that owns the stylesheet and its Tailwind configuration.
 * @param fallbackNodeModulesPaths Managed dependency roots tried after the project's own packages.
 * @param configBoundaryRoot Workspace directory that configuration token modules must stay inside.
 * @returns Rule-ordered implementations with the package identity, or `undefined` without Tailwind.
 */
export function collectPreviewTailwindStrategyCandidates(
  styleRoot: string,
  fallbackNodeModulesPaths: readonly string[] = [],
  configBoundaryRoot: string = styleRoot,
): PreviewTailwindStrategyCandidates | undefined {
  const packageResolvers = [
    createRequire(path.join(styleRoot, 'package.json')),
    ...fallbackNodeModulesPaths.map((nodeModulesPath) =>
      createRequire(path.join(nodeModulesPath, '__react_preview_tailwind__.js')),
    ),
  ];
  for (const packageResolver of packageResolvers) {
    const v4Inline = loadTailwindV4Implementation(packageResolver, styleRoot, true);
    const v4Scan =
      v4Inline === undefined
        ? undefined
        : loadTailwindV4Implementation(packageResolver, styleRoot, false);
    const legacy = loadLegacyTailwindImplementation(packageResolver, styleRoot, configBoundaryRoot);
    if (v4Inline === undefined && legacy === undefined) continue;
    const alternateLegacy =
      legacy === undefined
        ? undefined
        : loadLegacyTailwindImplementation(
            packageResolver,
            styleRoot,
            configBoundaryRoot,
            legacy.strategy === 'legacy-content' ? 'purge' : 'content',
          );
    const identity = readTailwindPackageIdentity(packageResolver, v4Inline !== undefined);
    // `@source inline` arrived in Tailwind 4.1; earlier v4 releases fail the whole stylesheet on it.
    // The adapter is released in lockstep with `tailwindcss`, so its version also identifies 4.0.
    const v4Version =
      identity?.packageKey.split('@')[1] ??
      readInstalledPackageVersion(packageResolver, '@tailwindcss/postcss');
    const [major = 0, minor = 0] = (v4Version ?? '').split('.').map((part) => Number(part) || 0);
    const v4 = major === 4 && minor < 1 ? [v4Scan, v4Inline] : [v4Inline, v4Scan];
    return {
      features: identity?.features ?? [],
      implementations: [...v4, legacy, alternateLegacy].filter(
        (implementation): implementation is PreviewTailwindImplementation =>
          implementation !== undefined,
      ),
      packageKey: identity?.packageKey ?? 'tailwindcss@unknown',
    };
  }
  return undefined;
}

/** Reads one installed package's manifest version without executing the package. */
function readInstalledPackageVersion(
  packageResolver: PreviewProjectRequire,
  packageName: string,
): string | undefined {
  try {
    const manifestPath = findOwningPackageManifest(
      packageResolver.resolve(packageName),
      packageName,
    );
    if (manifestPath === undefined) return undefined;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the installed `tailwindcss` version and static layout features without executing it.
 * Features: major/10, minor/50, style entry, root `index.css`, `lib/index.js`, a `postcss`
 * dependency, and whether the v4 PostCSS adapter is installed beside it.
 */
function readTailwindPackageIdentity(
  packageResolver: PreviewProjectRequire,
  adapterAvailable: boolean,
): { readonly features: readonly number[]; readonly packageKey: string } | undefined {
  try {
    const manifestPath = findOwningPackageManifest(
      packageResolver.resolve('tailwindcss'),
      'tailwindcss',
    );
    if (manifestPath === undefined) return undefined;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    const [major = 0, minor = 0] = version.split(/[.-]/u).map((part) => Number(part) || 0);
    const root = path.dirname(manifestPath);
    const exportsField = manifest.exports;
    const dotExport =
      typeof exportsField === 'object' && exportsField !== null
        ? (exportsField as Record<string, unknown>)['.']
        : undefined;
    const styleEntry =
      typeof manifest.style === 'string' ||
      (typeof dotExport === 'object' &&
        dotExport !== null &&
        typeof (dotExport as Record<string, unknown>).style === 'string');
    const dependencies =
      typeof manifest.dependencies === 'object' && manifest.dependencies !== null
        ? (manifest.dependencies as Record<string, unknown>)
        : {};
    return {
      features: [
        Math.min(1, major / 10),
        Math.min(1, minor / 50),
        styleEntry ? 1 : 0,
        existsSync(path.join(root, 'index.css')) ? 1 : 0,
        existsSync(path.join(root, 'lib', 'index.js')) ? 1 : 0,
        'postcss' in dependencies ? 1 : 0,
        adapterAvailable ? 1 : 0,
      ],
      packageKey: `tailwindcss@${version}`,
    };
  } catch {
    return undefined;
  }
}

/** Loads Tailwind v4's canonical adapter and its own PostCSS/Oxide dependencies by exact issuer. */
function loadTailwindV4Implementation(
  projectRequire: PreviewProjectRequire,
  styleRoot: string,
  inlineSources: boolean,
): PreviewTailwindImplementation | undefined {
  try {
    const adapterPath = projectRequire.resolve('@tailwindcss/postcss');
    const adapterRequire = createRequire(adapterPath);
    const postcss = readCallableExport(adapterRequire('postcss'));
    const loadFreshAdapter = (): ((...arguments_: unknown[]) => unknown) | undefined => {
      // Tailwind v4's adapter keeps a compiler LRU keyed only by stylesheet identity. Dirty source
      // candidates are in memory, so retire exactly the adapter module for each preview CSS load.
      Reflect.deleteProperty(adapterRequire.cache, adapterPath);
      return readCallableExport(adapterRequire(adapterPath));
    };
    let initialTailwind = loadFreshAdapter();
    if (postcss === undefined || initialTailwind === undefined) return undefined;
    const Scanner = readScannerConstructor(safeRequire(adapterRequire, '@tailwindcss/oxide'));
    return {
      kind: 'v4',
      inlineSources,
      strategy: inlineSources ? 'v4-postcss' : 'v4-postcss-scan',
      ...(Scanner === undefined ? {} : { Scanner }),
      selfTest: async () => {
        // The inline variant must produce the utility from `@source inline` alone; the scan variant
        // from a probe file in the scanned base directory.
        const directory = mkdtempSync(path.join(tmpdir(), 'react-preview-tailwind-probe-'));
        try {
          if (!inlineSources)
            writeFileSync(path.join(directory, 'probe.html'), PROBE_MARKUP, 'utf8');
          const tailwind = loadFreshAdapter();
          if (tailwind === undefined) return false;
          const stylePath = adapterRequire.resolve('tailwindcss/index.css');
          const source = `@import ${JSON.stringify(stylePath)};${inlineSources ? '\n@source inline("flex");' : ''}`;
          const result = await readPostcssProcessor(
            postcss([tailwind({ base: directory, optimize: false })]),
          ).process(source, { from: path.join(directory, 'probe.css') });
          return PROBE_UTILITY_PATTERN.test(result.css);
        } finally {
          rmSync(directory, { force: true, recursive: true });
        }
      },
      createProcessor: () => {
        const tailwind = initialTailwind ?? loadFreshAdapter();
        initialTailwind = undefined;
        if (tailwind === undefined) {
          throw new TypeError('The project Tailwind v4 adapter could not be reloaded.');
        }
        return readPostcssProcessor(postcss([tailwind({ base: styleRoot, optimize: false })]));
      },
    };
  } catch {
    return undefined;
  }
}

/**
 * Loads Tailwind v2/v3 with inert content options and its configuration evaluated as data.
 * The content option key defaults to the version rule (`purge` before v3, `content` after).
 */
function loadLegacyTailwindImplementation(
  projectRequire: PreviewProjectRequire,
  styleRoot: string,
  configBoundaryRoot: string,
  contentKey?: 'content' | 'purge',
): PreviewTailwindImplementation | undefined {
  try {
    const tailwindPath = projectRequire.resolve('tailwindcss');
    const tailwindRequire = createRequire(tailwindPath);
    const postcss =
      readCallableExport(safeRequire(tailwindRequire, 'postcss')) ??
      readCallableExport(projectRequire('postcss'));
    const tailwind = readCallableExport(projectRequire('tailwindcss'));
    if (postcss === undefined || tailwind === undefined) return undefined;
    const majorVersion = readPackageMajorVersion(tailwindPath, 'tailwindcss');
    const key =
      contentKey ?? (majorVersion !== undefined && majorVersion < 3 ? 'purge' : 'content');
    let configEvidence = {
      dependencyPaths: [] as readonly string[],
      skipped: [] as readonly string[],
    };
    return {
      kind: 'legacy',
      strategy: key === 'content' ? 'legacy-content' : 'legacy-purge',
      selfTest: async () => {
        // Some releases (3.0.0) stat the input file, so the probe stylesheet must exist on disk.
        const directory = mkdtempSync(path.join(tmpdir(), 'react-preview-tailwind-probe-'));
        try {
          const probePath = path.join(directory, 'probe.css');
          writeFileSync(probePath, '@tailwind utilities;', 'utf8');
          const configuration = {
            [key]: [{ extension: 'html', raw: PROBE_MARKUP }],
            corePlugins: { preflight: false },
          };
          const result = await readPostcssProcessor(postcss([tailwind(configuration)])).process(
            '@tailwind utilities;',
            { from: probePath },
          );
          return PROBE_UTILITY_PATTERN.test(result.css);
        } finally {
          rmSync(directory, { force: true, recursive: true });
        }
      },
      createProcessor: (snapshotSources) => {
        const content = createLegacyContentInventory(styleRoot, snapshotSources);
        // The project's theme is read as data; its file is never executed.
        const projectConfig = readPreviewTailwindStaticConfig(
          styleRoot,
          (specifier) => tailwindRequire(specifier),
          configBoundaryRoot,
        );
        configEvidence = {
          dependencyPaths: projectConfig?.dependencyPaths ?? [],
          skipped: projectConfig?.skipped ?? [],
        };
        const safeConfiguration = { ...projectConfig?.config, [key]: content };
        return readPostcssProcessor(postcss([tailwind(safeConfiguration)]));
      },
      readConfigEvidence: () => configEvidence,
    };
  } catch {
    return undefined;
  }
}

/** Reads a function from CommonJS, transpiled default, or native ESM interop values. */
function readCallableExport(value: unknown): ((...arguments_: unknown[]) => unknown) | undefined {
  if (typeof value === 'function') return value as (...arguments_: unknown[]) => unknown;
  if (typeof value !== 'object' || value === null || !('default' in value)) return undefined;
  const defaultExport = (value as { readonly default?: unknown }).default;
  return typeof defaultExport === 'function'
    ? (defaultExport as (...arguments_: unknown[]) => unknown)
    : undefined;
}

/** Narrows an arbitrary processor value before project code can influence later compiler logic. */
function readPostcssProcessor(value: unknown): PreviewPostcssProcessor {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('process' in value) ||
    typeof (value as { readonly process?: unknown }).process !== 'function'
  ) {
    throw new TypeError('The project PostCSS package returned no compatible processor.');
  }
  return value as PreviewPostcssProcessor;
}

/** Attempts one package import without allowing an optional dependency miss to escape. */
function safeRequire(require_: PreviewProjectRequire, specifier: string): unknown {
  try {
    return require_(specifier) as unknown;
  } catch {
    return undefined;
  }
}

/** Reads the native scanner constructor without trusting unrelated package export properties. */
function readScannerConstructor(value: unknown): PreviewTailwindScannerConstructor | undefined {
  if (typeof value !== 'object' || value === null || !('Scanner' in value)) return undefined;
  const Scanner = (value as { readonly Scanner?: unknown }).Scanner;
  return typeof Scanner === 'function' ? (Scanner as PreviewTailwindScannerConstructor) : undefined;
}

/** Reads only Tailwind's inert package version to choose v2 versus v3 content option syntax. */
function readPackageMajorVersion(
  packageEntryPath: string,
  packageName: string,
): number | undefined {
  try {
    const manifestPath = findOwningPackageManifest(packageEntryPath, packageName);
    if (manifestPath === undefined) return undefined;
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const version =
      typeof manifest === 'object' && manifest !== null && 'version' in manifest
        ? (manifest as { readonly version?: unknown }).version
        : undefined;
    const match = typeof version === 'string' ? /^(\d+)\./u.exec(version) : undefined;
    return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
  } catch {
    return undefined;
  }
}

/** Finds the inert owning manifest even when package exports hide the package.json subpath. */
function findOwningPackageManifest(
  packageEntryPath: string,
  expectedPackageName: string,
): string | undefined {
  let current = path.dirname(packageEntryPath);
  for (;;) {
    const manifestPath = path.join(current, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (
          typeof manifest === 'object' &&
          manifest !== null &&
          'name' in manifest &&
          (manifest as { readonly name?: unknown }).name === expectedPackageName
        ) {
          return manifestPath;
        }
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Creates safe conventional legacy content roots plus bounded raw dirty-editor overlays. */
function createLegacyContentInventory(
  styleRoot: string,
  snapshots: readonly PreviewTailwindSnapshotSource[],
): readonly unknown[] {
  const directories = ['app', 'components', 'pages', 'src']
    .map((directory) => path.join(styleRoot, directory))
    .filter((directory) => existsSync(directory));
  return [
    ...directories.map((directory) => path.join(directory, `**/*.{${PROJECT_SOURCE_EXTENSIONS}}`)),
    ...snapshots.map((snapshot) => ({
      extension: snapshot.extension,
      raw: snapshot.sourceText,
    })),
  ];
}
