import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const script = path.resolve('scripts/run-preview-blocker-campaign.mjs');
const temporary = () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'preview-campaign-'));
  directories.push(directory);
  return directory;
};
const run = (arguments_: readonly string[]) =>
  execFileSync(process.execPath, [script, ...arguments_], { encoding: 'utf8' });
afterEach(() =>
  directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true })),
);

describe('run-preview-blocker-campaign manifest', () => {
  /** Keeps prior blocker targets while spreading a bounded census over root-relative surfaces. */
  it('prioritizes historical evidence and round-robins deterministic breadth strata', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    const candidates = [
      { exportable: true, historical: true, signatures: ['router'], sourcePath: '/repo/pages/A.tsx', stratum: 'app:pages' },
      { exportable: true, historical: true, signatures: ['router'], sourcePath: '/repo/legacy/D.tsx', stratum: 'app:legacy' },
      { exportable: true, signatures: ['router', 'provider'], sourcePath: '/repo/views/B.tsx', stratum: 'app:views' },
      { exportable: true, signatures: ['render'], sourcePath: '/repo/screens/C.tsx', stratum: 'app:screens' },
    ];
    const first = campaign.selectPreviewBlockerCensusTargets(candidates, 3).selected;
    expect(first.map((candidate: { sourcePath: string }) => candidate.sourcePath)).toEqual([
      '/repo/legacy/D.tsx',
      '/repo/pages/A.tsx',
      '/repo/screens/C.tsx',
    ]);
    expect(campaign.derivePreviewBlockerBreadthStratum('/repo/pages/admin/A.tsx', '/repo', 'app'))
      .toBe('app:pages/admin');
  });

  it('writes a deterministic, private, root-confined manifest without exposing targets in stdout', () => {
    const directory = temporary(),
      root = path.join(directory, 'project'),
      logs = path.join(directory, 'logs'),
      source = path.join(root, 'screen.tsx'),
      out = path.join(directory, 'manifest.json'),
      duplicateOut = path.join(directory, 'manifest-copy.json');
    mkdirSync(root, { recursive: true });
    mkdirSync(logs);
    writeFileSync(source, 'export const Screen = () => null;');
    writeFileSync(
      path.join(logs, 'history.log'),
      `React preview blocker trace\n${JSON.stringify({ previewTarget: source })}\n`,
    );
    const first = run(['manifest', '--root', root, '--log', logs, '--out', out]);
    const second = run(['manifest', '--root', root, '--log', logs, '--out', duplicateOut]);
    expect(first).toBe(second);
    expect(first).not.toContain(source);
    const manifest = JSON.parse(readFileSync(out, 'utf8')) as {
      targets: readonly { sourcePath: string }[];
    };
    expect(manifest.targets).toHaveLength(1);
    expect(manifest.targets[0]?.sourcePath).toBe(realpathSync(source));
    expect(require('node:fs').statSync(out).mode & 0o777).toBe(0o600);
  });
  it('rejects symlinks and paths outside approved roots', () => {
    const directory = temporary(),
      root = path.join(directory, 'root'),
      outside = path.join(directory, 'outside.tsx'),
      logs = path.join(directory, 'history.log'),
      out = path.join(directory, 'manifest.json');
    mkdirSync(root);
    writeFileSync(outside, 'export {};');
    symlinkSync(outside, path.join(root, 'link.tsx'));
    writeFileSync(logs, `"previewTarget": "${path.join(root, 'link.tsx')}"`);
    expect(() => run(['manifest', '--root', root, '--log', logs, '--out', out])).toThrow('symlink');
    writeFileSync(logs, `"previewTarget": "${outside}"`);
    expect(() => run(['manifest', '--root', root, '--log', logs, '--out', out])).toThrow('outside');
  });
});

