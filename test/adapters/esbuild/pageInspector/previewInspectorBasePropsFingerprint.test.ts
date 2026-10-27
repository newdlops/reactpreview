/** Keeps live props intact while excluding React's private owner graph from change detection. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorStateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStateRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewPageInspectorRuntimeSource';

/** Isolated registration state and the production JSON helpers under test. */
interface Harness {
  readonly stringifyPreviewInspectorProps: (
    value: unknown,
    options?: { readonly omitReactOwnership?: boolean },
  ) => string;
  readonly registerPreviewInspectorBaseProps: (name: string, props: unknown) => void;
  readonly session: {
    readonly basePropsByExport: Map<string, Record<string, unknown>>;
    readonly basePropsFingerprintByExport: Map<string, string>;
    descriptorNames: string[];
    selectedExportName: string;
  };
  readonly refreshes: () => number;
}

/** Minimal own-data React element fields; the private owner can hold an arbitrary live tree. */
interface ElementFixture {
  readonly $$typeof: symbol;
  readonly type: string;
  readonly key: null;
  readonly ref: null;
  readonly props: { children: string };
  readonly _owner: unknown;
  readonly _store: Record<string, never>;
}

/** Parses observed JSON as unknown so assertions, rather than unchecked member reads, inspect it. */
function parse(value: string | undefined): unknown {
  if (value === undefined) throw Error('Expected a stored fingerprint');
  return JSON.parse(value) as unknown;
}

/** Executes actual browser serialization and registration helpers against isolated session state. */
function createHarness(): Harness {
  const session = {
    basePropsByExport: new Map<string, Record<string, unknown>>(),
    basePropsFingerprintByExport: new Map<string, string>(),
    descriptorNames: [] as string[],
    selectedExportName: '',
  };
  let refreshes = 0;
  const runtime = createPreviewPageInspectorRuntimeSource();
  const registration = runtime.slice(
    runtime.indexOf('function registerPreviewInspectorBaseProps('),
    runtime.indexOf('function selectPreviewInspectorExport('),
  );
  const functions = vm.runInNewContext(
    createPreviewInspectorStateRuntimeSource() +
      registration +
      '\n({ stringifyPreviewInspectorProps, registerPreviewInspectorBaseProps });',
    {
      blockedInspectorPropNames: new Set(['__proto__', 'constructor', 'prototype']),
      previewInspectorSession: session,
      schedulePreviewInspectorTreeRefresh: () => {
        refreshes += 1;
      },
    },
  ) as {
    stringifyPreviewInspectorProps: (
      value: unknown,
      options?: { readonly omitReactOwnership?: boolean },
    ) => string;
    registerPreviewInspectorBaseProps: (name: string, props: unknown) => void;
  };
  return { ...functions, session, refreshes: () => refreshes };
}

/** Builds compiler-independent React protocol records with a visible child and private owner. */
function element(marker: string, owner: unknown, label = 'First'): ElementFixture {
  return {
    $$typeof: Symbol.for(marker),
    type: 'span',
    key: null,
    ref: null,
    props: { children: label },
    _owner: owner,
    _store: {},
  };
}

