/** Proves exact committed boundary ownership against the installed real ReactDOM runtime. */
import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorFiberRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFiberRuntimeSource';
import { discoverPreviewChromiumPath } from '../../../../src/adapters/node/previewChromiumPath';
import { createPreviewManagedChildEnvironment } from '../../../../src/adapters/node/previewManagedChildEnvironment';

const temporaryDirectories: string[] = [];
const chromiumPath = discoverPreviewChromiumPath();

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('Preview Inspector exact Fiber ownership with real ReactDOM', () => {
  for (const reactMajor of [18, 19] as const) {
    it.skipIf(chromiumPath === undefined)(
      `marks committed boundaries and sibling updates with React ${reactMajor.toString()}`,
      async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), 'react-preview-fiber-ownership-'));
        temporaryDirectories.push(directory);
        const entry = path.join(directory, 'entry.tsx');
        const owner = path.join(directory, 'AuthenticOwner.tsx');
        const target = path.join(directory, 'SelectedTarget.tsx');
        const targetFacade = path.join(directory, 'SelectedTargetFacade.tsx');
        const bundle = path.join(directory, 'bundle.js');
        const page = path.join(directory, 'index.html');
        await Promise.all([
          writeFile(entry, browserFixtureSource(), 'utf8'),
          writeFile(owner, authenticOwnerFixtureSource(), 'utf8'),
          writeFile(target, selectedTargetFixtureSource(), 'utf8'),
          writeFile(targetFacade, selectedTargetFacadeFixtureSource(), 'utf8'),
        ]);
        const buildResult = await build({
          ...(reactMajor === 18
            ? {
                alias: {
                  react: path.resolve('node_modules/react-preview-react-18'),
                  'react-dom': path.resolve('node_modules/react-preview-react-dom-18'),
                },
              }
            : {}),
          bundle: true,
          entryPoints: [entry],
          format: 'iife',
          globalName: 'PreviewFiberFixture',
          jsx: 'automatic',
          jsxDev: true,
          nodePaths: [path.join(process.cwd(), 'node_modules')],
          outfile: bundle,
          platform: 'browser',
          write: true,
        });
        expect(buildResult.warnings).toEqual([]);
        await writeFile(
          page,
          '<main id="root"></main><script src="bundle.js"></script><script>PreviewFiberFixture.run().catch((error)=>{const output=document.createElement("output");output.id="result";output.textContent=JSON.stringify({error:String(error),stack:String(error?.stack??"")});document.body.append(output)})</script>',
          'utf8',
        );
        const chromium = chromiumPath;
        if (chromium === undefined) {
          throw new Error('Chromium was unavailable when this proof was registered.');
        }
        const result = await runChromiumFixture(
          chromium,
          pathToFileURL(page).href,
          path.join(directory, 'chromium-profile'),
        );
        const parsed = JSON.parse(result) as {
          readonly bailoutCounters: readonly number[];
          readonly direct: { readonly currentFileMounted: number; readonly status: string };
          readonly error?: string;
          readonly nested: {
            readonly currentFileMounted: number;
            readonly executionRootExportName: string;
            readonly names: readonly string[];
            readonly nestedMountCount: number;
            readonly rootCommitted: boolean;
            readonly status: string;
            readonly targetCommitted: boolean;
            readonly targetExportName: string;
          };
          readonly phases: readonly string[];
        };
        expect(parsed.error).toBeUndefined();
        expect(parsed.direct).toMatchObject({ currentFileMounted: 1, status: 'available' });
        expect(parsed.nested).toMatchObject({ currentFileMounted: 1, status: 'available' });
        expect(parsed.nested.names).toContain('AuthenticOwner');
        expect(parsed.nested).toMatchObject({
          executionRootExportName: 'AuthenticOwner',
          nestedMountCount: 1,
          rootCommitted: true,
          targetCommitted: true,
          targetExportName: 'SelectedTarget',
        });
        expect(parsed.phases).toContain('fiber-availability');
        expect(parsed.phases).toContain('source-export-match');
        expect(parsed.bailoutCounters).toEqual([1, 2, 3]);
      },
      60_000,
    );
  }
});

interface FixtureCdpMessage {
  readonly error?: { readonly message?: string };
  readonly id?: number;
  readonly result?: Record<string, unknown>;
}

