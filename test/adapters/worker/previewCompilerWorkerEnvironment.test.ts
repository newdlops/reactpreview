import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PreviewCompilerWorkerClient } from '../../../src/adapters/worker/previewCompilerWorkerClient';
import {
  assertPreviewCompilerWorkerIsolation,
  createPreviewCompilerWorkerEnvironment,
  createPreviewCompilerWorkerOptions,
  PREVIEW_COMPILER_WORKER_ISOLATION_POLICY,
  PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST,
  PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION,
  PREVIEW_INVENTORY_WORKER_OLD_GENERATION_LIMIT_MB,
  PREVIEW_INVENTORY_WORKER_TIMEOUT_MS,
  PREVIEW_ROUTE_WORKER_OLD_GENERATION_LIMIT_MB,
} from '../../../src/adapters/worker/previewCompilerWorkerIsolation';

const PROJECT_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE_WORKER_PATH = path.join(
  PROJECT_ROOT,
  'test/fixtures/preview-compiler-environment-worker.cjs',
);

describe('preview compiler worker managed environment', () => {
  it('freezes the exact canonical v3 isolation policy and digest', () => {
    expect(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY).toEqual({
      ambientHeapOverrideDenylist: [
        '--huge-max-old-generation-size',
        '--initial-old-space-size',
        '--initial_old_space_size',
        '--max-old-space-size',
        '--max_old_space_size',
        '--max-semi-space-size',
        '--max_semi_space_size',
      ],
      goMemoryDefault: '256MiB',
      goMemoryMaximumBytes: 268_435_456,
      goMemoryPreserveStricterPositiveInherited: true,
      goParallelismDefault: 2,
      goParallelismMaximum: 2,
      goParallelismPreserveStricterPositiveInherited: true,
      inventoryOldGenerationLimitMb: 2_048,
      inventoryRetryPolicy: 'none',
      inventoryShutdownGraceMs: 5_000,
      inventoryTimeoutMs: 1_800_000,
      inventoryWorkerRelease: 'before-ledger-creation',
      managedChildEnvironmentPolicyDigest:
        '5256c0e4cf38441a91f7bd17ab276e7c344d37f381bfebee55fe5d8eeb486aef',
      managedChildEnvironmentPolicyVersion: 2,
      policyVersion: 3,
      routeOldGenerationLimitMb: 384,
      transport: 'worker-thread',
      workerExecArgv: [],
    });
    expect(Object.isFrozen(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY)).toBe(true);
    expect(
      Object.isFrozen(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.ambientHeapOverrideDenylist),
    ).toBe(true);
    expect(Object.isFrozen(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.workerExecArgv)).toBe(true);
    expect(PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_VERSION).toBe(3);
    expect(PREVIEW_INVENTORY_COMPILER_ISOLATION_POLICY_DIGEST).toBe(
      'a88baf7521baffa65f4f7c6257ce53e3372422b623f05eef31ba506e1ca2c66d',
    );
  });

  it('builds exact inventory and route limits with an empty inherited Node argument list', () => {
    const parentEnvironment = {
      GOMAXPROCS: '99',
      GOMEMLIMIT: '2GiB',
      NODE_OPTIONS: '--max-old-space-size=8192',
      SAFE_SENTINEL: 'preserved',
    };
    const inventory = createPreviewCompilerWorkerOptions(
      parentEnvironment,
      PREVIEW_INVENTORY_WORKER_OLD_GENERATION_LIMIT_MB,
    );
    const route = createPreviewCompilerWorkerOptions(
      parentEnvironment,
      PREVIEW_ROUTE_WORKER_OLD_GENERATION_LIMIT_MB,
    );

    expect(inventory.execArgv).toEqual([]);
    expect(route.execArgv).toEqual([]);
    expect(inventory.resourceLimits.maxOldGenerationSizeMb).toBe(2_048);
    expect(route.resourceLimits.maxOldGenerationSizeMb).toBe(384);
    expect(inventory.env).toMatchObject({
      GOMAXPROCS: '2',
      GOMEMLIMIT: '256MiB',
      SAFE_SENTINEL: 'preserved',
    });
    expect(inventory.env).not.toHaveProperty('NODE_OPTIONS');
    expect(PREVIEW_INVENTORY_WORKER_TIMEOUT_MS).toBe(1_800_000);
    expect(PREVIEW_COMPILER_WORKER_SHUTDOWN_GRACE_MS).toBe(5_000);
  });

  it.each(PREVIEW_COMPILER_WORKER_ISOLATION_POLICY.ambientHeapOverrideDenylist)(
    'rejects exact ambient heap flag %s in equals and separate-token forms',
    (flag) => {
      expect(() => {
        assertPreviewCompilerWorkerIsolation([`${flag}=4096`], undefined);
      }).toThrow('rejects ambient Node heap overrides');
      expect(() => {
        assertPreviewCompilerWorkerIsolation([flag, '4096'], undefined);
      }).toThrow('rejects ambient Node heap overrides');
      expect(() => {
        assertPreviewCompilerWorkerIsolation([], `${flag}=4096`);
      }).toThrow('rejects ambient Node heap overrides');
      expect(() => {
        assertPreviewCompilerWorkerIsolation([], `${flag} 4096`);
      }).toThrow('rejects ambient Node heap overrides');
    },
  );

  it('accepts unrelated Node options and denylist-prefix lookalikes', () => {
    expect(() => {
      assertPreviewCompilerWorkerIsolation(
        ['--trace-warnings', '--max-old-space-size-extra=4096'],
        '--enable-source-maps --initial-old-space-size-extra 2048',
      );
    }).not.toThrow();
  });

  it('preserves stricter positive Go limits and clamps invalid or oversized values', () => {
    expect(
      createPreviewCompilerWorkerEnvironment({
        GOMAXPROCS: '1',
        GOMEMLIMIT: '128MiB',
      }),
    ).toMatchObject({ GOMAXPROCS: '1', GOMEMLIMIT: '128MiB' });
    expect(
      createPreviewCompilerWorkerEnvironment({
        GOMAXPROCS: '2',
        GOMEMLIMIT: '256MiB',
      }),
    ).toMatchObject({ GOMAXPROCS: '2', GOMEMLIMIT: '256MiB' });
    expect(
      createPreviewCompilerWorkerEnvironment({
        GOMAXPROCS: '3',
        GOMEMLIMIT: '257MiB',
      }),
    ).toMatchObject({ GOMAXPROCS: '2', GOMEMLIMIT: '256MiB' });
    expect(
      createPreviewCompilerWorkerEnvironment({
        GOMAXPROCS: '1junk',
        GOMEMLIMIT: 'off',
      }),
    ).toMatchObject({ GOMAXPROCS: '2', GOMEMLIMIT: '256MiB' });
  });

  it('runs a real esbuild descendant with contaminated parent input sanitized', async () => {
    const processBefore = { ...process.env };
    const parentEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      DYLD_INSERT_LIBRARIES: '/definitely/missing/react-preview-injection.dylib',
      DYLD_LIBRARY_PATH: '/unsafe/dyld',
      LD_AUDIT: '/definitely/missing/react-preview-audit.so',
      LD_LIBRARY_PATH: '/unsafe/ld',
      LD_PRELOAD: '/definitely/missing/react-preview-preload.so',
      NODE_OPTIONS: '--definitely-invalid-react-preview-option',
      PORT_MANAGER_HOOK: '1',
      SAFE_SENTINEL: 'preserved',
    };
    const parentBefore = { ...parentEnvironment };
    const client = new PreviewCompilerWorkerClient(FIXTURE_WORKER_PATH, {
      compilationTimeoutMs: 15_000,
      parentEnvironment,
    });

    try {
      const bundle = await client.compile({
        dependencySnapshots: [],
        documentPath: '/virtual/ManagedChild.tsx',
        language: 'tsx',
        sourceText: 'export default function ManagedChild() { return null; }',
        workspaceRoot: '/virtual',
      });
      expect(new TextDecoder().decode(bundle.javascript)).toContain('42');
      expect(bundle.diagnostics).toEqual([]);
    } finally {
      await client.shutdown();
    }

    expect(parentEnvironment).toEqual(parentBefore);
    expect(process.env).toEqual(processBefore);
  }, 30_000);
});
