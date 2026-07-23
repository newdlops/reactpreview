/**
 * Generates a browser-only, no-I/O subset of Node's `fs` and `fs/promises` modules.
 *
 * Server-capable React modules often read optional source text while assembling visual metadata.
 * Returning `undefined` from a generic builtin shim makes the next ordinary string operation fail
 * even though the file bytes are irrelevant to the rendered component. This facade preserves the
 * public asynchronous shapes with empty values and never exposes the extension-host filesystem.
 */

/**
 * Creates a CommonJS source module for one exact filesystem builtin variant.
 *
 * @param moduleName Normalized Node builtin name (`fs` or `fs/promises`).
 * @returns Browser JavaScript whose reads are empty and whose existence checks remain negative.
 */
export function createPreviewNodeFsRuntimeSource(moduleName: 'fs' | 'fs/promises'): string {
  const promisesOnly = moduleName === 'fs/promises';
  return [
    `const moduleName = ${JSON.stringify(moduleName)};`,
    '/** Returns text for encoded reads and an empty byte view for binary reads. */',
    'function createEmptyReadValue(options) {',
    "  const encoding = typeof options === 'string' ? options : options?.encoding;",
    "  return typeof encoding === 'string' && encoding.length > 0 ? '' : new Uint8Array(0);",
    '}',
    '/** Callback-style reads settle asynchronously without exposing any host path. */',
    'function readFile(_path, options, callback) {',
    "  const handler = typeof options === 'function' ? options : callback;",
    "  const readOptions = typeof options === 'function' ? undefined : options;",
    "  if (typeof handler === 'function') queueMicrotask(() => handler(null, createEmptyReadValue(readOptions)));",
    '}',
    '/** Promise-style reads preserve the awaited value shape expected by server helpers. */',
    'function readFilePromise(_path, options) {',
    '  return Promise.resolve(createEmptyReadValue(options));',
    '}',
    '/** Negative filesystem evidence prevents browser code from opening follow-up paths. */',
    'function existsSync() { return false; }',
    '/** Empty directory iteration is deterministic and cannot reveal host entries. */',
    'function readDirectoryPromise() { return Promise.resolve([]); }',
    '/** Nonexistent metadata remains an explicit failure for code that genuinely requires a file. */',
    "function missingPathPromise() { return Promise.reject(Object.assign(new Error('Filesystem unavailable in React Preview.'), { code: 'ENOENT' })); }",
    'const promises = Object.freeze({',
    '  access: missingPathPromise,',
    '  readFile: readFilePromise,',
    '  readdir: readDirectoryPromise,',
    '  stat: missingPathPromise,',
    '});',
    'const facade = {',
    '  existsSync,',
    '  promises,',
    '  readFile,',
    '  readFileSync(_path, options) { return createEmptyReadValue(options); },',
    '  readdir(_path, options, callback) {',
    "    const handler = typeof options === 'function' ? options : callback;",
    "    if (typeof handler === 'function') queueMicrotask(() => handler(null, []));",
    '  },',
    '  readdirSync() { return []; },',
    '};',
    `module.exports = ${promisesOnly ? 'promises' : 'facade'};`,
    "console.warn('[React Preview] Node built-in ' + moduleName + ' is unavailable; reads use empty no-I/O preview values.');",
  ].join('\n');
}
