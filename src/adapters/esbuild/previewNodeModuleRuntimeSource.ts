/**
 * Generates a browser-only subset of Node's `module` module.
 *
 * Pre-bundled ES-module packages (Prisma's client runtime, many server SDKs) create their own
 * `require` with `createRequire(import.meta.url)` and load Node built-ins through it while they
 * evaluate. The generic callable builtin fallback returns `undefined` from `createRequire`, so the
 * package's own shim throws "Dynamic require of … is not supported" before any component renders.
 * This facade returns a `require` that serves the preview's browser-local built-in modules and
 * still rejects everything else, exactly as the package's shim would without a host `require`.
 */

/** Built-ins the returned `require` can serve; each is bundled through the built-in plugin. */
const SERVED_BUILTINS = [
  'buffer',
  'crypto',
  'events',
  'fs',
  'fs/promises',
  'os',
  'path',
  'stream',
  'url',
  'util',
] as const;

/** Returns CommonJS source implementing `createRequire` and the common `module` exports. */
export function createPreviewNodeModuleRuntimeSource(): string {
  const loaders = SERVED_BUILTINS.map(
    (name) => `  ${JSON.stringify(name)}: () => require(${JSON.stringify(name)}),`,
  );
  return [
    'const loaders = {',
    ...loaders,
    '};',
    'const builtinModules = Object.freeze(Object.keys(loaders));',
    "const readName = (request) => String(request ?? '').replace(/^node:/u, '');",
    'function createRequire() {',
    '  const previewRequire = (request) => {',
    '    const load = loaders[readName(request)];',
    '    if (load !== undefined) return load();',
    "    throw new Error('Dynamic require of \"' + String(request) + '\" is not supported');",
    '  };',
    '  previewRequire.resolve = (request) => String(request);',
    '  previewRequire.cache = Object.create(null);',
    '  return previewRequire;',
    '}',
    'function Module() {}',
    'Module.createRequire = createRequire;',
    'Module.builtinModules = builtinModules;',
    'module.exports = {',
    '  Module, builtinModules, createRequire,',
    '  isBuiltin: (request) => Object.hasOwn(loaders, readName(request)),',
    '  register: () => undefined,',
    '};',
    "console.warn('[React Preview] Node built-in module serves only browser-local built-ins to createRequire.');",
  ].join('\n');
}
