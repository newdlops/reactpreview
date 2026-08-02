/** Proves exact committed boundary ownership against the installed real ReactDOM runtime. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewInspectorFiberRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorFiberRuntimeSource';
import { createPreviewManagedChildEnvironment } from '../../../../src/adapters/node/previewManagedChildEnvironment';

const temporaryDirectories: string[] = [];
const chromiumPath = [
  process.env.CHROMIUM_PATH,
  '/opt/homebrew/bin/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]
  .filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0)
  .find((candidate) => existsSync(candidate));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe('Preview Inspector exact Fiber ownership with real ReactDOM', () => {
  it.skipIf(chromiumPath === undefined)(
    'marks target-only and authentic nested exact boundary Fibers as mounted',
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
    },
    60_000,
  );
});

interface FixtureCdpMessage {
  readonly error?: { readonly message?: string };
  readonly id?: number;
  readonly result?: Record<string, unknown>;
}

/** Minimal null-delimited CDP pipe client used only by the real-browser ownership proof. */
class FixtureCdpClient {
  private buffer = '';
  private nextId = 1;
  private readonly pending = new Map<
    number,
    {
      readonly reject: (error: Error) => void;
      readonly resolve: (message: FixtureCdpMessage) => void;
    }
  >();

  public constructor(
    private readonly input: Writable,
    output: Readable,
  ) {
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

  public request(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<FixtureCdpMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { reject, resolve });
      this.input.write(
        `${JSON.stringify({
          id,
          method,
          params,
          ...(sessionId === undefined ? {} : { sessionId }),
        })}\0`,
      );
    });
  }

  private receive(message: FixtureCdpMessage): void {
    if (message.id === undefined) return;
    const pending = this.pending.get(message.id);
    if (pending === undefined) return;
    this.pending.delete(message.id);
    if (message.error === undefined) pending.resolve(message);
    else pending.reject(new Error(message.error.message ?? 'Unknown CDP error.'));
  }
}

/** Uses the production CDP-pipe launch shape so Chromium never depends on `--dump-dom`. */
async function runChromiumFixture(
  executable: string,
  pageUrl: string,
  profilePath: string,
): Promise<string> {
  const browser = spawn(
    executable,
    [
      '--headless=new',
      '--allow-file-access-from-files',
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
  let stderr = '';
  browser.stderr?.on('data', (chunk: Buffer | string) => {
    stderr = (stderr + chunk.toString()).slice(-4_000);
  });
  const input = browser.stdio[3] as Writable | null;
  const output = browser.stdio[4] as Readable | null;
  if (input === null || output === null) {
    browser.kill('SIGKILL');
    throw new Error('Chromium CDP fixture pipes are unavailable.');
  }
  const client = new FixtureCdpClient(input, output);
  try {
    const targetResponse = await client.request('Target.getTargets');
    const targetInfos = targetResponse.result?.targetInfos;
    const page = Array.isArray(targetInfos)
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
      new Promise<void>((resolve) => browser.once('close', () => resolve())),
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
  const output = document.createElement('output');
  output.id = 'result';
  output.textContent = JSON.stringify({ direct, nested, phases });
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
