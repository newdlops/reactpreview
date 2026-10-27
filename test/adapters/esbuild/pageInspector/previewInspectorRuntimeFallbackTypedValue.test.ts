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
  it('restores a declared component fallback as a callable instead of a frozen empty record', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const component = fixture.api.resolve(
      () => undefined,
      () => ({}),
      {
        ...createMetadata(),
        id: 'typed-icon-component',
        requiredPaths: ['<root>'],
        typedValue: { [TAG]: 'function', returns: null },
      },
    ) as () => unknown;
    expect(typeof component).toBe('function');
    expect(component()).toBeNull();
    const authored = (): string => 'authored-icon';
    expect(
      fixture.api.resolve(
        () => authored,
        () => ({}),
        {
          ...createMetadata(),
          id: 'authored-icon-component',
          requiredPaths: ['<root>'],
          typedValue: { [TAG]: 'function', returns: null },
        },
      ),
    ).toBe(authored);
  });

  it('keeps a generated React ref writable and stable through mount, detach, and reuse', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const metadata = {
      ...createMetadata(),
      id: 'typed-react-ref',
      requiredPaths: ['containerRef', 'ready'],
      typedValue: {
        containerRef: { [TAG]: 'ref', value: null },
        ready: false,
      },
    };
    const resolve = (): { containerRef: { current: unknown }; ready: boolean } =>
      fixture.api.resolve(
        () => undefined,
        () => ({ containerRef: {}, ready: false }),
        metadata,
      ) as { containerRef: { current: unknown }; ready: boolean };
    const first = resolve();
    expect(first.containerRef.current).toBeNull();
    expect(Object.isFrozen(first)).toBe(true);
    const node = { nodeType: 1 };
    first.containerRef.current = node;
    expect(resolve().containerRef).toBe(first.containerRef);
    expect(resolve().containerRef.current).toBe(node);
    first.containerRef.current = null;
    expect(resolve().containerRef.current).toBeNull();
  });

  it('preserves an authored ref identity and leaves ordinary current-shaped data immutable', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const authored = { containerRef: { current: null } };
    const metadata = {
      ...createMetadata(),
      id: 'authored-react-ref',
      requiredPaths: ['containerRef'],
      typedValue: {
        containerRef: { [TAG]: 'ref', value: null },
      },
    };
    expect(
      fixture.api.resolve(
        () => authored,
        () => ({ containerRef: {} }),
        metadata,
      ),
    ).toBe(authored);
    const data = fixture.api.resolve(
      () => undefined,
      () => ({}),
      {
        ...createMetadata(),
        id: 'ordinary-current-record',
        requiredPaths: ['record'],
        typedValue: { record: { current: null } },
      },
    ) as { record: { current: unknown } };
    expect(Object.isFrozen(data.record)).toBe(true);
    expect(() => {
      data.record.current = 1;
    }).toThrow(TypeError);
  });

  /** A name such as open can describe an optional Boolean, rather than an open() action. */
  it('keeps optional Boolean overlay state closed instead of inventing a truthy callback', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const setOpen = (): string => 'authored-setter';
    const value = fixture.api.resolve(
      () => ({ open: undefined, setOpen }),
      () => ({ open: () => undefined, setOpen: () => undefined }),
      {
        ...createMetadata(),
        hookName: 'usePopover',
        requiredPaths: ['open', 'setOpen()'],
        typedValue: { open: false, setOpen: { [TAG]: 'function' } },
      },
    ) as { open: unknown; setOpen: () => string };

    expect(value.open).toBe(false);
    expect(value.setOpen).toBe(setOpen);
    expect(value.setOpen()).toBe('authored-setter');
  });

  /** Serialized bigint fields become integers in hook fallbacks, so currency renders stay finite. */
  it('materializes bigint descriptors and keeps concrete fallback integers', () => {
    const fixture = createRuntimeFallbackFixture(true);
    const value = fixture.api.resolve(
      () => {
        throw new Error('provider unavailable');
      },
      () => ({ authored: 0n }),
      {
        ...createMetadata(),
        hookName: 'useUsage',
        id: 'typed-bigint-usage',
        moduleSpecifier: '../hooks/useUsage',
        requiredPaths: ['costMicros', 'authored'],
        typedValue: {
          authored: { [TAG]: 'bigint', value: '1' },
          costMicros: { [TAG]: 'bigint', value: '1' },
          debt: { [TAG]: 'bigint', value: '-3' },
          large: { [TAG]: 'bigint', value: '9007199254740993' },
          malformed: { [TAG]: 'bigint', value: 'not-an-integer' },
        },
      },
    ) as Readonly<Record<string, bigint>>;

    expect(value.authored).toBe(0n);
    expect(value.costMicros).toBe(1n);
    expect(value.debt).toBe(-3n);
    expect(value.large).toBe(9007199254740993n);
    expect(value.malformed).toBe(0n);
    expect(Number.isFinite(Number(value.costMicros) / 1_000_000)).toBe(true);
  });

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
