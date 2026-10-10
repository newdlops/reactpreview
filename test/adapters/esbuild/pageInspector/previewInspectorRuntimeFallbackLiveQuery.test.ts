/**
 * Verifies that live TanStack/React Query results keep their authored lifecycle and that store or
 * facade member calls never add render-scoped React hooks to the host function.
 */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

/** Builds the minimum observable surface of a pending TanStack Query result. */
function createPendingQueryResult(): Record<string, unknown> {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    isFetching: true,
    isLoading: true,
    refetch: () => undefined,
    status: 'pending',
  };
}

describe('Preview Inspector live Query results', () => {
  /** Loading state is authored behavior, not a missing value; data arrives via the data boundary. */
  it('returns a pending query result without completing required data paths', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const pending = createPendingQueryResult();

    const value = fixture.api.resolve(
      () => pending,
      () => ({ data: { items: [{}] } }),
      {
        ...createMetadata(),
        hookName: 'useQuery',
        id: 'query-1',
        moduleSpecifier: '@tanstack/react-query',
        requiredPaths: ['data.items[]', 'data.total'],
      },
    );

    expect(value).toBe(pending);
    expect(fixture.api.read()).toEqual([]);
  });

  /** A project wrapper that returns the query object is recognized by its result shape. */
  it('recognizes a wrapped query result by shape', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const settled = {
      ...createPendingQueryResult(),
      data: null,
      isFetching: false,
      status: 'success',
    };

    const value = fixture.api.resolve(
      () => settled,
      () => ({ data: { name: 'generated' } }),
      {
        ...createMetadata(),
        hookName: 'useSkus',
        id: 'query-wrapper-1',
        moduleSpecifier: '../hooks/useSkus',
        requiredPaths: ['data.name'],
      },
    );

    expect(value).toBe(settled);
  });

  /** A missing QueryClientProvider still throws, and that failure keeps the ordinary fallback. */
  it('keeps the generated fallback when the Query hook throws', () => {
    const fixture = createRuntimeFallbackFixture(true);

    const value = fixture.api.resolve(
      () => {
        throw new Error('No QueryClient set, use QueryClientProvider to set one');
      },
      () => ({ data: { name: 'generated' } }),
      {
        ...createMetadata(),
        hookName: 'useQuery',
        id: 'query-throws-1',
        moduleSpecifier: '@tanstack/react-query',
        requiredPaths: ['data.name'],
      },
    );

    expect(value).toEqual({ data: { name: 'generated' } });
    expect(fixture.api.read()[0]?.reason).toBe('threw');
  });
});

describe('Preview Inspector member-call instrumentation', () => {
  /** `useStore.getState()` inside an HTTP interceptor must not call React hooks outside render. */
  it('does not add render-scoped hooks for member invocations', () => {
    const fixture = createRuntimeFallbackFixture(true);
    fixture.evaluate(
      [
        'globalThis.__hookCalls = 0;',
        'globalThis.React = {',
        '  useEffect() { globalThis.__hookCalls += 1; },',
        '  useReducer() {',
        '    globalThis.__hookCalls += 1;',
        "    throw new Error('Invalid hook call outside render');",
        '  },',
        '};',
      ].join('\n'),
    );
    const state = { company_id: 'company-1', token: 'token-1' };
    const memberMetadata = {
      ...createMetadata(),
      hookName: 'useAuthStore.getState',
      id: 'store-member-1',
      invocation: 'member',
      moduleSpecifier: '../stores/authStore',
      requiredPaths: ['token', 'company_id'],
    };

    const value = fixture.api.resolve(
      () => state,
      () => ({ token: 'generated' }),
      memberMetadata,
    );

    expect(value).toBe(state);
    expect(fixture.evaluate('globalThis.__hookCalls')).toBe(0);
    expect(() =>
      fixture.api.resolve(
        () => state,
        () => ({ token: 'generated' }),
        {
          ...memberMetadata,
          id: 'store-hook-1',
          invocation: undefined,
        },
      ),
    ).toThrow('Invalid hook call outside render');
  });
});
