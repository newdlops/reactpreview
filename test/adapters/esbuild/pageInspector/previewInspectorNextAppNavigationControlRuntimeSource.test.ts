/** Verifies framework redirects use proven candidates, finite trails and user-priority selection. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNextAppNavigationControlRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNextAppNavigationControlRuntimeSource';

/** Compiler-owned filesystem route metadata supplied to the production runtime. */
function route(
  id: string,
  pathname: string,
  complete = true,
): {
  id: string;
  complete: boolean;
  routeLocation: { evidenceKind: string; pathname: string; sourcePath: string };
} {
  return {
    id,
    complete,
    routeLocation: {
      evidenceKind: 'next-app-filesystem',
      pathname,
      sourcePath: '/app' + pathname + '/page.tsx',
    },
  };
}

/** Retains the runtime session and selection calls across microtasks and simulated replacement. */
function fixture(persisted: unknown = {}): {
  candidates: ReturnType<typeof route>[];
  calls: unknown[];
  current: ReturnType<typeof route>;
  session: Record<string, unknown>;
  handle: (signal: unknown, owner?: unknown) => boolean;
  blocked: () => boolean;
  clear: (owner: unknown) => boolean;
  serialize: () => unknown;
} {
  const session: Record<string, unknown> = {
    neuralHumanControlRevision: 0,
    selectedPageCandidateId: 'index',
  };
  const current = route('index', '/mypage');
  const candidates = [current, route('profile', '/mypage/profile')];
  const descriptor = {
    inspector: { target: { sourcePath: '/app/layout.tsx', exportName: 'default' } },
  };
  const calls: unknown[] = [];
  const context = vm.createContext({
    previewInspectorSession: session,
    findSelectedPreviewInspectorDescriptor: () => descriptor,
    readSelectedPreviewInspectorPageCandidate: () => current,
    readPreviewInspectorPageCandidates: () => candidates,
    readPersistedPreviewInspectorState: () => persisted,
    selectPreviewInspectorPageCandidate: (...args: unknown[]) => (calls.push(args), true),
  });
  vm.runInContext(createPreviewInspectorNextAppNavigationControlRuntimeSource(), context);
  return {
    candidates,
    calls,
    current,
    session,
    handle: (signal: unknown, owner?: unknown): boolean => {
      context.signal = signal;
      context.owner = owner;
      return vm.runInContext(
        'handlePreviewInspectorNextAppNavigationControl(signal, owner)',
        context,
      ) as boolean;
    },
    blocked: (): boolean =>
      vm.runInContext('hasPreviewInspectorNextAppControlBlocker()', context) as boolean,
    clear: (owner: unknown): boolean => {
      context.owner = owner;
      return vm.runInContext(
        'clearPreviewInspectorNextAppNavigationControl(owner)',
        context,
      ) as boolean;
    },
    serialize: (): unknown =>
      vm.runInContext('serializePreviewInspectorNextAppNavigationTrail()', context),
  };
}

describe('Next App navigation continuation', () => {
  it('keeps a guard provisional and releases only its actual boundary on retry', () => {
    const runtime = fixture(),
      owner = {};
    expect(runtime.blocked()).toBe(false);
    expect(runtime.handle({ kind: 'notFound' }, owner)).toBe(false);
    expect(runtime.blocked()).toBe(true);
    expect(runtime.clear({})).toBe(false);
    expect(runtime.blocked()).toBe(true);
    expect(runtime.clear(owner)).toBe(true);
    expect(runtime.blocked()).toBe(false);
  });
  it('coalesces a proven redirect and retains a finite trail through document replacement', async () => {
    const runtime = fixture();
    const signal = { kind: 'redirect', destination: '/mypage/profile' };
    expect(runtime.handle(signal)).toBe(true);
    expect(runtime.handle(signal)).toBe(false);
    await Promise.resolve();
    expect(runtime.calls).toEqual([['profile', { origin: 'framework-navigation' }]]);
    const trail = runtime.serialize();
    expect(trail).toMatchObject({ transitions: ['/mypage\0/mypage/profile'] });
    expect(trail).not.toHaveProperty('queued');
    const replacement = fixture({ nextAppNavigationTrail: trail });
    expect(replacement.handle(signal)).toBe(false);
    expect(replacement.calls).toEqual([]);
  });

  it.each([
    { kind: 'redirect', destination: 'https://example.com/mypage/profile' },
    { kind: 'redirect', destination: '//example.com/mypage/profile' },
    { kind: 'redirect', destination: '/mypage/profile?tab=1' },
    { kind: 'redirect', destination: '/mypage/profile#settings' },
    { kind: 'redirect', destination: '/mypage\\profile' },
    { kind: 'redirect', destination: '/mypage/profile\n' },
    { kind: 'redirect', destination: '/unknown' },
    { kind: 'notFound', destination: '/mypage/profile' },
  ])('declines an unproven destination or a non-navigation guard: %j', async (signal) => {
    const runtime = fixture();
    expect(runtime.handle(signal)).toBe(false);
    await Promise.resolve();
    expect(runtime.calls).toEqual([]);
  });

  it('declines ambiguous routes while admitting a proven filesystem route with unfinished ancestry', () => {
    const runtime = fixture();
    runtime.candidates.push(route('other-profile', '/mypage/profile'));
    expect(runtime.handle({ kind: 'redirect', destination: '/mypage/profile' })).toBe(false);
    runtime.candidates.pop();
    const candidate = runtime.candidates[1];
    if (candidate !== undefined) candidate.complete = false;
    expect(runtime.handle({ kind: 'redirect', destination: '/mypage/profile' })).toBe(true);
  });

  it.each(['pendingPageCandidateId', 'queuedPageCandidateId'])('respects %s', (key) => {
    const runtime = fixture();
    runtime.session[key] = 'chosen-by-user';
    expect(runtime.handle({ kind: 'redirect', destination: '/mypage/profile' })).toBe(false);
  });

  it('cancels an admitted microtask after user intervention and bounds distinct transitions', async () => {
    const runtime = fixture();
    expect(runtime.handle({ kind: 'redirect', destination: '/mypage/profile' })).toBe(true);
    runtime.session.nextAppNavigationTrail = undefined;
    await Promise.resolve();
    expect(runtime.calls).toEqual([]);
    runtime.session.nextAppNavigationTrail = {
      owner: '/app/layout.tsx\0default',
      transitions: ['1', '2', '3', '4'],
    };
    expect(runtime.handle({ kind: 'redirect', destination: '/mypage/profile' })).toBe(false);
  });

  it('never reads application getters while admitting or restoring navigation', () => {
    let reads = 0;
    const signal = {
      get kind() {
        reads += 1;
        return 'redirect';
      },
      destination: '/mypage/profile',
    };
    const runtime = fixture({
      nextAppNavigationTrail: {
        get owner() {
          reads += 1;
          return 'x';
        },
      },
    });
    expect(runtime.handle(signal)).toBe(false);
    expect(runtime.handle({ kind: 'permanentRedirect', destination: '/mypage/profile' })).toBe(
      true,
    );
    expect(reads).toBe(0);
  });
});
