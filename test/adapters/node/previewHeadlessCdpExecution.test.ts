/** Tests the whole CDP coordinator with real Node pipes and an inert child-process port. */
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodePreviewHeadlessCdpFrames,
  executeChromiumWithCdp,
} from '../../../src/adapters/node/previewHeadlessCdp';
import type {
  CdpMessage,
  PreviewHeadlessSpawnProcess,
} from '../../../src/adapters/node/previewHeadlessModel';

type TerminalScenario = 'eof' | 'malformed' | 'read-error' | 'ready' | 'startup-eof' | 'timeout';

/** Records only the child and byte streams created here; no executable or network is started. */
interface BrowserFixture {
  readonly browser: ChildProcess;
  readonly commands: readonly CdpMessage[];
  readonly killSignals: readonly NodeJS.Signals[];
  readonly owned: readonly ChildProcess[];
  readonly own: (browser: ChildProcess) => void;
  readonly spawn: PreviewHeadlessSpawnProcess;
}

const disposals: (() => void)[] = [];
const BINDING = '__owned_cdp_transport';
const PAYLOAD = '{"transport":"ready"}';

afterEach(async () => {
  for (const dispose of disposals.splice(0)) dispose();
  await new Promise<void>((resolve) => setImmediate(resolve));
});

/** Acknowledges real protocol frames, then loses the response transport after navigation. */
function createBrowserFixture(scenario: TerminalScenario): BrowserFixture {
  const browser = new ChildProcess();
  const input = new PassThrough();
  const output = new PassThrough({ autoDestroy: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  browser.stdout = stdout;
  browser.stderr = stderr;
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  Object.defineProperties(browser, {
    stdio: { value: [null, stdout, stderr, input, output] },
    exitCode: { get: () => exitCode },
    signalCode: { get: () => exitSignal },
  });
  const commands: CdpMessage[] = [];
  const killSignals: NodeJS.Signals[] = [];
  const owned: ChildProcess[] = [];
  let bufferedRequests = '';
  let closed = false;
  const close = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (closed) return;
    closed = true;
    exitCode = code;
    exitSignal = signal;
    input.destroy();
    output.destroy();
    stdout.end();
    stderr.end();
    queueMicrotask(() => browser.emit('close', code, signal));
  };
  browser.kill = (signal): boolean => {
    const ownedSignal = typeof signal === 'string' ? signal : 'SIGTERM';
    killSignals.push(ownedSignal);
    close(null, ownedSignal);
    return true;
  };
  const terminateTransport = (): void => {
    if (scenario === 'eof') output.end();
    else if (scenario === 'malformed') output.write(Buffer.from('{malformed}\0'));
    else if (scenario === 'read-error') output.destroy(new Error('fixture response read failed'));
    else if (scenario === 'ready')
      output.write(
        Buffer.from(
          JSON.stringify({
            method: 'Runtime.bindingCalled',
            params: { name: BINDING, payload: PAYLOAD },
          }) + '\0',
        ),
      );
  };
  input.setEncoding('utf8');
  input.on('data', (chunk: string) => {
    const decoded = decodePreviewHeadlessCdpFrames(bufferedRequests + chunk);
    bufferedRequests = decoded.remainder;
    for (const command of decoded.messages) {
      commands.push(command);
      queueMicrotask(() => {
        if (scenario === 'startup-eof') {
          output.end();
          return;
        }
        const result =
          command.method === 'Target.getTargets'
            ? { targetInfos: [{ targetId: 'owned-page', type: 'page' }] }
            : command.method === 'Target.attachToTarget'
              ? { sessionId: 'owned-session' }
              : {};
        output.write(Buffer.from(JSON.stringify({ id: command.id, result }) + '\0'));
        if (command.method === 'Page.navigate') queueMicrotask(terminateTransport);
        if (command.method === 'Browser.close') close(0, null);
      });
    }
  });
  disposals.push(() => {
    close(0, null);
  });
  return {
    browser,
    commands,
    killSignals,
    owned,
    own: (ownedBrowser) => {
      owned.push(ownedBrowser);
    },
    spawn: () => browser,
  };
}

/** Runs the production coordinator while the spawn port remains an entirely inert test child. */
function executeFixture(fixture: BrowserFixture): ReturnType<typeof executeChromiumWithCdp> {
  return executeChromiumWithCdp(
    'test-owned-cdp-transport',
    'http://127.0.0.1:1/index.html',
    '/test-owned-profile',
    BINDING,
    new Set(['/index.html']),
    200,
    100,
    process.env,
    fixture.spawn,
    fixture.own,
  );
}

describe('headless CDP execution transport termination', () => {
  it.each([
    { scenario: 'eof', diagnostic: 'Chromium CDP response pipe ended.' },
    { scenario: 'malformed', diagnostic: 'JSON' },
    { scenario: 'read-error', diagnostic: 'fixture response read failed' },
  ] as const)(
    'ends execution on post-navigation $scenario without a run timeout',
    async ({ scenario, diagnostic }) => {
      const fixture = createBrowserFixture(scenario);
      const result = await executeFixture(fixture);
      expect(fixture.commands.map((command) => command.method)).toContain('Page.navigate');
      expect(result.timedOut).toBe(false);
      expect(result.payload).toBeUndefined();
      expect(result.timeoutDiagnostic).toBeUndefined();
      expect(result.stderr).toContain(diagnostic);
      expect(result.exitSignal).toBe('SIGTERM');
      expect(fixture.killSignals).toEqual(['SIGTERM']);
      expect(fixture.owned).toEqual([fixture.browser]);
    },
  );

  it('retains normal ready binding delivery and graceful Browser.close', async () => {
    const fixture = createBrowserFixture('ready');
    const result = await executeFixture(fixture);
    expect(result).toMatchObject({
      payload: PAYLOAD,
      timedOut: false,
      exitCode: 0,
      exitSignal: null,
    });
    expect(fixture.commands.at(-1)?.method).toBe('Browser.close');
    expect(fixture.killSignals).toEqual([]);
    expect(fixture.owned).toEqual([fixture.browser]);
  });

  it('keeps startup EOF as a transport failure before any navigation', async () => {
    const fixture = createBrowserFixture('startup-eof');
    const result = await executeFixture(fixture);
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toContain('Chromium CDP response pipe ended.');
    expect(fixture.commands.map((command) => command.method)).toEqual(['Target.getTargets']);
    expect(fixture.killSignals).toEqual(['SIGTERM']);
  });

  it('retains timeout diagnostics and graceful cleanup when a live pipe stays silent', async () => {
    const fixture = createBrowserFixture('timeout');
    const result = await executeFixture(fixture);
    expect(result.timedOut).toBe(true);
    expect(result.payload).toBeUndefined();
    expect(result.timeoutDiagnostic).toBeTypeOf('string');
    expect(fixture.commands.map((command) => command.method)).toContain('Runtime.evaluate');
    expect(fixture.commands.at(-1)?.method).toBe('Browser.close');
    expect(result.exitCode).toBe(0);
    expect(fixture.killSignals).toEqual([]);
  });
});
