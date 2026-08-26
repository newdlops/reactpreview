/**
 * Loads a project or managed-store Tailwind implementation without evaluating project-authored
 * configuration. Kept separate from the esbuild plugin so package loading policy remains small,
 * testable, and independent from CSS graph traversal.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  PreviewTailwindScannerConstructor,
  PreviewTailwindSnapshotSource,
} from './previewTailwindCandidates';

/** Project-anchored CommonJS resolver returned by Node's `createRequire`. */
type PreviewProjectRequire = ReturnType<typeof createRequire>;

const PROJECT_SOURCE_EXTENSIONS = 'html,js,jsx,md,mdx,ts,tsx,vue,svelte';

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
}

/** Loads v4 first, then a configuration-free v2/v3 fallback from each trusted package graph. */
export function loadPreviewTailwindImplementation(
  styleRoot: string,
  fallbackNodeModulesPaths: readonly string[] = [],
): PreviewTailwindImplementation | undefined {
  const packageResolvers = [
    createRequire(path.join(styleRoot, 'package.json')),
    ...fallbackNodeModulesPaths.map((nodeModulesPath) =>
      createRequire(path.join(nodeModulesPath, '__react_preview_tailwind__.js')),
    ),
  ];
  for (const packageResolver of packageResolvers) {
    const v4 = loadTailwindV4Implementation(packageResolver, styleRoot);
    if (v4 !== undefined) return v4;
    const legacy = loadLegacyTailwindImplementation(packageResolver, styleRoot);
    if (legacy !== undefined) return legacy;
  }
  return undefined;
}

/** Loads Tailwind v4's canonical adapter and its own PostCSS/Oxide dependencies by exact issuer. */
function loadTailwindV4Implementation(
  projectRequire: PreviewProjectRequire,
  styleRoot: string,
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
      ...(Scanner === undefined ? {} : { Scanner }),
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

/** Loads Tailwind v2/v3 with inert default content options instead of executing its config file. */
function loadLegacyTailwindImplementation(
  projectRequire: PreviewProjectRequire,
  styleRoot: string,
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
    return {
      kind: 'legacy',
      createProcessor: (snapshotSources) => {
        const content = createLegacyContentInventory(styleRoot, snapshotSources);
        const safeConfiguration =
          majorVersion !== undefined && majorVersion < 3 ? { purge: content } : { content };
        return readPostcssProcessor(postcss([tailwind(safeConfiguration)]));
      },
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
