/** Owns CDP framing, requests, browser startup, and the bounded inspection loop. */
import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { boundedJson, collectTimeoutDiagnostic } from './previewHeadlessEvidence';
import {
  appendBounded,
  captureBoundedStream,
  createCancellableDeadline,
  isBrowserTerminated,
  retainEvidence,
  terminateOwnedBrowser,
  validateCdpRequestTimeout,
  waitForBrowserClose,
} from './previewHeadlessLifecycle';
import {
  CDP_REQUEST_TIMEOUT_MS,
  CDP_STARTUP_REQUEST_TIMEOUT_MS,
  MAX_EVIDENCE_ITEMS,
  type BrowserExecution,
  type CdpMessage,
  type PreviewHeadlessCdpCommand,
  type PreviewHeadlessCdpFrames,
  type PreviewHeadlessSpawnProcess,
} from './previewHeadlessModel';
import { classifyPreviewHeadlessNetworkFailure } from './previewHeadlessServer';
import { createPreviewManagedChildEnvironment } from './previewManagedChildEnvironment';

/** Decodes only complete NUL-delimited CDP frames and retains the partial suffix. */
export function decodePreviewHeadlessCdpFrames(source: string): PreviewHeadlessCdpFrames {
  const frames = source.split('\0');
  const remainder = frames.pop() ?? '';
  const messages = frames
    .filter((frame) => frame.length > 0)
    .map((frame) => JSON.parse(frame) as CdpMessage);
  return { messages, remainder };
}

/** Lists page commands with the host binding provably installed before navigation. */
export function createPreviewHeadlessCdpCommands(
  bindingName: string,
  documentUrl: string,
  virtualTimeMs: number,
): readonly PreviewHeadlessCdpCommand[] {
  // Stabilization owns virtual-time advancement; retain the existing public plan signature.
  void virtualTimeMs;
  return [
    { method: 'Page.enable', params: {} },
    { method: 'Runtime.enable', params: {} },
    { method: 'Log.enable', params: {} },
    { method: 'Runtime.addBinding', params: { name: bindingName } },
    { method: 'Page.navigate', params: { url: documentUrl } },
  ];
}

/** Preserves UTF-8 frames and signals terminal transport failure to requests and execution. */
export class CdpPipeClient {
  private buffer = '';
  private closedError: Error | undefined;
  private resolveClosed: ((error: Error) => void) | undefined;
  private readonly decoder = new StringDecoder('utf8');
  private nextId = 1;
  private readonly listeners = new Set<(message: CdpMessage) => void>();
  private readonly pending = new Map<
    number,
    { readonly reject: (error: Error) => void; readonly resolve: (value: CdpMessage) => void }
  >();

  /** Resolves once with the first transport failure; never rejects or replaces that cause. */
  public readonly closed = new Promise<Error>((resolve) => {
    this.resolveClosed = resolve;
  });

