/**
 * Generates a browser-only subset of Node's `os` module.
 *
 * Server packages reached through shared modules read host facts while they evaluate: Prisma's
 * cuid fingerprint takes `os.hostname().length`, pools size themselves with `os.cpus().length`, and
 * loggers append `os.EOL`. The generic callable builtin fallback returns `undefined` for every
 * call, so those modules throw before any component renders. These values describe one neutral
 * browser host; nothing is read from the extension host.
 */

/** Returns CommonJS source implementing the host-information functions used at module scope. */
export function createPreviewNodeOsRuntimeSource(): string {
  return [
    "const cpu = Object.freeze({ model: 'preview', speed: 0, times: Object.freeze({ idle: 0, irq: 0, nice: 0, sys: 0, user: 0 }) });",
    'const facade = {',
    "  EOL: '\\n',",
    "  arch: () => 'arm64',",
    '  availableParallelism: () => 1,',
    '  constants: Object.freeze({ errno: Object.freeze({}), priority: Object.freeze({}), signals: Object.freeze({}) }),',
    '  cpus: () => [cpu],',
    "  devNull: '/dev/null',",
    "  endianness: () => 'LE',",
    '  freemem: () => 0,',
    '  getPriority: () => 0,',
    "  homedir: () => '/',",
    "  hostname: () => 'localhost',",
    '  loadavg: () => [0, 0, 0],',
    "  machine: () => 'arm64',",
    '  networkInterfaces: () => ({}),',
    "  platform: () => 'linux',",
    "  release: () => '0.0.0',",
    '  setPriority: () => undefined,',
    "  tmpdir: () => '/tmp',",
    '  totalmem: () => 0,',
    "  type: () => 'Linux',",
    '  uptime: () => 0,',
    "  userInfo: () => ({ gid: 0, homedir: '/', shell: null, uid: 0, username: 'preview' }),",
    "  version: () => 'preview',",
    '};',
    'module.exports = facade;',
    "console.warn('[React Preview] Node built-in os uses a neutral browser host facade.');",
  ].join('\n');
}
