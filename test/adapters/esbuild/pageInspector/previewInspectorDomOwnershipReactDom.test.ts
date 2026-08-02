/** Executes the private JSX ownership path against the installed ReactDOM client in Chromium. */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimePlugin } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimePlugin';
import { createPreviewInspectorDomOwnershipRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDomOwnershipRuntimeSource';

const run = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

const chromiumPath = findChromiumPath();

describe('Preview Inspector DOM ownership with ReactDOM 19', () => {
  it.skipIf(chromiumPath === undefined)(
    'keeps only connected inline intrinsic refs for simultaneous targets, ref replacement, portals, errors, and remounts',
    async () => {
      const directory = await mkdtemp(path.join(os.tmpdir(), 'react-preview-dom-ownership-'));
      temporaryDirectories.push(directory);
      const entry = path.join(directory, 'entry.tsx');
      const bundle = path.join(directory, 'bundle.js');
      const page = path.join(directory, 'index.html');
      await writeFile(
        entry,
        browserFixtureSource(createPreviewInspectorDomOwnershipRuntimeSource()),
        'utf8',
      );
      await build({
        bundle: true,
        entryPoints: [entry],
        format: 'iife',
        globalName: 'PreviewOwnershipFixture',
        jsx: 'automatic',
        jsxDev: true,
        nodePaths: [path.join(process.cwd(), 'node_modules')],
        outfile: bundle,
        platform: 'browser',
        plugins: [createPreviewInspectorRuntimePlugin({ projectRoot: process.cwd() })],
        write: true,
      });
      await writeFile(page, browserFixtureHtml(), 'utf8');
      const chromium = chromiumPath;
      if (chromium === undefined)
        throw new Error('Chromium was unavailable when this proof was registered.');
      const { stdout } = await run(
        chromium,
        [
          '--headless=new',
          '--disable-gpu',
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--allow-file-access-from-files',
          '--virtual-time-budget=5000',
          '--dump-dom',
          '--user-data-dir=' + path.join(directory, 'chromium-profile'),
          'file://' + page,
        ],
        { timeout: 30_000 },
      );
      const result = /<output id="result">([^<]+)<\/output>/u.exec(stdout)?.[1];
      expect(result).toBeDefined();
      const parsed = JSON.parse(decodeHtml(result ?? '')) as unknown as Record<string, unknown>;
      expect(parsed.errorRejected).toBe(true);
      expect(parsed.normalAuthorized).toBe(true);
      expect(parsed.secondAuthorized).toBe(true);
      expect(parsed.namedPortalRejected).toBe(true);
      expect(parsed.namespacePortalRejected).toBe(true);
      expect(parsed.defaultPortalRejected).toBe(true);
      expect(parsed.remountAuthorized).toBe(true);
      expect(parsed.unchangedMarkup).toBe(true);
      expect(parsed.invalidCapabilityRejected).toBe(true);
      expect(parsed.invalidSourceRejected).toBe(true);
      expect(parsed.invalidExportRejected).toBe(true);
      expect(parsed.crossInstanceRejected).toBe(true);
      expect(parsed.staleRejected).toBe(true);
      expect(parsed.callbackAttaches).toBeGreaterThan(0);
      expect(parsed.callbackCleanups).toBeGreaterThan(0);
      expect(parsed.noRefChurn).toBe(true);
      expect(parsed.noCleanupAttaches).toBeGreaterThan(0);
      expect(parsed.noCleanupNulls).toBeGreaterThan(0);
      expect(parsed.privateAttaches).toBeGreaterThan(0);
      expect(parsed.privateReleases).toBeGreaterThan(0);
    },
    30_000,
  );
});

/** Decodes the two entities emitted by Chromium's serialized output element. */
function decodeHtml(value: string): string {
  return value.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
}

/** Lists conventional local Chromium executable paths in priority order. */
function chromiumCandidates(): string[] {
  return [
    process.env.CHROMIUM_PATH,
    '/opt/homebrew/bin/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((candidate): candidate is string => candidate !== undefined && candidate.length > 0);
}

/** Finds Chromium at registration time so an unavailable proof is visibly skipped. */
function findChromiumPath(): string | undefined {
  return chromiumCandidates().find((candidate) => existsSync(candidate));
}

/** Returns the compiled browser fixture without relying on test-environment DOM shims. */
function browserFixtureSource(ownershipRuntimeSource: string): string {
  return (
    ownershipRuntimeSource +
    String.raw`
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import ReactDOM, * as ReactDOMNamespace from 'react-dom';
import { createPortal } from 'react-dom';
import { jsx as productionJsx } from 'react/jsx-runtime';
const apiKey = Symbol.for('newdlops.react-file-preview.page-inspector');
const OwnershipContext = globalThis[apiKey].readJsxOwnershipContext();
globalThis[apiKey].registerOwnedHost = registerPreviewInspectorOwnedHost;
globalThis.findSelectedPreviewInspectorDescriptor = () => ({ inspector: { target: { sourcePath: '/workspace/Target.tsx' } } });
const boundaries = new WeakMap();
const pause = () => new Promise((resolve) => setTimeout(resolve, 40));
function Boundary({ children, token }) { const [failed, setFailed] = React.useState(false); const boundary = React.useRef({ ownershipToken: token }); React.useEffect(() => { boundaries.set(token, boundary.current); return registerPreviewInspectorOwnershipBoundary(token, boundary.current); }, [token]); if (failed) return <p id="failure">failed</p>; return <Catch onError={() => setFailed(true)}><OwnershipContext.Provider value={token}>{children}</OwnershipContext.Provider></Catch>; }
class Catch extends React.Component { componentDidCatch() { this.props.onError(); } render() { return this.props.children; } }
const portalFactories = { default: ReactDOM.createPortal, named: createPortal, namespace: ReactDOMNamespace.createPortal };
function Target({ portalMode, throwError, objectRef, onRef }) {
  if (throwError) throw new Error('fixture failure');
  if (portalMode) return portalFactories[portalMode](<i id={'portal-' + portalMode}>portal</i>, document.querySelector('#portal'));
  return <><div id="first" data-authored="yes" ref={objectRef}>one</div><span id="second" ref={onRef}>two</span>{productionJsx('b', { id: 'mixed-runtime', children: 'mixed' })}</>;
}
function gate(token) { const boundary = boundaries.get(token); return readPreviewInspectorOwnedHosts(boundary, { targetExportName: 'default' }).some((node) => node.nodeType === 1 && node.isConnected && document.querySelector('#mount').contains(node)); }
export async function run() {
  const mount = document.querySelector('#mount'); const root = createRoot(document.querySelector('#root')); const objectRef = { current: null }; let callbackAttaches = 0; let callbackCleanups = 0; let noCleanupAttaches = 0; let noCleanupNulls = 0; let privateAttaches = 0; let privateReleases = 0; const privateRegister = globalThis[apiKey].registerOwnedHost; globalThis[apiKey].registerOwnedHost = (token, node) => { privateAttaches += 1; const release = privateRegister(token, node); return () => { privateReleases += 1; release?.(); }; };
  const callback = () => { callbackAttaches += 1; return () => { callbackCleanups += 1; }; }; const noCleanup = (node) => { if (node) noCleanupAttaches += 1; else noCleanupNulls += 1; };
  const metadata = { exportName: 'default', sourcePath: '/workspace/Target.tsx' }; const tokenFor = () => { const capability = {}; registerPreviewInspectorCompilerCapability(capability, metadata); return createPreviewInspectorOwnershipToken(capability, metadata); }; const invalidCapabilityRejected = createPreviewInspectorOwnershipToken({}, metadata) === undefined; const invalidSourceRejected = (() => { const c = {}; registerPreviewInspectorCompilerCapability(c, metadata); return createPreviewInspectorOwnershipToken(c, { ...metadata, sourcePath: '/wrong.tsx' }) === undefined; })(); const invalidExportRejected = (() => { const c = {}; registerPreviewInspectorCompilerCapability(c, metadata); return createPreviewInspectorOwnershipToken(c, { ...metadata, exportName: 'Wrong' }) === undefined; })(); const render = (children) => root.render(<React.StrictMode>{children}<em id="outside">outside</em></React.StrictMode>); const target = (key, token, props, ref) => <Boundary key={key} token={token}><Target {...props} objectRef={objectRef} onRef={ref} /></Boundary>;
  const normal = tokenFor(); const second = tokenFor(); render(<>{target('normal', normal, {}, callback)}{target('second', second, {}, noCleanup)}</>); await pause(); const stableCounts = [callbackAttaches, callbackCleanups, noCleanupAttaches, noCleanupNulls, privateAttaches, privateReleases].join(':'); render(<>{target('normal', normal, {}, callback)}{target('second', second, {}, noCleanup)}</>); await pause(); const noRefChurn = stableCounts === [callbackAttaches, callbackCleanups, noCleanupAttaches, noCleanupNulls, privateAttaches, privateReleases].join(':'); render(<>{target('normal', normal, {}, noCleanup)}{target('second', second, {}, noCleanup)}</>); await pause(); const normalHosts = readPreviewInspectorOwnedHosts(boundaries.get(normal), { targetExportName: 'default' }); const secondHosts = readPreviewInspectorOwnedHosts(boundaries.get(second), { targetExportName: 'default' }); const normalAuthorized = gate(normal) && objectRef.current?.id === 'first'; const secondAuthorized = gate(second); const crossInstanceRejected = normalHosts.length > 0 && secondHosts.length > 0 && !secondHosts.includes(normalHosts[0]); const unchangedMarkup = mount.innerHTML.includes('data-authored="yes"') && !mount.innerHTML.includes('react-preview');
  const named = tokenFor(); render(target('named', named, { portalMode: 'named' }, noCleanup)); await pause(); const namedPortalRejected = !gate(named) && document.querySelector('#portal-named') !== null;
  const namespace = tokenFor(); render(target('namespace', namespace, { portalMode: 'namespace' }, noCleanup)); await pause(); const namespacePortalRejected = !gate(namespace) && document.querySelector('#portal-namespace') !== null;
  const portal = tokenFor(); render(target('portal', portal, { portalMode: 'default' }, noCleanup)); await pause(); const defaultPortalRejected = !gate(portal) && document.querySelector('#portal-default') !== null;
  const failure = tokenFor(); render(target('failure', failure, { throwError: true }, noCleanup)); await pause(); const errorRejected = !gate(failure) && document.querySelector('#failure') !== null;
  const remount = tokenFor(); render(target('remount', remount, {}, noCleanup)); await pause(); const remountAuthorized = gate(remount); root.unmount(); await pause(); const staleRejected = !readPreviewInspectorOwnedHosts(boundaries.get(remount), { targetExportName: 'default' }).length;
  const output = document.createElement('output'); output.id = 'result'; output.textContent = JSON.stringify({ callbackAttaches, callbackCleanups, crossInstanceRejected, defaultPortalRejected, errorRejected, invalidCapabilityRejected, invalidExportRejected, invalidSourceRejected, namedPortalRejected, namespacePortalRejected, noCleanupAttaches, noCleanupNulls, noRefChurn, normalAuthorized, privateAttaches, privateReleases, remountAuthorized, secondAuthorized, staleRejected, unchangedMarkup }); document.body.append(output);
}
`
  );
}

/** Installs the private registry before the automatic JSX runtime module initializes. */
function browserFixtureHtml(): string {
  return '<main id="mount"><div id="root"></div><div id="portal"></div></main><script>window.__ownershipContext=undefined;window[Symbol.for("newdlops.react-file-preview.page-inspector")]={registerJsxOwnershipContext(c){window.__ownershipContext=c},readJsxOwnershipContext(){return window.__ownershipContext}};</script><script src="bundle.js"></script><script>PreviewOwnershipFixture.run()</script>';
}
