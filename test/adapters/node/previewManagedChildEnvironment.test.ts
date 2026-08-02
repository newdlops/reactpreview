import { describe, expect, it } from 'vitest';
import {
  PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST,
  PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION,
  createPreviewManagedChildEnvironment,
} from '../../../src/adapters/node/previewManagedChildEnvironment';

describe('preview managed child environment', () => {
  it('removes loader injection, preserves safe strings, and leaves its input unchanged', () => {
    const input: NodeJS.ProcessEnv = {
      DYLD_INSERT_LIBRARIES: '/missing/injection.dylib',
      DYLD_LIBRARY_PATH: '/unsafe/dyld',
      LANG: 'ko_KR.UTF-8',
      LD_AUDIT: '/missing/audit.so',
      LD_LIBRARY_PATH: '/unsafe/ld',
      LD_PRELOAD: '/missing/preload.so',
      NODE_OPTIONS: '--max-old-space-size=8192',
      PATH: '/safe/bin',
      PORT_MANAGER_HOOK: '1',
      SAFE_SENTINEL: 'preserved',
      TMPDIR: '/safe/tmp',
      UNDEFINED_SENTINEL: undefined,
    };
    const before = { ...input };
    const globalBefore = { ...process.env };

    const environment = createPreviewManagedChildEnvironment(input);

    expect(environment).toEqual({
      LANG: 'ko_KR.UTF-8',
      PATH: '/safe/bin',
      PORT_MANAGER_HOOK: '0',
      SAFE_SENTINEL: 'preserved',
      TMPDIR: '/safe/tmp',
    });
    expect(environment).not.toBe(input);
    expect(input).toEqual(before);
    expect(process.env).toEqual(globalBefore);
    expect(createPreviewManagedChildEnvironment(environment)).toEqual(environment);
  });

  it('has a stable non-secret policy identity', () => {
    expect(PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_VERSION).toBe(2);
    expect(PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST).toMatch(/^[a-f0-9]{64}$/u);
    expect(PREVIEW_MANAGED_CHILD_ENVIRONMENT_POLICY_DIGEST).not.toContain('preserved');
  });
});
