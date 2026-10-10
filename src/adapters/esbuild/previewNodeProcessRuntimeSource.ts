/**
 * Generates the `process` / `node:process` built-in for preview bundles.
 *
 * Packages written as ES modules import `process` explicitly (`import process from
 * 'node:process'`) instead of using the free global. The generic callable builtin fallback answers
 * every property with a neutral callable, so `process.env.DEBUG` becomes a truthy function and code
 * such as `DEBUG.split(',').map(…)` throws while the package evaluates. The preview entry already
 * installs a bounded browser `process` before project modules load; this module re-exports it.
 */

/** Returns CommonJS source that exposes the preview's browser `process` object. */
export function createPreviewNodeProcessRuntimeSource(): string {
  return [
    'const host = typeof globalThis.process === "object" && globalThis.process !== null',
    '  ? globalThis.process',
    '  : undefined;',
    'module.exports = host ?? {',
    "  argv: [], cwd: () => '/', emit: () => false, env: {}, nextTick: (callback, ...args) => queueMicrotask(() => callback(...args)),",
    "  off() { return this; }, on() { return this; }, once() { return this; }, pid: 1, platform: 'browser',",
    "  stderr: { isTTY: false, write: () => true }, stdout: { isTTY: false, write: () => true }, version: '', versions: {},",
    '};',
  ].join('\n');
}
