/**
 * Replaces Node-only built-in modules with a writable, browser-local CommonJS namespace proxy.
 * Application graphs sometimes expose optional server helpers from a package entry even though the
 * rendered component never calls them. Resolving those imports lets esbuild tree-shake or retain the
 * browser-safe code without granting workspace code access to the extension host filesystem.
 */
import { builtinModules } from 'node:module';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_NODE_BUILTIN_NAMESPACE } from './previewPluginProtocol';
import { createPreviewNodeEventsRuntimeSource } from './previewNodeEventsRuntimeSource';
import { createPreviewNodeFsRuntimeSource } from './previewNodeFsRuntimeSource';

/** Bare built-in names accepted with or without Node's explicit `node:` prefix. */
const NODE_BUILTIN_NAMES = new Set(
  builtinModules.map((moduleName) => removeNodePrefix(moduleName)),
);

/** Exact resolver filter generated only from Node-owned static module names. */
const NODE_BUILTIN_FILTER = new RegExp(
  `^(?:node:)?(?:${[...NODE_BUILTIN_NAMES].map(escapeRegularExpression).join('|')})$`,
);
const PREVIEW_NODE_BUILTIN_RESOLVE_MARKER = 'reactPreviewNodeBuiltinResolve';

/**
 * Creates the browser boundary for optional Node-only dependencies.
 *
 * The generated module is CommonJS deliberately: esbuild can safely project arbitrary named ESM
 * imports from a dynamic CommonJS object, whereas a finite ESM export list would fail whenever a
 * package imports a less common `fs`, `crypto`, or `stream` member. Unmodified calls return
 * `undefined`; unknown nested properties remain callable proxies, local package assignments are
 * retained, and promises are explicitly non-thenable.
 *
 * @returns Stateless esbuild plugin that handles only exact Node built-in specifiers.
 */
export function createPreviewNodeBuiltinPlugin(): Plugin {
  const exportNamesByModule = new Map<string, readonly string[]>();
  return {
    name: 'react-preview-node-builtins',
    setup(build): void {
      /**
       * Prefers an installed browser package for a bare legacy import, then uses a safe local shim.
       * Explicit `node:` requests never receive a project package because they intentionally name
       * the host runtime contract. The marker prevents `build.resolve` from re-entering this plugin.
       */
      async function resolveNodeBuiltin(
        arguments_: OnResolveArgs,
      ): Promise<OnResolveResult | undefined> {
        const moduleName = removeNodePrefix(arguments_.path);
        if (!NODE_BUILTIN_NAMES.has(moduleName)) {
          return undefined;
        }
        const pluginData = readPreviewNodeBuiltinPluginData(arguments_.pluginData);
        if (pluginData[PREVIEW_NODE_BUILTIN_RESOLVE_MARKER] === true) return undefined;
        if (!arguments_.path.startsWith('node:')) {
          const browserResolution = await build.resolve(arguments_.path, {
            importer: arguments_.importer,
            kind: arguments_.kind,
            namespace: arguments_.namespace,
            pluginData: {
              ...pluginData,
              [PREVIEW_NODE_BUILTIN_RESOLVE_MARKER]: true,
            },
            resolveDir: arguments_.resolveDir,
          });
          if (
            browserResolution.errors.length === 0 &&
            browserResolution.path.length > 0 &&
            !browserResolution.external
          ) {
            return browserResolution;
          }
        }
        return {
          namespace: PREVIEW_NODE_BUILTIN_NAMESPACE,
          path: moduleName,
          sideEffects: false,
        };
      }

      /**
       * Emits a writable browser-local namespace without forwarding extension-host capabilities.
       *
       * Legacy packages commonly inherit from a built-in export and then assign methods such as
       * `Child.prototype.destroy`. Export-shaped properties must therefore be writable data
       * properties: a getter-only property on the neutral function becomes an inherited accessor
       * and makes that ordinary assignment throw in strict-mode bundles.
       */
      async function loadNodeBuiltin(arguments_: OnLoadArgs): Promise<OnLoadResult> {
        if (arguments_.path === 'events') {
          return {
            contents: createPreviewNodeEventsRuntimeSource(),
            loader: 'js',
          };
        }
        if (arguments_.path === 'fs' || arguments_.path === 'fs/promises') {
          return {
            contents: createPreviewNodeFsRuntimeSource(arguments_.path),
            loader: 'js',
          };
        }
        const encodedModuleName = JSON.stringify(arguments_.path);
        const encodedExportNames = JSON.stringify(
          await readNodeBuiltinExportNames(arguments_.path, exportNamesByModule),
        );
        return {
          contents: [
            `const moduleName = ${encodedModuleName};`,
            `const exportNames = ${encodedExportNames};`,
            'let neutral;',
            'const callable = function previewNodeBuiltinNeutralValue() { return undefined; };',
            'neutral = new Proxy(callable, {',
            '  get(_target, property) {',
            "    if (property === '__esModule') return false;",
            "    if (property === 'then') return undefined;",
            "    if (property === Symbol.toStringTag) return 'ReactPreviewNodeBuiltinShim';",
            '    if (property === Symbol.toPrimitive) return () => 0;',
            '    if (Reflect.has(_target, property)) return Reflect.get(_target, property);',
            '    return neutral;',
            '  },',
            '});',
            'for (const exportName of exportNames) {',
            '  if (!Object.hasOwn(callable, exportName)) {',
            '    Object.defineProperty(callable, exportName, { configurable: true, enumerable: true, value: neutral, writable: true });',
            '  }',
            '}',
            "console.warn('[React Preview] Node built-in ' + moduleName + ' is unavailable in the browser preview; calls return neutral values.');",
            'module.exports = neutral;',
          ].join('\n'),
          loader: 'js',
        };
      }

      build.onResolve({ filter: NODE_BUILTIN_FILTER }, resolveNodeBuiltin);
      build.onLoad({ filter: /.*/, namespace: PREVIEW_NODE_BUILTIN_NAMESPACE }, loadNodeBuiltin);
    },
  };
}

/** Copies resolver metadata only when another plugin supplied a plain record-like value. */
function readPreviewNodeBuiltinPluginData(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Reads only public property names so generated named imports never receive the host implementations. */
async function readNodeBuiltinExportNames(
  moduleName: string,
  cache: Map<string, readonly string[]>,
): Promise<readonly string[]> {
  const cached = cache.get(moduleName);
  if (cached !== undefined) return cached;
  try {
    const namespace = (await import(moduleName)) as Record<string, unknown>;
    const exportNames = Object.keys(namespace).filter(
      (exportName) => exportName !== 'default' && exportName !== '__esModule',
    );
    cache.set(moduleName, exportNames);
    return exportNames;
  } catch {
    cache.set(moduleName, []);
    return [];
  }
}

/** Removes the optional protocol prefix before Set membership and browser diagnostics. */
function removeNodePrefix(moduleName: string): string {
  return moduleName.startsWith('node:') ? moduleName.slice('node:'.length) : moduleName;
}

/** Escapes one trusted literal before joining the exact built-in resolver regular expression. */
function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
