/** Verifies the generated libui provider bridge keeps exact package identity and activation. */
import { describe, expect, it } from 'vitest';
import { createPreviewYarnLibuiRuntimeSource } from '../../../src/adapters/esbuild/previewYarnLibuiRuntimeSource';

describe('createPreviewYarnLibuiRuntimeSource', () => {
  it('composes the public Application only for an unowned reached consumer', () => {
    const source = createPreviewYarnLibuiRuntimeSource({
      applicationModulePath: '/workspace/node_modules/@yarnpkg/libui/Application.js',
    });

    expect(source).toContain(
      'import * as ApplicationModule from "/workspace/node_modules/@yarnpkg/libui/Application.js"',
    );
    expect(source).toContain(
      'const nextConsumes = consumesMinistore || requirement.consumesMinistore === true',
    );
    expect(source).toContain("typeof React.useSyncExternalStore === 'function'");
    expect(source).toContain('function YarnLibuiSubscriptionBoundary');
    expect(source).toContain('if (ownsMinistore)');
    expect(source).toContain('return React.createElement(Application, null, children)');
    expect(source).not.toContain('eval(');
  });
});
