/** Static package evidence for styled-components. No project code is evaluated here. */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_STYLE_SHEET_MANAGER_SOURCE_BYTES } from './previewStyledComponentsPlan';
import type { PreviewStaticModuleResolver } from './previewStaticModuleResolver';

const MAX_PACKAGE_ANCESTORS = 32;

export interface PreviewStyledComponentsAvailability {
  readonly available: boolean;
  readonly dependencyPaths: readonly string[];
  readonly packageManifestPath?: string;
  readonly staticResolutionPath?: string;
}

export interface DiscoverPreviewStyledComponentsAvailabilityOptions {
  readonly importerPath: string;
  readonly resolveModule: PreviewStaticModuleResolver['resolve'];
}

/**
 * Accepts only an exact bare package resolution whose nearest package manifest proves ownership.
 * A declaration file (including `@types/styled-components`) is never enough evidence by itself.
 */
export async function discoverPreviewStyledComponentsAvailability(
  options: DiscoverPreviewStyledComponentsAvailabilityOptions,
): Promise<PreviewStyledComponentsAvailability> {
  const staticResolutionPath = options.resolveModule('styled-components', options.importerPath);
  if (staticResolutionPath === undefined) return absent();
  const manifestPath = await findOwningManifest(staticResolutionPath);
  if (manifestPath === undefined) return absent(staticResolutionPath);
  const manifest = await readManifest(manifestPath);
  if (manifest?.name !== 'styled-components') return absent(staticResolutionPath);
  return Object.freeze({
    available: true,
    dependencyPaths: Object.freeze([path.normalize(manifestPath)]),
    packageManifestPath: path.normalize(manifestPath),
    staticResolutionPath: path.normalize(staticResolutionPath),
  });
}

/** Builds the canonical unavailable result while retaining only resolved-path evidence. */
function absent(staticResolutionPath?: string): PreviewStyledComponentsAvailability {
  return Object.freeze({
    available: false,
    dependencyPaths: Object.freeze([]),
    ...(staticResolutionPath === undefined
      ? {}
      : { staticResolutionPath: path.normalize(staticResolutionPath) }),
  });
}

/** Walks upward to the nearest package manifest, without crossing more than the configured bound. */
async function findOwningManifest(resolutionPath: string): Promise<string | undefined> {
  let directory = path.dirname(path.resolve(resolutionPath));
  for (let depth = 0; depth < MAX_PACKAGE_ANCESTORS; depth += 1) {
    const candidate = path.join(directory, 'package.json');
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch {
      // A missing manifest is normal while climbing from a package entry point.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

/** Reads a bounded manifest and exposes only its package-name field. */
async function readManifest(
  manifestPath: string,
): Promise<{ readonly name?: unknown } | undefined> {
  try {
    const info = await stat(manifestPath);
    if (!info.isFile() || info.size > MAX_STYLE_SHEET_MANAGER_SOURCE_BYTES) return undefined;
    const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    return value !== null && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}
