/**
 * Serves the small React-aware facade runtime used only by Page Inspector compilations.
 * The browser entry owns the persistent store and toolbar; this virtual module merely delegates
 * selected target exports to that already-installed global API.
 */
import type { OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_INSPECTOR_RUNTIME_SPECIFIER } from '../inspector';
import {
  PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
  PREVIEW_RESOLVE_GUARD,
} from '../previewPluginProtocol';
import { createPreviewInspectorFacadeRuntimeSource } from './previewInspectorFacadeRuntimeSource';

const PREVIEW_INSPECTOR_RUNTIME_PATH = 'facade-runtime';
const PREVIEW_INSPECTOR_JSX_RUNTIME_NAMESPACE = 'react-preview-inspector-jsx-runtime';
const PREVIEW_INSPECTOR_PORTAL_RUNTIME_NAMESPACE = 'react-preview-inspector-portal-runtime';

/** Reads an extension-only guard without trusting project-owned resolver data. */
function hasRuntimeResolutionGuard(pluginData: unknown, key: string): boolean {
  return (
    pluginData !== null &&
    typeof pluginData === 'object' &&
    (pluginData as Record<string, unknown>)[key] === true
  );
}

/** Adds a private resolution guard while retaining unrelated resolver metadata. */
function addRuntimeResolutionGuard(pluginData: unknown, key: string): Record<string, unknown> {
  return {
    ...(pluginData !== null && typeof pluginData === 'object' ? pluginData : {}),
    [key]: true,
  };
}

/** Leaves package-owned React imports untouched; only authored workspace modules are adapted. */
function isDependencyOwnedImporter(importer: string): boolean {
  return importer
    .split(/[\\/]/u)
    .some((segment) => segment === 'node_modules' || segment === '.yarn');
}

/** Filesystem context required to resolve the inspected project's React package instance. */
export interface PreviewInspectorRuntimePluginOptions {
  /** Nearest package root selected by monorepo-aware compiler discovery. */
  readonly projectRoot: string;
}

/** Creates one stateless virtual runtime module for a Page Inspector build. */
export function createPreviewInspectorRuntimePlugin(
  options: PreviewInspectorRuntimePluginOptions,
): Plugin {
  /** Captures only the private specifier emitted by selected-target facades. */
  function resolveRuntime(arguments_: OnResolveArgs): OnResolveResult | undefined {
    return arguments_.path === PREVIEW_INSPECTOR_RUNTIME_SPECIFIER
      ? {
          namespace: PREVIEW_INSPECTOR_RUNTIME_NAMESPACE,
          path: PREVIEW_INSPECTOR_RUNTIME_PATH,
        }
      : undefined;
  }

  /** Loads fixed ESM source without resolving any application configuration or source file. */
  function loadRuntime(): OnLoadResult {
    return {
      contents: createPreviewInspectorFacadeRuntimeSource(),
      loader: 'js',
      resolveDir: options.projectRoot,
    };
  }

  return {
    name: 'react-preview-page-inspector-runtime',
    setup(build): void {
      build.onResolve({ filter: /^react-preview:inspector-runtime$/ }, resolveRuntime);
      build.onResolve(
        { filter: /^react\/(?:jsx-runtime|jsx-dev-runtime)$/ },
        async (arguments_) => {
          if (
            isDependencyOwnedImporter(arguments_.importer) ||
            arguments_.pluginData === PREVIEW_RESOLVE_GUARD ||
            hasRuntimeResolutionGuard(
              arguments_.pluginData,
              'reactPreviewInspectorJsxResolutionGuard',
            )
          )
            return undefined;
          const resolved = await build.resolve(arguments_.path, {
            importer: arguments_.importer,
            kind: arguments_.kind,
            namespace: arguments_.namespace,
            pluginData: addRuntimeResolutionGuard(
              arguments_.pluginData,
              'reactPreviewInspectorJsxResolutionGuard',
            ),
            resolveDir: arguments_.resolveDir,
            with: arguments_.with,
          });
          if (resolved.errors.length > 0 || resolved.path.length === 0) return undefined;
          return {
            namespace: PREVIEW_INSPECTOR_JSX_RUNTIME_NAMESPACE,
            path: JSON.stringify({
              dev: arguments_.path.endsWith('jsx-dev-runtime'),
              runtimePath: resolved.path,
            }),
          };
        },
      );
      build.onResolve({ filter: /^react-dom$/ }, async (arguments_) => {
        if (
          isDependencyOwnedImporter(arguments_.importer) ||
          arguments_.pluginData === PREVIEW_RESOLVE_GUARD ||
          hasRuntimeResolutionGuard(
            arguments_.pluginData,
            'reactPreviewInspectorPortalResolutionGuard',
          )
        )
          return undefined;
        const resolved = await build.resolve(arguments_.path, {
          importer: arguments_.importer,
          kind: arguments_.kind,
          namespace: arguments_.namespace,
          pluginData: addRuntimeResolutionGuard(
            arguments_.pluginData,
            'reactPreviewInspectorPortalResolutionGuard',
          ),
          resolveDir: arguments_.resolveDir,
          with: arguments_.with,
        });
        if (resolved.errors.length > 0 || resolved.path.length === 0) return undefined;
        return { namespace: PREVIEW_INSPECTOR_PORTAL_RUNTIME_NAMESPACE, path: resolved.path };
      });
      build.onLoad(
        { filter: /^facade-runtime$/, namespace: PREVIEW_INSPECTOR_RUNTIME_NAMESPACE },
        loadRuntime,
      );
      build.onLoad(
        { filter: /.*/, namespace: PREVIEW_INSPECTOR_JSX_RUNTIME_NAMESPACE },
        (arguments_) => {
          const details = JSON.parse(arguments_.path) as { dev: boolean; runtimePath: string };
          return {
            contents: createPreviewInspectorJsxRuntimeSource(details),
            loader: 'js',
            resolveDir: options.projectRoot,
          };
        },
      );
      build.onLoad(
        { filter: /.*/, namespace: PREVIEW_INSPECTOR_PORTAL_RUNTIME_NAMESPACE },
        (arguments_) => ({
          contents: createPreviewInspectorPortalRuntimeSource(arguments_.path),
          loader: 'js',
          resolveDir: options.projectRoot,
        }),
      );
    },
  };
}

