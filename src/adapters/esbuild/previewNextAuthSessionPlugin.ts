/**
 * Wraps a project's installed next-auth so a zero-argument `auth()` reports a signed-in sample
 * session instead of "signed out". Preview `headers()` and `cookies()` are always empty, so the real
 * lookup can only fail (next-auth also logs a missing-secret error) and is not called. Only the
 * `auth` function returned by `NextAuth(config)` changes: request and middleware forms (`auth(req)`,
 * `auth(handler)`) keep the real behavior, and every other export is the installed package itself.
 * Login and sign-up routes keep the real (signed-out) result, since those pages send signed-in
 * visitors elsewhere. Projects without an installed next-auth resolve exactly as before, including
 * server execution contracts.
 */
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import path from 'node:path';
import { PREVIEW_NEXT_PAGES_ROUTE_STATE_SYMBOL_KEY } from './inspector/previewInspectorPageRouteStatePrelude';
import { PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY } from './previewNextAppNavigationRuntimeSource';
import { PREVIEW_COMPILER_PRIVATE_NAMESPACES } from './previewOwnedNamespaceRegistry';
import { isFileBackedPreviewNamespace, PREVIEW_RESOLVE_GUARD } from './previewPluginProtocol';

const NEXT_AUTH_SESSION_DATA_KIND = 'react-preview-next-auth-session-data';

/** Compiler inputs for one build. */
export interface PreviewNextAuthSessionPluginOptions {
  /**
   * Returns the sample session expression for one module that imports next-auth.
   *
   * @param importerPath Absolute project module importing the package.
   * @returns Side-effect-free expression evaluated on each zero-argument `auth()` call.
   */
  readonly readSessionExpression: (importerPath: string) => string;
}

/** Serializable metadata carried from resolution into facade loading. */
interface NextAuthSessionPluginData {
  readonly importerPath: string;
  readonly kind: typeof NEXT_AUTH_SESSION_DATA_KIND;
}

/**
 * Creates the next-auth session bridge for one compilation.
 *
 * @param options Sample session source for the importing module.
 * @returns Esbuild plugin that facades only project-owned imports of an installed next-auth.
 */
export function createPreviewNextAuthSessionPlugin(
  options: PreviewNextAuthSessionPluginOptions,
): Plugin {
  const namespace = PREVIEW_COMPILER_PRIVATE_NAMESPACES.nextAuthSession;
  return {
    name: 'react-preview-next-auth-session',
    setup(build): void {
      /** Lets resolution fail or externalize unchanged; only a bundled package gets the facade. */
      async function resolveNextAuth(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        if (
          (arguments_.pluginData as unknown) === PREVIEW_RESOLVE_GUARD ||
          (arguments_.namespace !== 'file' &&
            !isFileBackedPreviewNamespace(arguments_.namespace)) ||
          !path.isAbsolute(arguments_.importer) ||
          arguments_.importer.split(/[/\\]/u).includes('node_modules')
        ) {
          return undefined;
        }
        const resolved = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: 'file',
          pluginData: PREVIEW_RESOLVE_GUARD,
          resolveDir: arguments_.resolveDir,
          with: arguments_.with,
        });
        if (resolved.errors.length > 0 || resolved.external || resolved.namespace !== 'file') {
          return undefined;
        }
        return {
          namespace,
          path: resolved.path,
          pluginData: {
            importerPath: arguments_.importer,
            kind: NEXT_AUTH_SESSION_DATA_KIND,
          } satisfies NextAuthSessionPluginData,
        };
      }

      /** Re-exports the installed package with a session-aware default export. */
      function loadNextAuth(arguments_: OnLoadArgs): OnLoadResult {
        const pluginData = readNextAuthSessionPluginData(arguments_.pluginData);
        return {
          contents: createPreviewNextAuthFacadeSource(
            arguments_.path,
            pluginData === undefined
              ? undefined
              : options.readSessionExpression(pluginData.importerPath),
          ),
          loader: 'js',
          resolveDir: path.dirname(arguments_.path),
          watchFiles: [arguments_.path],
        };
      }

      build.onResolve({ filter: /^next-auth$/ }, resolveNextAuth);
      build.onLoad({ filter: /.*/, namespace }, loadNextAuth);
    },
  };
}

/**
 * Creates the facade module over one installed next-auth entry.
 *
 * @param modulePath Absolute installed entry resolved for the importer.
 * @param sessionExpression Sample session expression, or undefined to keep the package unchanged.
 * @returns ESM source re-exporting the package.
 */
export function createPreviewNextAuthFacadeSource(
  modulePath: string,
  sessionExpression: string | undefined,
): string {
  const specifier = JSON.stringify(modulePath);
  if (sessionExpression === undefined) {
    return [`export * from ${specifier};`, `export { default } from ${specifier};`].join('\n');
  }
  return [
    `import * as previewNextAuthPackage from ${specifier};`,
    `export * from ${specifier};`,
    '/** Signed-in sample session; preview `headers()` never carry the auth cookie. */',
    `const createPreviewSession = () => (${sessionExpression});`,
    '/** Reports a login or sign-up route, which visitors see signed out, from the route state. */',
    'function isAuthEntryRoute() {',
    `  const state = globalThis[Symbol.for(${JSON.stringify(PREVIEW_NEXT_APP_ROUTE_STATE_SYMBOL_KEY)})] ?? globalThis[Symbol.for(${JSON.stringify(PREVIEW_NEXT_PAGES_ROUTE_STATE_SYMBOL_KEY)})];`,
    "  const pathname = typeof state?.pathname === 'string' ? state.pathname : '';",
    "  return pathname.split('/').some((segment) => /^(?:log-?in|sign-?in|sign-?up|register)$/i.test(segment));",
    '}',
    '/** Keeps every call form except the zero-argument server session read outside login routes. */',
    'function wrapPreviewAuth(auth) {',
    '  return function previewAuth(...args) {',
    '    if (args.length !== 0 || isAuthEntryRoute()) return Reflect.apply(auth, this, args);',
    '    return Promise.resolve(createPreviewSession());',
    '  };',
    '}',
    '/** Calls the installed `NextAuth` and wraps the `auth` it returns. */',
    'export default function NextAuth(...args) {',
    '  const result = Reflect.apply(previewNextAuthPackage.default, this, args);',
    "  return result !== null && typeof result === 'object' && typeof result.auth === 'function'",
    '    ? { ...result, auth: wrapPreviewAuth(result.auth) }',
    '    : result;',
    '}',
  ].join('\n');
}

/** Narrows untrusted esbuild plugin metadata to this bridge's serializable contract. */
function readNextAuthSessionPluginData(pluginData: unknown): NextAuthSessionPluginData | undefined {
  if (typeof pluginData !== 'object' || pluginData === null || !('kind' in pluginData)) {
    return undefined;
  }
  return pluginData.kind === NEXT_AUTH_SESSION_DATA_KIND
    ? (pluginData as NextAuthSessionPluginData)
    : undefined;
}
