/**
 * Verifies how compiler-declared type values repair render-only hook fallbacks at runtime.
 * Syntax evidence keeps its concrete leaves; declared types replace shape-blind placeholders and
 * invalid literals; typed-only sites replace a hook only when it throws.
 */
import { describe, expect, it } from 'vitest';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

const TAG = '$previewTyped';

describe('Preview Inspector declared-type fallbacks', () => {
  /** A `{}` placeholder under a numeric field becomes the declared number. */
  it('replaces shape-blind placeholders while keeping syntax evidence', () => {
    const fixture = createRuntimeFallbackFixture(true);

    const value = fixture.api.resolve(
      () => {
        throw new Error('No QueryClient set, use QueryClientProvider to set one');
      },
      () => ({ data: { status_counts: { OUT_OF_STOCK: {} } }, isError: false }),
      {
        ...createMetadata(),
        hookName: 'useQuery',
        id: 'typed-summary-1',
        moduleSpecifier: '../hooks/useSummary',
        requiredPaths: ['data.status_counts.OUT_OF_STOCK', 'isError', 'refetch()'],
        typedValue: {
          data: { status_counts: { OUT_OF_STOCK: 1 }, total_inventory_value: 1 },
          isError: false,
          refetch: { [TAG]: 'function' },
        },
      },
    ) as {
      readonly data: {
        readonly status_counts: { readonly OUT_OF_STOCK: unknown };
        readonly total_inventory_value: unknown;
      };
      readonly isError: unknown;
      readonly refetch: unknown;
    };

    expect(value.data.status_counts.OUT_OF_STOCK).toBe(1);
    expect(value.data.total_inventory_value).toBe(1);
    expect(value.isError).toBe(false);
    expect(typeof value.refetch).toBe('function');
  });

  /** Text outside a declared literal union is replaced; an allowed member is preserved. */
  it('repairs literal-union violations and keeps allowed syntax literals', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      hookName: 'useGrade',
      moduleSpecifier: '../hooks/useGrade',
      requiredPaths: ['grade', 'tier'],
      typedLiterals: { grade: ['S', 'A'], tier: ['gold', 'silver'] },
      typedValue: { grade: 'S', tier: 'gold' },
    };

    const value = fixture.api.resolve(
      () => {
        throw new Error('provider unavailable');
      },
      () => ({ grade: 'grade', tier: 'silver' }),
      { ...metadata, id: 'typed-grade-1' },
    );

    expect(value).toEqual({ grade: 'S', tier: 'silver' });
  });

  /** Typed-only sites never alter a successful hook, even when authored fields are absent. */
  it('leaves successful typed-only hooks untouched and materializes them after a throw', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const typedOnly = {
      ...createMetadata(),
      hookName: 'useCalendar',
      moduleSpecifier: 'calendar-kit',
      preserveNullish: true,
      requiredPaths: [],
      typedOnly: true,
      typedValue: {
        day: { [TAG]: 'date', iso: '2026-01-15T09:00:00.000Z' },
        select: { [TAG]: 'function', returns: true },
      },
    };
    const authored = { day: undefined };

    const success = fixture.api.resolve(
      () => authored,
      () => undefined,
      {
        ...typedOnly,
        id: 'typed-only-success',
      },
    );
    const substituted = fixture.api.resolve(
      () => {
        throw new Error('useCalendar must be used within CalendarProvider');
      },
      () => undefined,
      { ...typedOnly, id: 'typed-only-throw' },
    ) as { readonly day: unknown; readonly select: () => unknown };

    expect(success).toBe(authored);
    expect(substituted.day).toBeInstanceOf(fixture.evaluate('Date') as DateConstructor);
    expect(substituted.select()).toBe(true);
  });
});
