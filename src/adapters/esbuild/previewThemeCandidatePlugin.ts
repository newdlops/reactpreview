/**
 * Resolves syntax-level theme evidence to canonical project file identities during bundling.
 * A tiny virtual module exposes the resolved identity eagerly while keeping the actual theme
 * export behind `import()`, so aliases and relative paths that reach one file share one candidate.
 */
import path from 'node:path';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import {
  PREVIEW_RESOLVE_GUARD,
  PREVIEW_THEME_CANDIDATE_NAMESPACE,
  PREVIEW_THEME_CANDIDATE_SPECIFIER_PREFIX,
} from './previewPluginProtocol';
import type { PreviewThemeImportSelection } from './previewTargetExports';

const CANDIDATE_DATA_KIND = 'react-preview-theme-candidate-data';
const MAX_ENCODED_CANDIDATE_LENGTH = 8_192;

/** Resolved theme metadata retained while a private candidate module is loaded. */
interface PreviewThemeCandidatePluginData {
  /** Discriminant preventing unrelated plugin metadata from entering generated source. */
  readonly kind: typeof CANDIDATE_DATA_KIND;
  /** Canonical project-owned module selected by esbuild's configured resolver. */
  readonly resolvedModulePath: string;
  /** Exact runtime export selected by the static style inventory. */
  readonly exportName: PreviewThemeImportSelection['exportName'];
}

/**
 * Encodes one bounded theme request as a private import specifier.
 *
 * @param selection Syntax-level module request and exact export name.
 * @returns JSON payload escaped for esbuild's virtual resolver.
 */
export function createPreviewThemeCandidateSpecifier(
  selection: PreviewThemeImportSelection,
): string {
  const payload = encodeURIComponent(
    JSON.stringify([selection.moduleSpecifier, selection.exportName]),
  );
  return `${PREVIEW_THEME_CANDIDATE_SPECIFIER_PREFIX}${payload}`;
}

/**
 * Creates the build-time alias canonicalizer consumed by reachable source registrations.
 * Resolution uses normal project tsconfig/package behavior and never reads application bootstrap
 * modules; unsupported or external candidates fail the build instead of becoming remote code.
 *
 * @returns Esbuild plugin scoped to one in-memory preview compilation.
 */
export function createPreviewThemeCandidatePlugin(): Plugin {
  return {
    name: 'react-preview-theme-candidate',
    setup(build): void {
      /** Resolves a generated payload from its real importing source module. */
      async function resolveCandidate(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (!arguments_.path.startsWith(PREVIEW_THEME_CANDIDATE_SPECIFIER_PREFIX)) {
          return undefined;
        }
        const selection = parseCandidateSpecifier(arguments_.path);
        if (selection === undefined) {
          return { errors: [{ text: 'React Preview received an invalid theme candidate.' }] };
        }

        const resolution = await build.resolve(selection.moduleSpecifier, {
          importer: arguments_.importer,
          kind: 'dynamic-import',
          namespace: arguments_.namespace,
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
        });
        if (resolution.errors.length > 0) {
          return { errors: resolution.errors, warnings: resolution.warnings };
        }
        if (resolution.external || resolution.namespace !== 'file') {
          return {
            errors: [
              {
                text: `React Preview theme candidates must resolve to local files: ${selection.moduleSpecifier}`,
              },
            ],
            warnings: resolution.warnings,
          };
        }

        return {
          namespace: PREVIEW_THEME_CANDIDATE_NAMESPACE,
          path: resolution.path,
          pluginData: {
            exportName: selection.exportName,
            kind: CANDIDATE_DATA_KIND,
            resolvedModulePath: resolution.path,
          } satisfies PreviewThemeCandidatePluginData,
          suffix: `?react-preview-theme-export=${selection.exportName}`,
          warnings: resolution.warnings,
        };
      }

      /** Loads identity metadata plus a deferred import of the canonical project theme file. */
      function loadCandidate(arguments_: OnLoadArgs): OnLoadResult {
        const candidate = readCandidateData(arguments_.pluginData);
        if (candidate === undefined) {
          return { errors: [{ text: 'React Preview lost resolved theme candidate metadata.' }] };
        }
        const moduleSpecifier = JSON.stringify(candidate.resolvedModulePath.replaceAll('\\', '/'));
        const exportName = JSON.stringify(candidate.exportName);
        const candidateKey = JSON.stringify(
          JSON.stringify([
            candidate.resolvedModulePath.replaceAll('\\', '/'),
            candidate.exportName,
          ]),
        );
        return {
          contents: [
            `export const previewThemeCandidateKey = ${candidateKey};`,
            `export const loadPreviewTheme = () => import(${moduleSpecifier}).then((module) => module[${exportName}]);`,
          ].join('\n'),
          loader: 'js',
          resolveDir: path.dirname(candidate.resolvedModulePath),
          watchFiles: [candidate.resolvedModulePath],
        };
      }

      build.onResolve({ filter: /^react-preview:theme-candidate\// }, resolveCandidate);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_THEME_CANDIDATE_NAMESPACE }, loadCandidate);
    },
  };
}

/** Decodes and validates one generated candidate request without accepting arbitrary exports. */
function parseCandidateSpecifier(specifier: string): PreviewThemeImportSelection | undefined {
  const encodedPayload = specifier.slice(PREVIEW_THEME_CANDIDATE_SPECIFIER_PREFIX.length);
  if (encodedPayload.length === 0 || encodedPayload.length > MAX_ENCODED_CANDIDATE_LENGTH) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(decodeURIComponent(encodedPayload));
    if (!Array.isArray(value) || value.length !== 2) {
      return undefined;
    }
    const moduleSpecifier = value[0] as unknown;
    const exportName = value[1] as unknown;
    if (
      typeof moduleSpecifier !== 'string' ||
      moduleSpecifier.length === 0 ||
      (exportName !== 'default' && exportName !== 'theme')
    ) {
      return undefined;
    }
    return { exportName, moduleSpecifier };
  } catch {
    return undefined;
  }
}

/** Narrows esbuild plugin data to metadata created by this resolver invocation. */
function readCandidateData(pluginData: unknown): PreviewThemeCandidatePluginData | undefined {
  if (pluginData === null || typeof pluginData !== 'object' || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === CANDIDATE_DATA_KIND
    ? (pluginData as PreviewThemeCandidatePluginData)
    : undefined;
}