describe('base props fingerprint', () => {
  it.each(['react.element', 'react.transitional.element'])(
    'never visits the private owner graph of %s',
    (marker) => {
      const fixture = createHarness();
      let visits = 0;
      const owner = Object.defineProperty({}, 'fiber', {
        enumerable: true,
        get() {
          visits += 1;
          return { stateNode: 'retained application tree' };
        },
      });
      const child = element(marker, owner);
      fixture.registerPreviewInspectorBaseProps('Page', { children: child, count: 1 });
      expect(visits).toBe(0);
      expect(fixture.session.basePropsByExport.get('Page')?.children).toBe(child);
      expect(child._owner).toBe(owner);
      const fingerprint = parse(fixture.session.basePropsFingerprintByExport.get('Page'));
      expect(fingerprint).toHaveProperty('children', {
        type: 'span',
        key: null,
        ref: null,
        props: { children: 'First' },
        _store: {},
      });
    },
  );

  it('ignores owner replacement while retaining the freshest live props record', () => {
    const fixture = createHarness();
    const before = element('react.element', { version: 1 });
    const after = element('react.element', { version: 2 });
    fixture.registerPreviewInspectorBaseProps('Page', { children: before });
    fixture.registerPreviewInspectorBaseProps('Page', { children: after });
    expect(fixture.refreshes()).toBe(1);
    expect(fixture.session.basePropsByExport.get('Page')?.children).toBe(after);
  });

  it('refreshes for changed visible children and ordinary nested data', () => {
    const fixture = createHarness();
    const child = element('react.element', {});
    const data = { nested: { count: 1 } };
    fixture.registerPreviewInspectorBaseProps('Page', { children: child, data });
    child.props.children = 'Updated';
    fixture.registerPreviewInspectorBaseProps('Page', { children: child, data });
    data.nested.count = 2;
    fixture.registerPreviewInspectorBaseProps('Page', { children: child, data });
    expect(fixture.refreshes()).toBe(3);
  });

  it('keeps ordinary application properties named _owner visible to change detection', () => {
    const fixture = createHarness();
    fixture.registerPreviewInspectorBaseProps('Page', { data: { _owner: { id: 1 } } });
    fixture.registerPreviewInspectorBaseProps('Page', { data: { _owner: { id: 2 } } });
    expect(fixture.refreshes()).toBe(2);
    expect(parse(fixture.session.basePropsFingerprintByExport.get('Page'))).toEqual({
      data: { _owner: { id: 2 } },
    });
  });

  it('keeps the editor JSON behavior unchanged unless fingerprint mode is explicitly requested', () => {
    const fixture = createHarness();
    const child = element('react.element', { id: 'editor-owner' });
    expect(parse(fixture.stringifyPreviewInspectorProps(child))).toHaveProperty('_owner', {
      id: 'editor-owner',
    });
    expect(
      parse(fixture.stringifyPreviewInspectorProps(child, { omitReactOwnership: true })),
    ).not.toHaveProperty('_owner');
  });

  it('keeps cycle, bigint, function, symbol and prototype filtering semantics', () => {
    const fixture = createHarness();
    const value: Record<string, unknown> = {
      bigint: 42n,
      callback: () => undefined,
      symbol: Symbol('ignored'),
      nested: JSON.parse('{"safe":true,"__proto__":{"polluted":true}}'),
    };
    value.self = value;
    const expected = { bigint: '42', nested: { safe: true }, self: '[Circular]' };
    expect(parse(fixture.stringifyPreviewInspectorProps(value))).toEqual(expected);
    expect(
      parse(fixture.stringifyPreviewInspectorProps(value, { omitReactOwnership: true })),
    ).toEqual(expected);
  });

  it('keeps repeated-element and self-referential child cycle detection', () => {
    const fixture = createHarness();
    const child = element('react.transitional.element', {});
    const children: unknown[] = [child, child];
    (child.props as Record<string, unknown>).self = child;
    const result = parse(
      fixture.stringifyPreviewInspectorProps(children, { omitReactOwnership: true }),
    );
    expect(result).toMatchObject([{ props: { self: '[Circular]' } }, '[Circular]']);
  });

  it('does not invoke an owner getter or toJSON while creating a fingerprint', () => {
    const fixture = createHarness();
    let visits = 0;
    const child = element('react.element', {});
    Object.defineProperty(child, '_owner', {
      enumerable: true,
      get() {
        visits += 1;
        throw Error('Private owner must not be read');
      },
    });
    fixture.registerPreviewInspectorBaseProps('Page', { children: child });
    expect(visits).toBe(0);
    expect(fixture.session.basePropsFingerprintByExport.get('Page')).toContain('First');
    const other = element('react.element', {
      toJSON() {
        visits += 1;
        return 'private owner';
      },
    });
    fixture.registerPreviewInspectorBaseProps('Page', { children: other });
    expect(visits).toBe(0);
  });

  it('retains custom public element data and reports changes outside small preview-template limits', () => {
    const fixture = createHarness();
    const child = { ...element('react.element', {}), custom: { public: true } };
    const rows = Array.from({ length: 400 }, (_, index) => ({ index, value: 'same' }));
    fixture.registerPreviewInspectorBaseProps('Page', { children: child, rows });
    const last = rows.at(-1);
    if (last === undefined) throw Error('Expected the final ordinary data record');
    last.value = 'changed';
    fixture.registerPreviewInspectorBaseProps('Page', { children: child, rows });
    const result = parse(fixture.session.basePropsFingerprintByExport.get('Page'));
    expect(fixture.refreshes()).toBe(2);
    expect(result).toHaveProperty('children.custom', { public: true });
    expect(result).toHaveProperty('rows.399.value', 'changed');
  });
});
