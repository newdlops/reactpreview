/** Verifies candidate-local automatic hook values and application-owned Router authority. */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';
import { PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackRuntimeSource';
import { createPreviewInspectorRuntimeFallbackScopeRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeFallbackScopeRuntimeSource';

describe('Preview Inspector runtime fallback scope source', () => {
  /** Places a keyed subscriber above project providers so candidate state cannot leak outward. */
  it('defines an extension-owned provider remount boundary for scope changes', () => {
    const source = createPreviewInspectorRuntimeFallbackScopeRuntimeSource();

    expect(source).toContain('function PreviewInspectorRuntimeFallbackScopeBoundary');
    expect(source).toContain('usePreviewInspectorStore();');
    expect(source).toContain('React.createElement(React.Fragment, { key: scopeKey }, children)');
  });

  /** Keeps authored target-only diagnostics on the same direct scope in outer and inner layers. */
  it('includes explicit target-only reachability in the shared perspective decision', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('application-page', false);
    fixture.api.resolve(
      () => undefined,
      () => ({ companyId: 'page-scope' }),
      { ...createMetadata(), requiredPaths: ['companyId'] },
    );
    fixture.api.setTargetOnly(true, true);

    expect(fixture.api.readEffectiveDirectTarget('application-page')).toBe(true);
    expect(fixture.api.activateEffectiveScope('application-page')).toBe(true);
    expect(fixture.api.activateEffectiveScope('application-page')).toBe(false);
  });

  /** Prevents one revision or candidate's inferred payload from entering another page corridor. */
  it('expires inferred values when the revision, candidate, or perspective changes', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('application-page', true);
    const directValue = fixture.api.resolve(
      () => {
        throw new Error('provider unavailable in direct preview');
      },
      () => ({ mode: 'direct-generated' }),
      { ...createMetadata(), requiredPaths: ['mode'] },
    );

    fixture.api.setRevision(1);
    expect(fixture.api.activateScope('application-page', true)).toBe(true);
    const revisedValue = fixture.api.resolve(
      () => {
        throw new Error('provider unavailable in revised preview');
      },
      () => ({ mode: 'revision-generated' }),
      { ...createMetadata(), requiredPaths: ['mode'] },
    );
    expect(fixture.api.activateScope('second-page', false)).toBe(true);
    const pageValue = fixture.api.resolve(
      () => undefined,
      () => ({ mode: 'page-generated' }),
      { ...createMetadata(), requiredPaths: ['mode'] },
    );

    expect(directValue).toEqual({ mode: 'direct-generated' });
    expect(revisedValue).toEqual({ mode: 'revision-generated' });
    expect(revisedValue).not.toBe(directValue);
    expect(pageValue).toEqual({ mode: 'page-generated' });
    expect(pageValue).not.toBe(revisedValue);
    expect(fixture.api.read()).toHaveLength(1);
  });

  /** Retains stable identities while the same revision and candidate perspective remains active. */
  it('keeps inferred values when the active scope is unchanged', () => {
    const fixture = createRuntimeFallbackFixture(true);
    expect(fixture.api.activateScope('application-page', false)).toBe(false);
    const first = fixture.api.resolve(
      () => undefined,
      () => ({ status: 'first' }),
      { ...createMetadata(), requiredPaths: ['status'] },
    );

    expect(fixture.api.activateScope('application-page', false)).toBe(false);
    const second = fixture.api.resolve(
      () => undefined,
      () => ({ status: 'second' }),
      { ...createMetadata(), requiredPaths: ['status'] },
    );

    expect(second).toBe(first);
    expect(second).toEqual({ status: 'first' });
    expect(fixture.api.read()).toHaveLength(1);
  });

  /** Prevents two current-file exports sharing one candidate from sharing inferred hook identity. */
  it('expires inferred values when the selected export changes', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('application-page', false);
    const first = fixture.api.resolve(
      () => undefined,
      () => ({ owner: 'first-export' }),
      { ...createMetadata(), requiredPaths: ['owner'] },
    );

    fixture.api.setSelectedExport('SiblingExport');
    expect(fixture.api.activateScope('application-page', false)).toBe(true);
    const sibling = fixture.api.resolve(
      () => undefined,
      () => ({ owner: 'sibling-export' }),
      { ...createMetadata(), requiredPaths: ['owner'] },
    );

    expect(first).toEqual({ owner: 'first-export' });
    expect(sibling).toEqual({ owner: 'sibling-export' });
    expect(sibling).not.toBe(first);
  });

  /** Retains explicit JSON while inferred values from the previous corridor are discarded. */
  it('preserves user overrides across page-candidate scope changes', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('public-page', false);
    fixture.api.resolve(
      () => undefined,
      () => ({ companyId: 'generated' }),
      { ...createMetadata(), requiredPaths: ['companyId'] },
    );
    fixture.api.set('hook-1', { companyId: 'user-company' });

    fixture.api.setRevision(2);
    fixture.api.activateScope('staff-page', false);
    const result = fixture.api.resolve(
      () => undefined,
      () => ({ companyId: 'new-generated' }),
      { ...createMetadata(), requiredPaths: ['companyId'] },
    );

    expect(result).toEqual({ companyId: 'user-company' });
    expect(fixture.api.read()[0]?.mode).toBe('manual');

    fixture.api.reset('hook-1');
    const regenerated = fixture.api.resolve(
      () => undefined,
      () => ({ companyId: 'staff-generated' }),
      { ...createMetadata(), requiredPaths: ['companyId'] },
    );
    expect(regenerated).toEqual({ companyId: 'staff-generated' });
  });

  /** Lets a new candidate execute an effect that the preceding candidate had render-isolated. */
  it('expires compiler-owned effect isolation and execution windows across candidates', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('first-page', false);
    const metadata = {
      ...createMetadata(),
      hookName: 'useEffect',
      id: 'candidate-effect',
      requiredPaths: [],
    };
    let executions = 0;

    for (let index = 0; index < PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT + 2; index += 1) {
      fixture.api.effect(() => {
        executions += 1;
      }, metadata);
    }
    expect(executions).toBe(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT);
    expect(fixture.api.status()).toContain('1 render-only effect failure(s) isolated');

    expect(fixture.api.activateScope('second-page', false)).toBe(true);
    expect(fixture.api.status()).not.toContain('render-only effect failure(s) isolated');
    fixture.api.effect(() => {
      executions += 1;
    }, metadata);
    expect(executions).toBe(PREVIEW_INSPECTOR_RUNTIME_EFFECT_EXECUTION_LIMIT + 1);
  });

  /** Ignores a rejected async effect owned by a candidate that has already been replaced. */
  it('does not restore stale effect isolation after a candidate switch', async () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.activateScope('first-page', false);
    let rejectEffect: ((reason: Error) => void) | undefined;
    const pendingEffect = new Promise<never>((_resolve, reject) => {
      rejectEffect = reject;
    });
    fixture.api.effect(() => pendingEffect, {
      ...createMetadata(),
      hookName: 'useEffect',
      id: 'pending-candidate-effect',
      requiredPaths: [],
    });

    fixture.api.activateScope('second-page', false);
    rejectEffect?.(new Error('late first-page rejection'));
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.api.status()).not.toContain('render-only effect failure(s) isolated');
    expect(fixture.warnings).toEqual([]);
  });

  /** Keeps actual location/params values intact after an owned Router successfully supplied them. */
  it('does not complete successful hooks from an application-owned Router', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.setRouterOwned(true);
    const actualLocation = Object.freeze({ pathname: '/company/1/dashboard' });
    let hookCalls = 0;

    const result = fixture.api.resolve(
      () => {
        hookCalls += 1;
        return actualLocation;
      },
      () => ({ pathname: '/preview', search: '?preview=true' }),
      {
        ...createMetadata(),
        hookName: 'useLocation',
        moduleSpecifier: 'react-router-dom',
        requiredPaths: ['pathname', 'search'],
      },
    );

    expect(result).toBe(actualLocation);
    expect(hookCalls).toBe(1);
    expect(fixture.api.read()).toEqual([]);
  });

  /** Preserves a successful null route match instead of inventing a truthy matched branch. */
  it('keeps authoritative nullish results from an application-owned Router', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.setRouterOwned(true);

    const result = fixture.api.resolve(
      () => null,
      () => ({ params: { companyId: 'preview-id' } }),
      {
        ...createMetadata(),
        hookName: 'useMatch',
        moduleSpecifier: 'react-router-dom',
        requiredPaths: ['params.companyId'],
      },
    );

    expect(result).toBeNull();
    expect(fixture.api.read()).toEqual([]);
  });

  /** Still isolates a missing Router boundary because no real context value exists to preserve. */
  it('falls back when an owned Router hook throws before its boundary mounts', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.api.setRouterOwned(true);

    const result = fixture.api.resolve(
      () => {
        throw new Error('useLocation() may be used only in the context of a Router');
      },
      () => ({ pathname: '/preview' }),
      {
        ...createMetadata(),
        hookName: 'useLocation',
        moduleSpecifier: 'react-router',
        requiredPaths: ['pathname'],
      },
    );

    expect(result).toEqual({ pathname: '/preview' });
    expect(fixture.api.read()[0]).toMatchObject({ reason: 'threw' });
  });
});