/** Minimal null-delimited CDP pipe client used only by the real-browser ownership proof. */
class FixtureCdpClient {
  private buffer = '';
  private failure: Error | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      readonly reject: (error: Error) => void;
      readonly resolve: (message: FixtureCdpMessage) => void;
      readonly timer: ReturnType<typeof setTimeout>;
    }
  >();

  /** Observes complete CDP frames for this owned fixture process. */
  public constructor(
    private readonly input: Writable,
    output: Readable,
    private readonly requestTimeoutMs = 10_000,
  ) {
    input.on('error', (error) => {
      this.close(error);
    });
    input.once('close', () => {
      this.close(new Error('Chromium CDP input closed.'));
    });
    output.on('error', (error) => {
      this.close(error);
    });
    output.once('end', () => {
      this.close(new Error('Chromium CDP output ended.'));
    });
    output.once('close', () => {
      this.close(new Error('Chromium CDP output closed.'));
    });
    output.on('data', (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      for (let boundary = this.buffer.indexOf('\0'); boundary >= 0;) {
        const encoded = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 1);
        if (encoded.length > 0) this.receive(JSON.parse(encoded) as FixtureCdpMessage);
        boundary = this.buffer.indexOf('\0');
      }
    });
  }

  /** Sends one correlated CDP request and resolves only its matching response. */
  public request(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<FixtureCdpMessage> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close(new Error(`Chromium CDP request timed out: ${method}`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { reject, resolve, timer });
      try {
        this.input.write(
          `${JSON.stringify({
            id,
            method,
            params,
            ...(sessionId === undefined ? {} : { sessionId }),
          })}\0`,
        );
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Rejects all active and future requests after transport failure, clearing every deadline. */
  public close(error: Error): void {
    if (this.failure !== undefined) return;
    this.failure = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /** Dispatches a decoded response to its pending request without retaining browser handles. */
  private receive(message: FixtureCdpMessage): void {
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error === undefined) pending.resolve(message);
    else pending.reject(new Error(message.error.message ?? 'Unknown CDP error.'));
  }
}

describe('Fixture CDP transport lifecycle', () => {
  it.each(['input', 'output'] as const)(
    'rejects requests when the %s pipe closes',
    async (pipe) => {
      const input = new PassThrough();
      const output = new PassThrough();
      const client = new FixtureCdpClient(input, output);
      const rejected = expect(client.request('Target.getTargets')).rejects.toThrow('closed');
      (pipe === 'input' ? input : output).destroy();
      await rejected;
      await expect(client.request('Browser.close')).rejects.toThrow('closed');
      input.destroy();
      output.destroy();
    },
  );

  it('rejects pending and future requests when output ends', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new FixtureCdpClient(input, output);
    const rejected = expect(client.request('Target.getTargets')).rejects.toThrow('output ended');
    output.end();
    await rejected;
    await expect(client.request('Browser.close')).rejects.toThrow('output ended');
    input.destroy();
    output.destroy();
  });

  it.each(['input', 'output'] as const)('rejects requests when the %s pipe fails', async (pipe) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const client = new FixtureCdpClient(input, output);
    const rejected = expect(client.request('Target.getTargets')).rejects.toThrow(
      'fixture pipe failed',
    );
    (pipe === 'input' ? input : output).emit('error', new Error('fixture pipe failed'));
    await rejected;
    await expect(client.request('Browser.close')).rejects.toThrow('fixture pipe failed');
    input.destroy();
    output.destroy();
  });

  it('bounds a silent pipe and does not leave a shutdown request or timer pending', async () => {
    vi.useFakeTimers();
    const input = new PassThrough();
    const output = new PassThrough();
    try {
      const client = new FixtureCdpClient(input, output, 50);
      const rejected = expect(client.request('Target.getTargets')).rejects.toThrow(
        'request timed out',
      );
      await vi.advanceTimersByTimeAsync(50);
      await rejected;
      await expect(client.request('Browser.close')).rejects.toThrow('request timed out');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      input.destroy();
      output.destroy();
      vi.useRealTimers();
    }
  });

  it('clears the request deadline after a correlated reply', async () => {
    vi.useFakeTimers();
    const input = new PassThrough();
    const output = new PassThrough();
    try {
      const client = new FixtureCdpClient(input, output, 50);
      const response = client.request('Target.getTargets');
      output.write(`${JSON.stringify({ id: 1, result: { targetInfos: [] } })}\0`);
      await expect(response).resolves.toMatchObject({ result: { targetInfos: [] } });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      input.destroy();
      output.destroy();
      vi.useRealTimers();
    }
  });
});