/** Private automatic-JSX adapter. It never changes composites or props and records only host refs. */
function createPreviewInspectorJsxRuntimeSource(options: {
  readonly dev: boolean;
  readonly runtimePath: string;
}): string {
  const factoryNames = options.dev ? ['jsxDEV'] : ['jsx', 'jsxs'];
  return [
    "import * as React from 'react';",
    `import * as original from ${JSON.stringify(options.runtimePath)};`,
    "const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');",
    "const contextKey = Symbol.for('newdlops.react-file-preview.page-inspector.jsx-ownership-context');",
    'const OwnershipContext = globalThis[contextKey] ?? (globalThis[contextKey] = React.createContext(undefined));',
    'globalThis[apiKey]?.registerJsxOwnershipContext?.(OwnershipContext);',
    'const hosts = new Map();',
    'function Host(type) { let result = hosts.get(type); if (result) return result; result = React.forwardRef((props, forwardedRef) => { const token = React.useContext(OwnershipContext); const authored = forwardedRef ?? props.ref; const attachment = React.useRef(); const ref = React.useMemo(() => (node) => { const prior = attachment.current; const release = () => { if (prior?.released) return; if (prior) prior.released = true; try { if (typeof prior?.cleanup === "function") prior.cleanup(); else if (typeof prior?.authored === "function") prior.authored(null); else if (prior?.authored && typeof prior.authored === "object") prior.authored.current = null; } finally { prior?.privateRelease?.(); } }; if (node === null) { release(); return; } release(); let cleanup; if (typeof authored === "function") cleanup = authored(node); else if (authored && typeof authored === "object") authored.current = node; const next = { authored, cleanup, privateRelease: token === undefined ? undefined : globalThis[apiKey]?.registerOwnedHost?.(token, node), released: false }; attachment.current = next; return () => { if (attachment.current === next) attachment.current = undefined; if (!next.released) { next.released = true; try { if (typeof next.cleanup === "function") next.cleanup(); else if (typeof next.authored === "function") next.authored(null); else if (next.authored && typeof next.authored === "object") next.authored.current = null; } finally { next.privateRelease?.(); } } }; }, [authored, token]); return React.createElement(type, { ...props, ref }); }); hosts.set(type, result); return result; }',
    'function adapt(factory) { return (type, props, key, ...rest) => factory(typeof type === "string" ? Host(type) : type, props, key, ...rest); }',
    'export const Fragment = original.Fragment;',
    ...factoryNames.map((name) => `export const ${name} = adapt(original.${name});`),
    'export default original;',
  ].join('\n');
}

/** Portal output is intentionally outside an inline target ownership provider. */
function createPreviewInspectorPortalRuntimeSource(runtimePath: string): string {
  return [
    "import * as React from 'react';",
    `import originalDefault from ${JSON.stringify(runtimePath)};`,
    `import * as original from ${JSON.stringify(runtimePath)};`,
    "const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');",
    'export * from ' + JSON.stringify(runtimePath) + ';',
    'export const createPortal = (children, container, key) => { const Context = globalThis[apiKey]?.readJsxOwnershipContext?.(); return original.createPortal(Context === undefined ? children : React.createElement(Context.Provider, { value: undefined }, children), container, key); };',
    "const defaultAdapter = originalDefault !== null && (typeof originalDefault === 'object' || typeof originalDefault === 'function') ? new Proxy(originalDefault, { get(target, key) { return key === 'createPortal' ? createPortal : Reflect.get(target, key, target); } }) : originalDefault;",
    'export default defaultAdapter;',
  ].join('\n');
}