describe('run-preview-blocker-campaign launch contract', () => {
  it('bounds malformed census input and retains only runtime or re-export modules', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    expect(campaign.censusPreviewBlockerSource('export type Only = string;').bucket).toBe(
      'non-exportable',
    );
    expect(
      campaign.censusPreviewBlockerSource("export { Screen } from './screen';").exportable,
    ).toBe(true);
    expect(campaign.censusPreviewBlockerSource('export const broken = ;').bucket).toBe('malformed');
    expect(campaign.censusPreviewBlockerSource('x'.repeat(2 * 1024 * 1024 + 1)).bucket).toBe(
      'oversized',
    );
  });
  it('accepts only decimal nonzero inspector ports', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    expect(campaign.validateInspectorPort('9945')).toBe(9945);
    for (const value of ['0', '-1', '1.5', ' 9945', '127.0.0.1:9945', '9e3', '65536'])
      expect(() => campaign.validateInspectorPort(value)).toThrow();
  });
  it('keeps the v5.3 fixed short IPC candidates pure and below Darwin limits', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    expect(existsSync('/tmp/rp56-p0')).toBe(false);
    expect(campaign.ipcSocketCandidates()).toEqual([
      '/tmp/rp56-p0/u/1.13-main.sock',
      '/private/tmp/rp56-p0/u/1.13-main.sock',
    ]);
    expect(
      campaign
        .validateIpcSocketCandidates()
        .map((value: string) => Buffer.byteLength(value, 'utf8')),
    ).toEqual([29, 37]);
    expect(() =>
      campaign.validateIpcSocketCandidates(['/tmp/rp56-p0/u/'.padEnd(103, 'x')]),
    ).toThrow();
    expect(existsSync('/tmp/rp56-p0')).toBe(false);
  });
  it('constructs the native diagnostic vector before application arguments', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    const args = campaign.createOpenArguments(
      {
        userdata: '/private/u',
        extensions: '/private/e',
        logs: '/private/l',
        canonicalRepo: '/Users/lky/project/reactpreview',
        hostPath: '/repo/host.cjs',
        workspacePath: '/private/w',
      },
      '{}',
      '/private/app.out',
      '/private/app.err',
    );
    expect(args.slice(0, 11)).toEqual([
      '-F',
      '-g',
      '-j',
      '-n',
      '-W',
      '--stdout',
      '/private/app.out',
      '--stderr',
      '/private/app.err',
      '-a',
      '/Applications/Visual Studio Code.app',
    ]);
    expect(args).toContain('--inspect-extensions=9945');
    expect(args).toContain('--extensionDevelopmentPath=/Users/lky/project/reactpreview');
    expect(args).not.toContain('--inspect-extensions=127.0.0.1:9945');
    expect(() =>
      campaign.createOpenArguments(
        {
          ...{},
          userdata: '/u',
          extensions: '/e',
          logs: '/l',
          hostPath: '/h',
          workspacePath: '/w',
        },
        '{}',
        '/o',
        '/e',
      ),
    ).toThrow();
  });
  it('keeps host bootstrap ordering testable without loading VS Code', () => {
    const host = require('../../scripts/preview-blocker-campaign-host.cjs') as {
      hasValidBootstrapLifecycle: (events: string[]) => boolean;
      validateAuthority: (value: unknown, sha: string, now?: number) => unknown;
    };
    expect(
      host.hasValidBootstrapLifecycle([
        'host-start',
        'authority-verified',
        'debug-verified',
        'extension-verified',
        'controller-acknowledged',
      ]),
    ).toBe(true);
    expect(host.hasValidBootstrapLifecycle(['authority-verified', 'host-start'])).toBe(false);
    expect(
      host.validateAuthority(
        {
          format: 'react-preview-campaign-authority/v1',
          expiresAt: 2,
          attemptOrdinal: 5,
          inspectorPort: 9945,
          canonicalRepo: '/Users/lky/project/reactpreview',
        },
        'a'.repeat(64),
        1,
      ),
    ).toBeTruthy();
    expect(() => host.validateAuthority({ format: 'wrong' }, 'a'.repeat(64))).toThrow();
  });
  it('accepts only semantic IP-literal loopback inspector endpoints', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    const host = require('../../scripts/preview-blocker-campaign-host.cjs') as {
      validateInspectorUrl: (value: unknown) => {
        ok: boolean;
        code?: string;
        observation: Record<string, unknown>;
      };
    };
    expect(campaign.validateInspectorEndpoint('ws://127.1.0.1:9945/id').host).toBe('127.1.0.1');
    expect(campaign.validateInspectorEndpoint('ws://[::1]:9945/id').host).toBe('::1');
    for (const value of [
      'ws://localhost:9945/id',
      'ws://127.0.0.1:9944/id',
      'ws://127.0.0.1:9945/id?q=1',
      'ws://127.0.0.1:9945/id#x',
      'ws://127.0.0.1:9945@evil/id',
    ]) {
      expect(() => campaign.validateInspectorEndpoint(value)).toThrow();
      expect(host.validateInspectorUrl(value).ok).toBe(false);
    }
    const opaque = 'ws://127.1.0.1:9945/opaque-private-token?credential=secret';
    const observation = host.validateInspectorUrl(opaque).observation;
    expect(JSON.stringify(observation)).not.toContain('opaque-private-token');
    expect(JSON.stringify(observation)).not.toContain('secret');
    expect(host.validateInspectorUrl(opaque).code).toBe('query');
  });
  it('classifies short-lived process evidence without launching', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    expect(campaign.classifyLaunchEvidence({ launcherExited: true, mainSeen: false })).toBe(
      'launcher-exited-before-main',
    );
    expect(campaign.classifyLaunchEvidence({ mainSeen: true, hostStart: false })).toBe(
      'main-exited-before-host-bootstrap',
    );
    expect(campaign.classifyLaunchEvidence({ hostStart: true, debugVerified: false })).toBe(
      'host-debug-failed',
    );
  });
  it('creates a deterministic private diagnostic index', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    const index = campaign.createDiagnosticIndex(
      [
        { name: '/private/a.stderr', bytes: 2, sha256: 'a' },
        { name: '/private/z.stdout', bytes: 1, sha256: 'z' },
      ],
      'host-debug-failed',
      'manifest',
    );
    expect(index.artifacts.map((artifact: { name: string }) => artifact.name)).toEqual([
      'a.stderr',
      'z.stdout',
    ]);
    expect(JSON.stringify(index)).not.toContain('/private');
  });
  it('requires an exact loopback proof acknowledgement', async () => {
    const campaign = await import('../../scripts/run-preview-blocker-campaign.mjs');
    const proof = { inspectorUrl: 'ws://127.0.0.1:9945/id', authoritySha256: 'a' };
    expect(
      campaign.validateProofAcknowledgement(
        proof,
        {
          proofSha256: require('node:crypto')
            .createHash('sha256')
            .update(JSON.stringify(proof))
            .digest('hex'),
        },
        'a',
      ),
    ).toBe(true);
    expect(() =>
      campaign.validateProofAcknowledgement(
        { ...proof, inspectorUrl: 'ws://other:9945/id' },
        {},
        'a',
      ),
    ).toThrow();
  });
});