/** Uses the production CDP-pipe launch shape so Chromium never depends on `--dump-dom`. */
async function runChromiumFixture(
  executable: string,
  pageUrl: string,
  profilePath: string,
): Promise<string> {
  // Spawn can fail before both pipes exist, so its error listeners need a safe empty connection.
  const connection: { client?: FixtureCdpClient } = {};
  let stderr = '';
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-sync',
      '--no-first-run',
      '--remote-debugging-pipe',
      `--user-data-dir=${profilePath}`,
      'about:blank',
    ],
    {
      env: createPreviewManagedChildEnvironment(process.env),
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'],
    },
  );
  browser.once('error', (error) => {
    connection.client?.close(error);
  });
  browser.once('exit', (code, signal) => {
    connection.client?.close(
      new Error(`Chromium fixture exited: ${String(code ?? signal)}. ${stderr}`),
    );
  });
  browser.stderr?.on('data', (chunk: Buffer | string) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });
  const input = browser.stdio[3] as Writable | null | undefined;
  const output = browser.stdio[4] as Readable | null | undefined;
  if (input === null || input === undefined || output === null || output === undefined) {
    browser.kill('SIGKILL');
    throw new Error('Chromium CDP fixture pipes are unavailable.');
  }
  const client = new FixtureCdpClient(input, output);
  connection.client = client;
  try {
    const targetResponse = await client.request('Target.getTargets');
    const targetInfos = targetResponse.result?.targetInfos;
    const page: unknown = Array.isArray(targetInfos)
      ? targetInfos.find(
          (candidate) =>
            candidate !== null &&
            typeof candidate === 'object' &&
            (candidate as { readonly type?: unknown }).type === 'page',
        )
      : undefined;
    let targetId = (page as { readonly targetId?: unknown } | undefined)?.targetId;
    if (typeof targetId !== 'string') {
      const created = await client.request('Target.createTarget', { url: 'about:blank' });
      targetId = created.result?.targetId;
    }
    if (typeof targetId !== 'string') throw new Error('Chromium exposed no fixture page.');
    const attached = await client.request('Target.attachToTarget', {
      flatten: true,
      targetId,
    });
    const sessionId = attached.result?.sessionId;
    if (typeof sessionId !== 'string') throw new Error('Chromium did not attach the fixture page.');
    await client.request('Page.enable', {}, sessionId);
    await client.request('Runtime.enable', {}, sessionId);
    await client.request('Page.navigate', { url: pageUrl }, sessionId);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const response = await client.request(
        'Runtime.evaluate',
        {
          expression: "document.querySelector('#result')?.textContent ?? ''",
          returnByValue: true,
        },
        sessionId,
      );
      const remote = response.result?.result as { readonly value?: unknown } | undefined;
      if (typeof remote?.value === 'string' && remote.value.length > 0) return remote.value;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Chromium fixture timed out before ownership output. ${stderr}`);
  } finally {
    await client.request('Browser.close').catch(() => undefined);
    await Promise.race([
      new Promise<void>((resolve) =>
        browser.once('close', () => {
          resolve();
        }),
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (browser.exitCode === null && browser.signalCode === null) browser.kill('SIGKILL');
  }
}

/** Creates target-only and distinct-root corridors around real class boundary instances. */
function browserFixtureSource(): string {
  return (
    createPreviewInspectorFiberRuntimeSource() +
    String.raw`
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AuthenticOwner, PreviewInspectorTargetBoundary } from './AuthenticOwner';
import { SelectedTarget } from './SelectedTarget';
const phases = [];
function registerPreviewInspectorTargetOwnershipPhase(_metadata, phase) { phases.push(phase); }
function hasPreviewInspectorOwnedBoundary() { return false; }
function readPreviewInspectorOwnedHosts() { return []; }
function normalizePreviewInspectorHostElement(value) {
  return value?.nodeType === 1 && typeof value?.getBoundingClientRect === 'function'
    ? value
    : undefined;
}
class PreviewPageInspectorExportBoundary extends React.Component {
  render() { return this.props.children; }
}
function collect(boundary, root) {
  const target = { exportName: 'SelectedTarget', sourcePath: '/workspace/SelectedTarget.tsx' };
  const snapshot = collectPreviewInspectorFiberTree(
    [{ boundary, exportName: target.exportName, sourcePath: target.sourcePath }],
    undefined,
    {
      descriptor: { inspector: { renderChainsByExport: {}, root, target } },
      pageCandidate: { root },
      selectedExportName: target.exportName,
      targetExportName: target.exportName,
      targetExportNames: [target.exportName],
    },
  );
  const nodes = [];
  const visit = (node) => { nodes.push(node); for (const child of node.children ?? []) visit(child); };
  for (const node of snapshot.roots) visit(node);
  return {
    bailoutCounter: nodes.find((node) => node.name === 'BailoutCounter')?.props?.count,
    currentFileMounted: nodes.filter(
      (node) => node.currentFileExport === true && node.mounted === true,
    ).length,
    executionRootExportName: root.exportName,
    names: nodes.map((node) => node.name),
    nestedMountCount: root.exportName === target.exportName ? 0 : 1,
    rootCommitted: nodes.some((node) => node.name === root.exportName),
    status: snapshot.status,
    targetCommitted: nodes.some(
      (node) => node.currentFileExport === true && node.mounted === true,
    ),
    targetExportName: target.exportName,
  };
}
export async function run() {
  const directRef = React.createRef();
  const nestedRef = React.createRef();
  const root = createRoot(document.querySelector('#root'));
  root.render(<>
    <PreviewPageInspectorExportBoundary>
      <PreviewInspectorTargetBoundary
        exportName="SelectedTarget"
        ref={directRef}
        sourcePath="/workspace/SelectedTarget.tsx"
      ><SelectedTarget label="direct" /></PreviewInspectorTargetBoundary>
    </PreviewPageInspectorExportBoundary>
    <PreviewPageInspectorExportBoundary>
      <AuthenticOwner boundaryRef={nestedRef} />
    </PreviewPageInspectorExportBoundary>
  </>);
  await new Promise((resolve) => setTimeout(resolve, 80));
  const directTarget = {
    exportName: 'SelectedTarget',
    sourcePath: '/workspace/SelectedTarget.tsx',
  };
  const direct = collect(directRef.current, directTarget);
  const nested = collect(nestedRef.current, {
    exportName: 'AuthenticOwner',
    sourcePath: '/workspace/AuthenticOwner.tsx',
  });
  const bailoutRef = React.createRef();
  const StableTarget = React.memo(function StableTarget() {
    return <PreviewInspectorTargetBoundary ref={bailoutRef}
      exportName="SelectedTarget" sourcePath="/workspace/SelectedTarget.tsx">
      <SelectedTarget label="bailout" />
    </PreviewInspectorTargetBoundary>;
  });
  function BailoutCounter({ count }) { return <span>{count}</span>; }
  function BailoutPage({ count }) {
    return <section><StableTarget /><BailoutCounter count={count} /></section>;
  }
  const bailoutCounters = [];
  for (const count of [1, 2, 3]) {
    root.render(<PreviewPageInspectorExportBoundary><BailoutPage count={count} /></PreviewPageInspectorExportBoundary>);
    await new Promise((resolve) => setTimeout(resolve, 80));
    bailoutCounters.push(collect(bailoutRef.current, {
      exportName: 'BailoutPage', sourcePath: '/workspace/BailoutPage.tsx',
    }).bailoutCounter);
  }
  const output = document.createElement('output');
  output.id = 'result';
  output.textContent = JSON.stringify({ direct, nested, phases, bailoutCounters });
  document.body.append(output);
  root.unmount();
}
`
  );
}

/** A real named execution-root module that authors the target-facade child edge. */
function authenticOwnerFixtureSource(): string {
  return String.raw`
import * as React from 'react';
import SelectedTargetFacade from './SelectedTargetFacade';
export class PreviewInspectorTargetBoundary extends React.Component {
  render() { return this.props.children; }
}
export function AuthenticOwner({ boundaryRef }) {
  return <article><PreviewInspectorTargetBoundary
    exportName="SelectedTarget"
    ref={boundaryRef}
    sourcePath="/workspace/SelectedTarget.tsx"
  ><SelectedTargetFacade label="nested" /></PreviewInspectorTargetBoundary></article>;
}
`;
}

/** The selected source owns a named target export, distinct from its root owner. */
function selectedTargetFixtureSource(): string {
  return String.raw`
import * as React from 'react';
export function SelectedTarget({ label }) { return <strong>{label}</strong>; }
`;
}

/** Models the production target facade while keeping the authored owner module static. */
function selectedTargetFacadeFixtureSource(): string {
  return String.raw`
import * as React from 'react';
import { SelectedTarget } from './SelectedTarget';
export default function SelectedTargetFacade(props) {
  return <SelectedTarget {...props} />;
}
`;
}