  /** Connects request output and event/response input for one owned browser pipe. */
  public constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
    output.on('data', (chunk: Buffer) => {
      if (this.closedError !== undefined) return;
      try {
        const decoded = decodePreviewHeadlessCdpFrames(this.buffer + this.decoder.write(chunk));
        this.buffer = decoded.remainder;
        for (const message of decoded.messages) this.receive(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    input.once('error', (error) => {
      this.fail(error);
    });
    input.once('close', () => {
      this.fail(new Error('Chromium CDP request pipe closed.'));
    });
    output.once('error', (error) => {
      this.fail(error);
    });
    output.once('end', () => {
      this.fail(new Error('Chromium CDP response pipe ended.'));
    });
    output.once('close', () => {
      this.fail(new Error('Chromium CDP response pipe closed.'));
    });
  }

  /** Subscribes to CDP events and returns a synchronous detach function. */
  public onEvent(listener: (message: CdpMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Sends one bounded request over the browser or attached page session. */
  public request(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = CDP_REQUEST_TIMEOUT_MS,
  ): Promise<CdpMessage> {
    const requestTimeoutMs = validateCdpRequestTimeout(timeoutMs);
    if (this.closedError !== undefined) return Promise.reject(this.closedError);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP request timed out: ${method}`));
      }, requestTimeoutMs);
      this.pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (message) => {
          clearTimeout(timer);
          resolve(message);
        },
      });
      this.input.write(
        `${JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) })}\0`,
        (error) => {
          if (error !== null && error !== undefined) this.fail(error);
        },
      );
    });
  }

  /** Stops event admission, rejects pending requests, and signals the first terminal cause. */
  public fail(error: Error): void {
    if (this.closedError !== undefined) return;
    this.closedError = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.listeners.clear();
    this.buffer = '';
    this.resolveClosed?.(error);
    this.resolveClosed = undefined;
  }

  /** Routes responses to callers and broadcasts target events. */
  private receive(message: CdpMessage): void {
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (pending === undefined) return;
      this.pending.delete(message.id);
      if (message.error === undefined) pending.resolve(message);
      else pending.reject(new Error(message.error.message ?? 'Unknown CDP error.'));
      return;
    }
    for (const listener of this.listeners) listener(message);
  }
}

/** Launches Chromium, installs the binding before navigation, and waits only for its payload. */
export async function executeChromiumWithCdp(
  executable: string,
  documentUrl: string,
  profilePath: string,
  bindingName: string,
  plannedRoutePaths: ReadonlySet<string>,
  timeoutMs: number,
  virtualTimeMs: number,
  parentEnvironment: Readonly<NodeJS.ProcessEnv>,
  spawnProcess: PreviewHeadlessSpawnProcess,
  own: (browser: ChildProcess) => void,
): Promise<BrowserExecution> {
  const browser = spawnProcess(
    executable,
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-default-browser-check',
      '--no-first-run',
      '--remote-debugging-pipe',
      `--user-data-dir=${profilePath}`,
      'about:blank',
    ],
    {
      detached: process.platform !== 'win32',
      env: createPreviewManagedChildEnvironment(parentEnvironment),
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    },
  );
  own(browser);
  const stderr = captureBoundedStream(browser.stderr);
  const input = browser.stdio[3] as Writable | null;
  const output = browser.stdio[4] as Readable | null;
  if (input === null || output === null)
    throw new Error('Chromium CDP pipe descriptors are unavailable.');
  const client = new CdpPipeClient(input, output);
  const processEndPromise = new Promise<{ readonly detail: string; readonly kind: 'process-end' }>(
    (resolve) => {
      browser.once('error', (error) => {
        client.fail(error);
        resolve({ detail: error.message, kind: 'process-end' });
      });
      browser.once('close', (code, signal) => {
        const detail =
          signal === null
            ? `Chromium closed with code ${String(code)}.`
            : `Chromium exited from signal ${signal}.`;
        client.fail(new Error(detail));
        resolve({ detail, kind: 'process-end' });
      });
    },
  );
  const runtimeEvents: string[] = [];
  const cdpExceptions: string[] = [];
  const incidentalNetworkFailures: string[] = [];
  const requiredArtifactFailures: string[] = [];
  let payload: string | undefined;
  let pageSessionId: string | undefined;
  let timeoutDiagnostic: string | undefined;
  let timedOut = false;
  const bindingPromise = new Promise<string>((resolve) => {
    client.onEvent((message) => {
      if (
        (message.method === 'Runtime.exceptionThrown' ||
          message.method === 'Runtime.consoleAPICalled' ||
          message.method === 'Log.entryAdded') &&
        runtimeEvents.length < MAX_EVIDENCE_ITEMS
      )
        runtimeEvents.push(boundedJson(message));
      if (message.method === 'Runtime.exceptionThrown') {
        retainEvidence(cdpExceptions, boundedJson(message));
        if (pageSessionId !== undefined) {
          const stateName = `${bindingName}State`;
          void client
            .request(
              'Runtime.evaluate',
              {
                expression: `(() => { const state = globalThis[${JSON.stringify(stateName)}]; if (state?.terminal?.type === 'react-preview-runtime-ready') state.lastActivityAt = Date.now(); })()`,
              },
              pageSessionId,
            )
            .catch(() => undefined);
        }
      }
      // VS Code webviews are sandboxed without `allow-modals`, so alert/confirm/prompt return at
      // once there. An unanswered CDP dialog would instead freeze the page until the timeout.
      if (message.method === 'Page.javascriptDialogOpening' && pageSessionId !== undefined) {
        if (runtimeEvents.length < MAX_EVIDENCE_ITEMS) runtimeEvents.push(boundedJson(message));
        void client
          .request('Page.handleJavaScriptDialog', { accept: false }, pageSessionId)
          .catch(() => undefined);
      }
      if (message.method === 'Log.entryAdded') {
        const failure = classifyPreviewHeadlessNetworkFailure(
          message.params?.entry,
          documentUrl,
          plannedRoutePaths,
        );
        if (failure?.required === true) retainEvidence(requiredArtifactFailures, failure.text);
        else if (failure !== undefined) retainEvidence(incidentalNetworkFailures, failure.text);
      }
      if (
        message.method === 'Runtime.bindingCalled' &&
        message.params?.name === bindingName &&
        typeof message.params.payload === 'string'
      )
        resolve(message.params.payload);
    });
  });
  try {
    const targetResponse = await client.request(
      'Target.getTargets',
      {},
      undefined,
      CDP_STARTUP_REQUEST_TIMEOUT_MS,
    );
    const targetInfos = targetResponse.result?.targetInfos;
    const targetCandidates: unknown[] = Array.isArray(targetInfos)
      ? (targetInfos as unknown[])
      : [];
    const page: unknown = targetCandidates.find(
      (candidate) =>
        typeof candidate === 'object' &&
        candidate !== null &&
        (candidate as { readonly type?: unknown }).type === 'page',
    );
    let targetId = (page as { readonly targetId?: unknown } | undefined)?.targetId;
    if (typeof targetId !== 'string') {
      const created = await client.request(
        'Target.createTarget',
        { url: 'about:blank' },
        undefined,
        CDP_STARTUP_REQUEST_TIMEOUT_MS,
      );
      targetId = created.result?.targetId;
    }
    if (typeof targetId !== 'string')
      throw new Error('Chromium did not expose an attachable page.');
    const attached = await client.request(
      'Target.attachToTarget',
      { flatten: true, targetId },
      undefined,
      CDP_STARTUP_REQUEST_TIMEOUT_MS,
    );
    const sessionId = attached.result?.sessionId;
    if (typeof sessionId !== 'string')
      throw new Error('Chromium did not attach a page CDP session.');
    pageSessionId = sessionId;
    for (const command of createPreviewHeadlessCdpCommands(
      bindingName,
      documentUrl,
      virtualTimeMs,
    )) {
      await client.request(command.method, command.params, sessionId);
    }
    const deadline = createCancellableDeadline(timeoutMs);
    const outcome = await Promise.race([
      bindingPromise.then((value) => ({ kind: 'payload' as const, value })),
      client.closed.then((error) => ({ detail: error.message, kind: 'transport-end' as const })),
      deadline.promise.then(() => ({ kind: 'timeout' as const })),
      processEndPromise,
    ]).finally(() => {
      deadline.cancel();
    });
    if (outcome.kind === 'payload') payload = outcome.value;
    else if (outcome.kind === 'timeout') {
      timedOut = true;
      timeoutDiagnostic = await collectTimeoutDiagnostic(client, sessionId, bindingName);
    } else {
      throw new Error(outcome.detail);
    }
    void client.request('Browser.close').catch(() => undefined);
    await waitForBrowserClose(browser, 750);
    if (!isBrowserTerminated(browser)) await terminateOwnedBrowser(browser);
    return {
      cdpExceptions,
      exitCode: browser.exitCode,
      exitSignal: browser.signalCode,
      incidentalNetworkFailures,
      ...(payload === undefined ? {} : { payload }),
      requiredArtifactFailures,
      runtimeEvents,
      stderr: stderr(),
      timedOut,
      ...(timeoutDiagnostic === undefined ? {} : { timeoutDiagnostic }),
    };
  } catch (error) {
    await waitForBrowserClose(browser, 100);
    if (!isBrowserTerminated(browser)) await terminateOwnedBrowser(browser);
    return {
      cdpExceptions,
      exitCode: browser.exitCode,
      exitSignal: browser.signalCode,
      incidentalNetworkFailures,
      requiredArtifactFailures,
      runtimeEvents,
      stderr: appendBounded(stderr(), error instanceof Error ? error.message : String(error)),
      timedOut,
    };
  }
}

/** Adapts Node's mutable argument array signature to the renderer's read-only spawn seam. */
export function spawnPreviewHeadlessProcess(
  executable: string,
  arguments_: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  return spawn(executable, [...arguments_], options);
}
