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
          let runtimePath: string | undefined;
          if (resolved.errors.length === 0 && resolved.path.length > 0) {
            runtimePath = resolved.path;
          } else {
            // React 16 predates the automatic JSX subpaths. Admit its stable createElement API only
            // after the exact project React package itself resolves from the same source corridor.
            const reactResolution = await build.resolve('react', {
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
            if (reactResolution.errors.length > 0 || reactResolution.path.length === 0) {
              return undefined;
            }
          }
          return {
            namespace: PREVIEW_INSPECTOR_JSX_RUNTIME_NAMESPACE,
            path: JSON.stringify({
              dev: arguments_.path.endsWith('jsx-dev-runtime'),
              ...(runtimePath === undefined ? {} : { runtimePath }),
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
          const details = JSON.parse(arguments_.path) as { dev: boolean; runtimePath?: string };
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
  readonly runtimePath?: string;
}): string {
  const factoryNames = options.dev ? ['jsxDEV'] : ['jsx', 'jsxs'];
  return [
    "import * as React from 'react';",
    ...(options.runtimePath === undefined
      ? [
          'function createClassicConfig(props, key, source, self) { const config = props !== null && typeof props === "object" ? { ...props } : {}; if (key !== undefined) config.key = key; if (source !== undefined) config.__source = source; if (self !== undefined) config.__self = self; return config; }',
          'function classicJsx(type, props, key) { return React.createElement(type, createClassicConfig(props, key)); }',
          'function classicJsxDEV(type, props, key, _isStaticChildren, source, self) { return React.createElement(type, createClassicConfig(props, key, source, self)); }',
          'const original = { Fragment: React.Fragment, jsx: classicJsx, jsxs: classicJsx, jsxDEV: classicJsxDEV };',
        ]
      : [`import * as original from ${JSON.stringify(options.runtimePath)};`]),
    "const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');",
    "const contextKey = Symbol.for('newdlops.react-file-preview.page-inspector.jsx-ownership-context');",
    'const OwnershipContext = globalThis[contextKey] ?? (globalThis[contextKey] = React.createContext(undefined));',
    'globalThis[apiKey]?.registerJsxOwnershipContext?.(OwnershipContext);',
    'const hosts = new Map();',
    'const reportedInvalidElementTypes = new WeakSet();',
    "const validObjectTypeMarkers = new Set(['react.context', 'react.consumer', 'react.forward_ref', 'react.lazy', 'react.memo', 'react.provider', 'react.server_context', 'react.client.reference'].map((name) => Symbol.for(name)));",
    'function readOwnValue(value, key) { try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && "value" in descriptor ? descriptor.value : undefined; } catch { return undefined; } }',
    'function reportInvalidElementType(type, props, rest) { if (type === null || typeof type !== "object" || reportedInvalidElementTypes.has(type)) return; const marker = readOwnValue(type, "$$typeof"); if (validObjectTypeMarkers.has(marker)) return; reportedInvalidElementTypes.add(type); let keys = []; try { keys = Reflect.ownKeys(type).slice(0, 16).map((key) => typeof key === "symbol" ? String(key) : key); } catch { keys = ["[uninspectable]"]; } const defaultValue = readOwnValue(type, "default"); const source = rest?.[1]; const location = source && typeof source === "object" ? [readOwnValue(source, "fileName"), readOwnValue(source, "lineNumber"), readOwnValue(source, "columnNumber")].filter((value) => value !== undefined).join(":") : ""; let propKeys = []; try { propKeys = props && typeof props === "object" ? Object.keys(props).slice(0, 16) : []; } catch { propKeys = ["[uninspectable]"]; } let frozen = false; let tag = "[uninspectable]"; let prototypeName = ""; try { frozen = Object.isFrozen(type); tag = Object.prototype.toString.call(type); prototypeName = Object.getPrototypeOf(type)?.constructor?.name ?? ""; } catch {} console.error("[React Preview] Invalid JSX element type object", { defaultType: typeof defaultValue, frozen, keys: keys.join(","), location, marker: typeof marker === "symbol" ? String(marker) : String(marker), propKeys: propKeys.join(","), prototypeName, tag }); }',
    'function Host(type) { let result = hosts.get(type); if (result) return result; result = React.forwardRef((props, forwardedRef) => { const token = React.useContext(OwnershipContext); const authored = forwardedRef ?? props.ref; const attachment = React.useRef(); const ref = React.useMemo(() => { const release = (entry) => { if (!entry || entry.released) return; entry.released = true; try { if (typeof entry.cleanup === "function") entry.cleanup(); else if (typeof entry.authored === "function") entry.authored(null); else if (entry.authored && typeof entry.authored === "object") entry.authored.current = null; } finally { entry.privateRelease?.(); } }; return (node) => { const prior = attachment.current; if (node === null) { attachment.current = undefined; release(prior); return; } release(prior); let cleanup; if (typeof authored === "function") cleanup = authored(node); else if (authored && typeof authored === "object") authored.current = node; attachment.current = { authored, cleanup, privateRelease: token === undefined ? undefined : globalThis[apiKey]?.registerOwnedHost?.(token, node), released: false }; }; }, [authored, token]); return React.createElement(type, { ...props, ref }); }); hosts.set(type, result); return result; }',
    'function adapt(factory) { return (type, props, key, ...rest) => { reportInvalidElementType(type, props, rest); return factory(typeof type === "string" ? Host(type) : type, props, key, ...rest); }; }',
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
    'const isPortalContainer = (value) => value !== null && typeof value === "object" && [1, 9, 11].includes(value.nodeType) && typeof value.appendChild === "function";',
    'export const createPortal = (children, container, key) => { const Context = globalThis[apiKey]?.readJsxOwnershipContext?.(); const ownedChildren = Context === undefined ? children : React.createElement(Context.Provider, { value: undefined }, children); const fallbackContainer = globalThis.document?.body ?? globalThis.document?.documentElement; const resolvedContainer = isPortalContainer(container) ? container : isPortalContainer(fallbackContainer) ? fallbackContainer : undefined; return resolvedContainer === undefined ? ownedChildren : original.createPortal(ownedChildren, resolvedContainer, key); };',
    "const defaultAdapter = originalDefault !== null && (typeof originalDefault === 'object' || typeof originalDefault === 'function') ? new Proxy(originalDefault, { get(target, key) { return key === 'createPortal' ? createPortal : Reflect.get(target, key, target); } }) : originalDefault;",
    'export default defaultAdapter;',
  ].join('\n');
}
