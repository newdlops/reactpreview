/**
 * Replaces Node-only built-in modules reached by a browser preview with an inert CommonJS proxy.
 * Application graphs sometimes expose optional server helpers from a package entry even though the
 * rendered component never calls them. Resolving those imports lets esbuild tree-shake or retain the
 * browser-safe code without granting workspace code access to the extension host filesystem.
 */
import { builtinModules } from 'node:module';
import type { OnLoadArgs, OnLoadResult, OnResolveArgs, OnResolveResult, Plugin } from 'esbuild';
import { PREVIEW_NODE_BUILTIN_NAMESPACE } from './previewPluginProtocol';

/** Bare built-in names accepted with or without Node's explicit `node:` prefix. */
const NODE_BUILTIN_NAMES = new Set(
  builtinModules.map((moduleName) => removeNodePrefix(moduleName)),
);

/** Exact resolver filter generated only from Node-owned static module names. */
const NODE_BUILTIN_FILTER = new RegExp(
  `^(?:node:)?(?:${[...NODE_BUILTIN_NAMES].map(escapeRegularExpression).join('|')})$`,
);

/**
 * Creates the browser boundary for optional Node-only dependencies.
 *
 * The generated module is CommonJS deliberately: esbuild can safely project arbitrary named ESM
 * imports from a dynamic CommonJS object, whereas a finite ESM export list would fail whenever a
 * package imports a less common `fs`, `crypto`, or `stream` member. Every call returns `undefined`;
 * nested properties remain callable proxies and promises are explicitly non-thenable.
 *
 * @returns Stateless esbuild plugin that handles only exact Node built-in specifiers.
 */
export function createPreviewNodeBuiltinPlugin(): Plugin {
  const exportNamesByModule = new Map<string, readonly string[]>();
  return {
    name: 'react-preview-node-builtins',
    setup(build): void {
      /** Maps one exact built-in request into the private inert-module namespace. */
      function resolveNodeBuiltin(arguments_: OnResolveArgs): OnResolveResult | undefined {
        const moduleName = removeNodePrefix(arguments_.path);
        if (!NODE_BUILTIN_NAMES.has(moduleName)) {
          return undefined;
        }
        return {
          namespace: PREVIEW_NODE_BUILTIN_NAMESPACE,
          path: moduleName,
          sideEffects: false,
        };
      }

      /** Emits a neutral callable object without forwarding any extension-host Node capability. */
      async function loadNodeBuiltin(arguments_: OnLoadArgs): Promise<OnLoadResult> {
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
            '    return neutral;',
            '  },',
            '});',
            'for (const exportName of exportNames) {',
            '  if (!Object.hasOwn(callable, exportName)) {',
            '    Object.defineProperty(callable, exportName, { configurable: true, enumerable: true, get: () => neutral });',
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
