/** Verifies browser-safe neutralization of Node built-ins reached through optional package code. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewNodeBuiltinPlugin } from '../../../src/adapters/esbuild/previewNodeBuiltinPlugin';

describe('createPreviewNodeBuiltinPlugin', () => {
  /** Supports default, named, and node:-prefixed imports without exposing a real host capability. */
  it('bundles Node built-ins as callable neutral CommonJS values', async () => {
    const result = await build({
      bundle: true,
      format: 'cjs',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [createPreviewNodeBuiltinPlugin()],
      stdin: {
        contents: [
          "import fs, { existsSync, readFileSync } from 'fs';",
          "import promises from 'node:fs/promises';",
          'globalThis.__nodeBuiltinResult = {',
          '  defaultMember: typeof fs.readFileSync,',
          '  namedMember: typeof readFileSync,',
          '  nestedMember: typeof promises.readFile,',
          "  neutralCall: existsSync('/host-secret'),",
          '};',
        ].join('\n'),
        loader: 'js',
      },
      write: false,
    });
    const warning = vi.fn();
    const context: { __nodeBuiltinResult?: Record<string, unknown> } = {};
    runInNewContext(result.outputFiles[0]?.text ?? '', {
      ...context,
      console: { warn: warning },
      globalThis: context,
    });

    expect(context.__nodeBuiltinResult).toEqual({
      defaultMember: 'function',
      namedMember: 'function',
      nestedMember: 'function',
      neutralCall: undefined,
    });
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
  });

  /**
   * Preserves strict-mode prototype augmentation used by legacy readable-stream implementations.
   * The neutral namespace remains entirely browser-local while authored assignments replace its
   * export-shaped placeholders and inherited child methods without getter-only descriptor errors.
   */
  it('keeps neutral builtin namespaces writable across legacy prototype inheritance', async () => {
    const result = await build({
      bundle: true,
      format: 'cjs',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [createPreviewNodeBuiltinPlugin()],
      stdin: {
        contents: [
          "import Stream from 'node:stream';",
          'function inherits(Child, Parent) {',
          '  Child.prototype = Object.create(Parent.prototype, {',
          '    constructor: { configurable: true, value: Child, writable: true },',
          '  });',
          '}',
          'function Readable() {}',
          'inherits(Readable, Stream);',
          'function ReadStream() {}',
          'inherits(ReadStream, Readable);',
          "ReadStream.prototype.destroy = function destroy() { return 'destroyed'; };",
          "Stream.destroy = function destroy() { return 'local override'; };",
          "Stream.previewState = 'browser-local';",
          'globalThis.__writableBuiltinResult = {',
          '  childDestroy: new ReadStream().destroy(),',
          '  prototypeType: typeof Stream.prototype,',
          '  state: Stream.previewState,',
          '  streamDestroy: Stream.destroy(),',
          "  writableDestroy: Object.getOwnPropertyDescriptor(Stream, 'destroy')?.writable,",
          '};',
        ].join('\n'),
        loader: 'js',
      },
      write: false,
    });
    const context: { __writableBuiltinResult?: Record<string, unknown> } = {};
    runInNewContext(result.outputFiles[0]?.text ?? '', {
      console: { warn: vi.fn() },
      globalThis: context,
    });

    expect(context.__writableBuiltinResult).toEqual({
      childDestroy: 'destroyed',
      prototypeType: 'object',
      state: 'browser-local',
      streamDestroy: 'local override',
      writableDestroy: true,
    });
  });

  /** Keeps legacy browser packages working when they enumerate EventEmitter prototype methods. */
  it('provides an in-memory EventEmitter for browser-compatible package entry points', async () => {
    const result = await build({
      bundle: true,
      format: 'cjs',
      logLevel: 'silent',
      platform: 'browser',
      plugins: [createPreviewNodeBuiltinPlugin()],
      stdin: {
        contents: [
          "import EventEmitter, { EventEmitter as NamedEventEmitter } from 'node:events';",
          'const emitter = new EventEmitter();',
          'const received = [];',
          "emitter.on('change', (value) => received.push('on:' + value));",
          "emitter.once('change', (value) => received.push('once:' + value));",
          "const firstEmit = emitter.emit('change', 1);",
          "const secondEmit = emitter.emit('change', 2);",
          'function LegacyConstructor() {}',
          'const legacyEmitter = new NamedEventEmitter();',
          'for (const name of Object.keys(NamedEventEmitter.prototype)) {',
          "  if (typeof NamedEventEmitter.prototype[name] === 'function') {",
          '    LegacyConstructor[name] = NamedEventEmitter.prototype[name].bind(legacyEmitter);',
          '  }',
          '}',
          "let legacyCalls = 0; LegacyConstructor.on('ready', () => { legacyCalls += 1; });",
          "LegacyConstructor.emit('ready');",
          'globalThis.__nodeEventsResult = {',
          "  hasEnumerableOn: Object.keys(NamedEventEmitter.prototype).includes('on'),",
          '  firstEmit, secondEmit, received, legacyCalls,',
          '};',
        ].join('\n'),
        loader: 'js',
      },
      write: false,
    });
    const context: { __nodeEventsResult?: Record<string, unknown> } = {};
    runInNewContext(result.outputFiles[0]?.text ?? '', {
      globalThis: context,
    });

    expect(context.__nodeEventsResult).toEqual({
      firstEmit: true,
      hasEnumerableOn: true,
      legacyCalls: 1,
      received: ['on:1', 'once:1', 'on:2'],
      secondEmit: true,
    });
  });

  /** Uses an authored dependency's browser implementation before falling back to a builtin shim. */
  it('prefers an installed package for a bare legacy builtin import', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'react-preview-node-builtin-'));
    try {
      const packageDirectory = path.join(workspace, 'node_modules', 'events');
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({ browser: 'browser.js', main: 'server.js', name: 'events' }),
      );
      await writeFile(
        path.join(packageDirectory, 'browser.js'),
        'module.exports = { implementation: "project-browser-events" };',
      );
      await writeFile(
        path.join(packageDirectory, 'server.js'),
        'module.exports = { implementation: "server-events" };',
      );
      const result = await build({
        absWorkingDir: workspace,
        bundle: true,
        format: 'cjs',
        logLevel: 'silent',
        platform: 'browser',
        plugins: [createPreviewNodeBuiltinPlugin()],
        stdin: {
          contents: [
            "import events from 'events';",
            'globalThis.__browserEventsResult = events.implementation;',
          ].join('\n'),
          loader: 'js',
          resolveDir: workspace,
        },
        write: false,
      });
      const context: { __browserEventsResult?: string } = {};
      runInNewContext(result.outputFiles[0]?.text ?? '', { globalThis: context });

      expect(context.__browserEventsResult).toBe('project-browser-events');
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
